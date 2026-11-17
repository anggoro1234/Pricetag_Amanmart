import { 
  Product, 
  ProductStock,
  StoreLocation, 
  LabelTemplateConfig, 
  User, 
  StockAdjustment, 
  StockTransfer, 
  LowStockAlert, 
  SyncQueueItem,
  ThermalPrinterSettings,
  ImportProductRecord,
  ImportTransactionResult
} from '../types';
import { INITIAL_STORES, INITIAL_TEMPLATES, INITIAL_USERS } from '../data/initialData';
import { audioService } from './audioService';
import {
  idbGetProducts,
  idbSaveProducts,
  idbClearProducts,
  supabaseService,
  serverCatalogService,
} from './supabaseService';
import {
  detectBarcodeType,
  generateValidEan13,
  hasActualBarcode,
  normalizeBarcodeLookup,
  normalizeLooseSku,
  sanitizeBarcodeValue,
} from '../utils/barcodeUtils';
import { parseAndValidateImportText } from '../utils/importMapper';

export { generateValidEan13, sanitizeBarcodeValue, detectBarcodeType };

const STORAGE_KEYS = {
  PRODUCTS: 'aman_label_products_v1',
  LOCAL_DATA_PURGED: 'aman_local_data_purged_v1',
  STORES: 'aman_label_stores_v1',
  TEMPLATES: 'aman_label_templates_v1',
  CURRENT_USER: 'aman_label_current_user_v1',
  ACTIVE_STORE: 'aman_label_active_store_v1',
  PRINTER_SETTINGS: 'aman_label_printer_settings_v1',
  ADJUSTMENTS: 'aman_label_adjustments_v1',
  TRANSFERS: 'aman_label_transfers_v1',
  ALERTS: 'aman_label_alerts_v1',
  OFFLINE_QUEUE: 'aman_label_offline_queue_v1',
  SIMULATED_OFFLINE: 'aman_label_simulated_offline_v1',
  LAST_CATALOG_SYNC_AT: 'aman_label_last_catalog_sync_at_v1',
};

const LEGACY_DEMO_IDS = new Set([
  'prod-1',
  'prod-2',
  'prod-3',
  'prod-4',
  'prod-5',
  'prod-6',
  'prod-7',
  'prod-8',
  'prod-9',
  'prod-10',
  'prod-fresh-1',
]);

// Fast deterministic FNV-1a fingerprint across catalog items to detect price/barcode/stock updates across devices
function computeCatalogFingerprint(products: Product[]): string {
  if (!products || products.length === 0) return '0:0';
  let hash = 2166136261;
  for (let i = 0; i < products.length; i++) {
    const p = products[i];
    const krgQty = p.stocks?.['store-krg']?.quantity ?? 0;
    const entry = `${p.sku || ''}|${p.barcode || ''}|${p.name || ''}|${p.pricing?.unitPrice ?? 0}|${p.pricing?.bulkPrice ?? 0}|${p.category || ''}|${krgQty}`;
    for (let j = 0; j < entry.length; j++) {
      hash ^= entry.charCodeAt(j);
      hash = Math.imul(hash, 16777619);
    }
  }
  return `${products.length}:${hash >>> 0}`;
}

// Normalize category names so "FRESH" and "Fresh" don't create duplicate categories
export const normalizeCategoryName = (raw?: string): string => {
  if (!raw || !raw.trim()) return 'Grocery';
  const clean = raw.trim().replace(/^['";]+|['";]+$/g, '').trim();
  if (!clean) return 'Grocery';

  const upper = clean.toUpperCase();
  const map: Record<string, string> = {
    FRESH: 'Fresh',
    GROCERY: 'Grocery',
    SEMBAKO: 'Grocery',
    BEVERAGES: 'Beverages',
    MINUMAN: 'Beverages',
    SNACKS: 'Snacks',
    SNACK: 'Snacks',
    'INSTANT FOOD': 'Instant Food',
    'MIE INSTAN': 'Instant Food',
    'PERSONAL CARE': 'Personal Care',
    BAKERY: 'Bakery',
    ROTI: 'Bakery',
    'SAUCE & CONDIMENTS': 'Sauce & Condiments',
  };

  if (map[upper]) return map[upper];

  // Title-case if all uppercase
  if (clean === upper && clean.length > 2) {
    return clean
      .toLowerCase()
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }
  return clean;
};

class StorageService {
  private channel: BroadcastChannel | null = null;
  private listeners: Set<() => void> = new Set();
  private memoryProducts: Product[] | null = null;
  private remoteSyncInProgress = false;
  private isMutatingRemote = false;
  private lastRemoteSyncTriggerMs = 0;
  private syncIntervalId: ReturnType<typeof setInterval> | null = null;

  constructor() {
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      try {
        this.channel = new BroadcastChannel('aman_inventory_sync_channel');
        this.channel.onmessage = async (event) => {
          if (event.data?.type === 'SYNC_EVENT') {
            const idbProds = await idbGetProducts();
            if (idbProds) {
              this.memoryProducts = idbProds;
            }
            this.notifyListeners();
          }
        };
      } catch {
        // Fallback to window storage events
      }
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('storage', () => this.notifyListeners());
      window.addEventListener('online', () => this.handleNetworkRestored());
      window.addEventListener('focus', () => {
        this.triggerThrottledRemoteSync();
      });
      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') {
            this.triggerThrottledRemoteSync();
          }
        });
      }
      this.syncIntervalId = setInterval(() => {
        if (this.isOnline() && !this.isMutatingRemote) {
          this.syncWithRemoteStores().catch(() => {});
        }
      }, 45000);
    }

    this.initDefaults();
  }

  isSyncingRemote(): boolean {
    return this.remoteSyncInProgress;
  }

  private triggerThrottledRemoteSync() {
    const now = Date.now();
    if (now - this.lastRemoteSyncTriggerMs < 4000) return;
    this.lastRemoteSyncTriggerMs = now;
    if (this.isOnline() && !this.isMutatingRemote) {
      this.syncWithRemoteStores().catch(() => {});
    }
  }

  // Persist products safely across Memory + IndexedDB (100MB+) + localStorage fallback (if <= 1800 items)
  private persistProducts(products: Product[]) {
    this.memoryProducts = products;
    // Save full dataset to IndexedDB (handles 10,000 - 100,000+ items without QuotaExceededError)
    idbSaveProducts(products).catch(() => {});
    this.writeLocalProductsFallback(products);
  }

  private async persistProductsAsync(products: Product[]): Promise<void> {
    this.memoryProducts = products;
    this.writeLocalProductsFallback(products);
    await idbSaveProducts(products);
  }

  private writeLocalProductsFallback(products: Product[]) {
    // Only write to localStorage if dataset is small enough (<= 1800 items), and always wrap in try/catch
    if (typeof window !== 'undefined') {
      try {
        if (products.length <= 1800) {
          localStorage.setItem(STORAGE_KEYS.PRODUCTS, JSON.stringify(products));
        } else {
          // Store only first 250 items in localStorage as fast boot snapshot while IndexedDB holds all 10,000+ items
          localStorage.setItem(STORAGE_KEYS.PRODUCTS, JSON.stringify(products.slice(0, 250)));
        }
      } catch {
        // If localStorage is full (QuotaExceededError), clear the heavy key so IndexedDB & memory take over
        try {
          localStorage.removeItem(STORAGE_KEYS.PRODUCTS);
        } catch {}
      }
    }
  }

  // Clean, repair (including 0896860100468 -> 089686010046), preserve existing IDs, and deduplicate catalog
  private normalizeAndDeduplicateCatalog(rawProducts: Product[]): {
    products: Product[];
    repairedProducts: Product[];
    obsoleteIds: string[];
  } {
    const products: Product[] = [];
    const repairedById = new Map<string, Product>();
    const obsoleteIdSet = new Set<string>();
    const skuToIdx = new Map<string, { index: number; isPreferredId: boolean }>();
    const usedIds = new Set<string>();

    for (const rawProd of rawProducts) {
      if (!rawProd) continue;
      // Drop legacy local dummy prototype items
      if (
        rawProd.id === 'prod-fresh-1' ||
        rawProd.sku === '50007' ||
        (rawProd.name && rawProd.name.includes('BONELESS PAHA FZ/ KG'))
      ) {
        if (rawProd.id) obsoleteIdSet.add(rawProd.id);
        continue;
      }

      let p: Product = {
        ...rawProd,
        pricing: { ...(rawProd.pricing || { unitLabel: 'PCS', unitQuantity: 1, unitPrice: 0 }) },
        stocks: { ...(rawProd.stocks || {}) },
      };
      let needsRemoteRepair = false;

      if (p.name && p.name.includes(';')) {
        const semiParts = p.name.split(';').map((s) => s.trim());
        if (semiParts.length >= 3) {
          const extractedName = semiParts[0].replace(/^["']+|["']+$/g, '').trim();
          const extractedBarcode = semiParts[1] || '';
          const extractedPrice = parseInt((semiParts[2] || '').replace(/[^0-9]/g, ''), 10);
          const extractedSku = semiParts[3] || p.sku;
          const extractedCategory = semiParts[4] ? normalizeCategoryName(semiParts[4]) : p.category;
          if (extractedName) {
            p.name = extractedName.toUpperCase();
            if (extractedSku) p.sku = extractedSku.trim();
            if (extractedCategory) {
              p.category = extractedCategory;
              p.department = `${extractedCategory} / General`;
            }
            if (!isNaN(extractedPrice) && extractedPrice >= 0) {
              p.pricing.unitPrice = extractedPrice;
              p.pricing.bulkPrice = extractedPrice > 0 ? Math.round(extractedPrice * 22) : 0;
            }
            p.barcode = sanitizeBarcodeValue(extractedBarcode, p.sku || p.name);
            needsRemoteRepair = true;
          }
        }
      }

      const cleanSku = (p.sku || '').trim();
      if (cleanSku !== p.sku) {
        p.sku = cleanSku;
      }

      const cleanBc = sanitizeBarcodeValue(p.barcode, p.sku || p.name);
      if (cleanBc !== p.barcode) {
        p.barcode = cleanBc;
        needsRemoteRepair = true;
      }

      const detectedType = detectBarcodeType(cleanBc);
      if (p.barcodeType !== detectedType) {
        p.barcodeType = detectedType;
      }

      const cleanCat = normalizeCategoryName(p.category);
      if (cleanCat !== p.category) {
        p.category = cleanCat;
      }

      INITIAL_STORES.forEach((store) => {
        if (!p.stocks[store.id]) {
          const legacyStock = p.stocks['store-1'] || p.stocks['store-2'] || p.stocks['store-3'];
          p.stocks[store.id] = {
            storeId: store.id,
            quantity: Math.max(0, legacyStock?.quantity ?? 35),
            minThreshold: legacyStock?.minThreshold ?? 20,
            lastUpdated: new Date().toISOString(),
          };
        } else if (p.stocks[store.id].quantity < 0 || isNaN(p.stocks[store.id].quantity)) {
          p.stocks[store.id] = {
            ...p.stocks[store.id],
            quantity: Math.max(0, p.stocks[store.id].quantity || 0),
          };
        }
      });

      const canonicalId = cleanSku
        ? `prod-sku-${cleanSku.replace(/[^a-zA-Z0-9_-]/g, '')}`
        : `prod-${Date.now()}-${products.length}`;

      if (!p.id || LEGACY_DEMO_IDS.has(p.id)) {
        if (p.id && LEGACY_DEMO_IDS.has(p.id)) {
          obsoleteIdSet.add(p.id);
        }
        p.id = canonicalId;
        needsRemoteRepair = true;
      }

      const isPreferredId = !LEGACY_DEMO_IDS.has(p.id) && p.id.startsWith('prod-sku-');

      if (cleanSku) {
        const skuKey = cleanSku.toLowerCase();
        const existingEntry = skuToIdx.get(skuKey);
        if (existingEntry !== undefined) {
          const prevProd = products[existingEntry.index];
          if (isPreferredId && !existingEntry.isPreferredId) {
            if (prevProd.id && prevProd.id !== p.id) {
              obsoleteIdSet.add(prevProd.id);
              repairedById.delete(prevProd.id);
            }
            products[existingEntry.index] = p;
            skuToIdx.set(skuKey, { index: existingEntry.index, isPreferredId: true });
            repairedById.set(p.id, p);
          } else {
            if (p.id && p.id !== prevProd.id) {
              obsoleteIdSet.add(p.id);
            }
            repairedById.set(prevProd.id, prevProd);
          }
          continue;
        }
        skuToIdx.set(skuKey, { index: products.length, isPreferredId });
      }

      if (usedIds.has(p.id)) {
        p.id = canonicalId;
      }
      usedIds.add(p.id);

      products.push(p);
      if (needsRemoteRepair) {
        repairedById.set(p.id, p);
      }
    }

    // Never delete an ID that is still in the active deduplicated product list
    for (const prod of products) {
      obsoleteIdSet.delete(prod.id);
    }

    return {
      products,
      repairedProducts: Array.from(repairedById.values()),
      obsoleteIds: Array.from(obsoleteIdSet),
    };
  }

  private initDefaults() {
    if (typeof window === 'undefined') return;

    // Check & migrate stores to 8 branches (KRG, XML, KLP, PLT, MKR, CPM, SNM, IQM)
    const storedStoresRaw = localStorage.getItem(STORAGE_KEYS.STORES);
    let needStoreMigration = false;
    if (storedStoresRaw) {
      try {
        const parsedStores: StoreLocation[] = JSON.parse(storedStoresRaw);
        const hasOldStores = parsedStores.some(
          (s) => s.code === 'JKT-01' || s.code === 'JKT' || s.code === 'SBY-02' || s.code === 'BDG-03' || s.code === 'DPS-04'
        );
        if (hasOldStores || parsedStores.length < 8) {
          needStoreMigration = true;
        }
      } catch {
        needStoreMigration = true;
      }
    } else {
      needStoreMigration = true;
    }

    if (needStoreMigration) {
      localStorage.setItem(STORAGE_KEYS.STORES, JSON.stringify(INITIAL_STORES));
      localStorage.setItem(STORAGE_KEYS.ACTIVE_STORE, JSON.stringify('store-krg'));
    }

    if (!localStorage.getItem(STORAGE_KEYS.PRODUCTS)) {
      this.memoryProducts = [];
    } else {
      try {
        const storedProds: Product[] = JSON.parse(localStorage.getItem(STORAGE_KEYS.PRODUCTS) || '[]');
        const normalized = this.normalizeAndDeduplicateCatalog(storedProds);
        this.memoryProducts = normalized.products;
        if (normalized.repairedProducts.length > 0 || normalized.obsoleteIds.length > 0) {
          this.writeLocalProductsFallback(normalized.products);
        }
      } catch {
        this.memoryProducts = [];
      }
    }

    // Hydrate full 10,000+ dataset from IndexedDB, then synchronize across Server & Supabase Cloud
    this.remoteSyncInProgress = true;
    idbGetProducts()
      .then((idbProds) => {
        if (idbProds && idbProds.length > 0) {
          const normalizedIdb = this.normalizeAndDeduplicateCatalog(idbProds);
          if (normalizedIdb.products.length >= (this.memoryProducts?.length || 0)) {
            this.memoryProducts = normalizedIdb.products;
            if (normalizedIdb.repairedProducts.length > 0 || normalizedIdb.obsoleteIds.length > 0) {
              this.persistProducts(normalizedIdb.products);
            }
            this.notifyListeners();
          } else if (this.memoryProducts && this.memoryProducts.length > normalizedIdb.products.length) {
            idbSaveProducts(this.memoryProducts).catch(() => {});
          }
        } else if (this.memoryProducts && this.memoryProducts.length > 0) {
          idbSaveProducts(this.memoryProducts).catch(() => {});
        }
      })
      .catch(() => {})
      .finally(() => {
        this.syncWithRemoteStores()
          .catch(() => {})
          .finally(() => {
            this.remoteSyncInProgress = false;
            this.notifyListeners();
          });
      });

    if (!localStorage.getItem(STORAGE_KEYS.TEMPLATES)) {
      localStorage.setItem(STORAGE_KEYS.TEMPLATES, JSON.stringify(INITIAL_TEMPLATES));
    } else {
      // Upgrade default supermarket shelf template size & default showBulkPrice to false (PCS only by default)
      const bulkMigratedKey = 'aman_label_bulk_default_hidden_v1';
      const alreadyMigratedBulk = localStorage.getItem(bulkMigratedKey) === 'true';
      try {
        const storedTemplates: LabelTemplateConfig[] = JSON.parse(
          localStorage.getItem(STORAGE_KEYS.TEMPLATES) || '[]'
        );
        let tmplModified = false;
        const updatedTemplates = storedTemplates.map((t) => {
          if (t.id === 'tmpl-supermarket') {
            const needsSizeUpgrade = t.widthMm <= 65 && t.heightMm <= 28;
            const needsBulkHide = !alreadyMigratedBulk && t.showBulkPrice === true;
            if (needsSizeUpgrade || needsBulkHide) {
              tmplModified = true;
              return {
                ...t,
                widthMm: needsSizeUpgrade ? 72 : t.widthMm,
                heightMm: needsSizeUpgrade ? 35 : t.heightMm,
                barcodeHeightMm: needsSizeUpgrade ? 13 : t.barcodeHeightMm,
                showBulkPrice: needsBulkHide ? false : t.showBulkPrice,
              };
            }
          }
          return t;
        });
        if (tmplModified) {
          localStorage.setItem(STORAGE_KEYS.TEMPLATES, JSON.stringify(updatedTemplates));
        }
        if (!alreadyMigratedBulk) {
          localStorage.setItem(bulkMigratedKey, 'true');
        }
      } catch {}
    }
    if (!localStorage.getItem(STORAGE_KEYS.CURRENT_USER)) {
      localStorage.setItem(STORAGE_KEYS.CURRENT_USER, JSON.stringify(INITIAL_USERS[0])); // Default to Admin
    } else {
      // If user storeId was old store-1/store-2, update to store-krg
      try {
        const u = JSON.parse(localStorage.getItem(STORAGE_KEYS.CURRENT_USER) || '{}');
        if (u.storeId === 'store-1' || !u.storeId || u.storeId === 'store-2') {
          u.storeId = 'store-krg';
          localStorage.setItem(STORAGE_KEYS.CURRENT_USER, JSON.stringify(u));
        }
      } catch {}
    }

    if (!localStorage.getItem(STORAGE_KEYS.ACTIVE_STORE)) {
      localStorage.setItem(STORAGE_KEYS.ACTIVE_STORE, JSON.stringify('store-krg'));
    } else {
      try {
        const active = JSON.parse(localStorage.getItem(STORAGE_KEYS.ACTIVE_STORE) || '""');
        if (active === 'store-1' || !INITIAL_STORES.some((s) => s.id === active)) {
          localStorage.setItem(STORAGE_KEYS.ACTIVE_STORE, JSON.stringify('store-krg'));
        }
      } catch {}
    }

    if (!localStorage.getItem(STORAGE_KEYS.PRINTER_SETTINGS)) {
      const defaultSettings: ThermalPrinterSettings = {
        connectionType: 'browser_print',
        printerLanguage: 'TSPL',
        paperWidthMm: 65,
        labelWidthMm: 65,
        labelHeightMm: 28,
        dpi: 203,
        darkness: 10,
        autoCut: true,
        feedLines: 2,
      };
      localStorage.setItem(STORAGE_KEYS.PRINTER_SETTINGS, JSON.stringify(defaultSettings));
    }

    // Run initial alert evaluation
    setTimeout(() => this.evaluateStockAlerts(), 500);
  }

  // Bidirectional Cross-Device Synchronization (Shared Server Store + Supabase Cloud)
  async syncWithRemoteStores(): Promise<void> {
    if (!this.isOnline() || this.isMutatingRemote) return;

    const localProducts = this.getProducts();
    const localCount = localProducts.length;
    const localFp = computeCatalogFingerprint(localProducts);

    const [serverRes, supabaseRes] = await Promise.all([
      serverCatalogService.fetchServerCatalog(),
      supabaseService.isConfigured()
        ? supabaseService.fetchAllProductsWithStatus()
        : Promise.resolve({ products: null, error: 'Not configured' }),
    ]);

    if (this.isMutatingRemote) return;

    const serverNorm =
      serverRes.ok && serverRes.products
        ? this.normalizeAndDeduplicateCatalog(serverRes.products)
        : null;
    const supabaseNorm =
      supabaseRes.products !== null
        ? this.normalizeAndDeduplicateCatalog(supabaseRes.products)
        : null;

    const serverProducts = serverNorm ? serverNorm.products : null;
    const supabaseProducts = supabaseNorm ? supabaseNorm.products : null;

    const serverCount = serverProducts ? serverProducts.length : 0;
    const supabaseCount = supabaseProducts ? supabaseProducts.length : 0;

    // 1. Choose the authoritative remote catalog if either Server or Supabase has data
    let bestRemoteProducts: Product[] | null = null;
    let bestRemoteSource: 'server' | 'supabase' | null = null;

    if (serverCount > 0 && supabaseCount > 0) {
      const serverFp = computeCatalogFingerprint(serverProducts!);
      const supabaseFp = computeCatalogFingerprint(supabaseProducts!);
      if (serverFp === supabaseFp) {
        bestRemoteProducts = serverProducts;
        bestRemoteSource = 'server';
      } else if (serverCount >= supabaseCount) {
        bestRemoteProducts = serverProducts;
        bestRemoteSource = 'server';
      } else {
        bestRemoteProducts = supabaseProducts;
        bestRemoteSource = 'supabase';
      }
    } else if (serverCount > 0) {
      bestRemoteProducts = serverProducts;
      bestRemoteSource = 'server';
    } else if (supabaseCount > 0) {
      bestRemoteProducts = supabaseProducts;
      bestRemoteSource = 'supabase';
    }

    // 2. Self-Healing Auto-Push:
    //    If this device already has the imported master catalog in IndexedDB (e.g. 10,133 items)
    //    and remote stores are empty (or only have < 50 demo items while local has > 100 items),
    //    automatically push this device's catalog to the remote stores so other devices receive it!
    const localHasMasterCatalog =
      localCount > 0 &&
      (bestRemoteProducts === null || (localCount > 100 && bestRemoteProducts.length < 50));

    if (localHasMasterCatalog) {
      if (serverRes.ok && serverCount < localCount) {
        await serverCatalogService.pushServerCatalog({
          mode: 'replace',
          products: localProducts,
          updatedAt: new Date().toISOString(),
        });
      }
      if (supabaseService.isConfigured() && supabaseCount < localCount) {
        await supabaseService.upsertProductsBatch(localProducts);
      }
      return;
    }

    // 3. Cross-Device Delivery & Overwrite:
    //    If remote has products and local is empty OR remote has a different fingerprint (updated prices/barcodes/items),
    //    update local storage & IndexedDB immediately.
    if (bestRemoteProducts && bestRemoteProducts.length > 0) {
      const remoteFp = computeCatalogFingerprint(bestRemoteProducts);
      if (localCount === 0 || remoteFp !== localFp) {
        await this.persistProductsAsync(bestRemoteProducts);
        if (typeof window !== 'undefined') {
          try {
            localStorage.setItem(STORAGE_KEYS.LOCAL_DATA_PURGED, 'true');
            localStorage.setItem(STORAGE_KEYS.LAST_CATALOG_SYNC_AT, new Date().toISOString());
          } catch {}
        }
        this.broadcastChange();
      }

      // Cross-heal between Server (/api/catalog) and Supabase Cloud if one was empty or out of sync
      if (bestRemoteSource === 'supabase' && serverRes.ok) {
        const serverFp = serverProducts ? computeCatalogFingerprint(serverProducts) : '0:0';
        if (serverFp !== remoteFp) {
          serverCatalogService
            .pushServerCatalog({
              mode: 'replace',
              products: bestRemoteProducts,
              updatedAt: new Date().toISOString(),
            })
            .catch(() => {});
        }
      } else if (bestRemoteSource === 'server' && supabaseService.isConfigured()) {
        const supabaseFp = supabaseProducts ? computeCatalogFingerprint(supabaseProducts) : '0:0';
        if (supabaseFp !== remoteFp) {
          supabaseService.upsertProductsBatch(bestRemoteProducts).catch(() => {});
        }
      }

      // If Supabase had any legacy corrupted UPC-A barcodes or duplicate rows, heal sequentially
      if (supabaseNorm && supabaseService.isConfigured()) {
        if (supabaseNorm.repairedProducts.length > 0) {
          await supabaseService.upsertProductsBatch(supabaseNorm.repairedProducts).catch(() => {});
        }
        if (supabaseNorm.obsoleteIds.length > 0) {
          await supabaseService.deleteProductsByIds(supabaseNorm.obsoleteIds).catch(() => {});
        }
      }
    }
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners() {
    this.listeners.forEach((fn) => fn());
  }

  private broadcastChange() {
    this.notifyListeners();
    if (this.channel) {
      this.channel.postMessage({ type: 'SYNC_EVENT', timestamp: Date.now() });
    }
  }

  // --- Network & Offline Status ---
  isSimulatedOffline(): boolean {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem(STORAGE_KEYS.SIMULATED_OFFLINE) === 'true';
  }

  setSimulatedOffline(offline: boolean) {
    localStorage.setItem(STORAGE_KEYS.SIMULATED_OFFLINE, offline ? 'true' : 'false');
    this.broadcastChange();
    if (!offline) {
      this.processOfflineQueue();
      this.syncWithRemoteStores().catch(() => {});
    }
  }

  isOnline(): boolean {
    if (this.isSimulatedOffline()) return false;
    if (typeof navigator === 'undefined') return true;
    return navigator.onLine !== false;
  }

  private handleNetworkRestored() {
    if (!this.isSimulatedOffline()) {
      this.processOfflineQueue();
      this.syncWithRemoteStores().catch(() => {});
    }
  }

  // --- Products Management ---
  getProducts(): Product[] {
    if (this.memoryProducts !== null) {
      return this.memoryProducts;
    }
    try {
      const data = localStorage.getItem(STORAGE_KEYS.PRODUCTS);
      if (data) {
        const parsed = JSON.parse(data);
        const normalized = this.normalizeAndDeduplicateCatalog(Array.isArray(parsed) ? parsed : []);
        this.memoryProducts = normalized.products;
        return this.memoryProducts;
      }
      this.memoryProducts = [];
      return this.memoryProducts;
    } catch {
      this.memoryProducts = [];
      return this.memoryProducts;
    }
  }

  // Detect if the catalog still contains the old local dummy data (e.g. BONELESS PAHA FZ/ KG SKU 50007)
  isUsingLegacyLocalDemoData(): boolean {
    const prods = this.getProducts();
    if (prods.length === 0 || prods.length > 50) return false;
    return prods.some(
      (p) =>
        p.id === 'prod-1' ||
        p.id === 'prod-fresh-1' ||
        p.sku === '50007' ||
        p.name.includes('BONELESS PAHA FZ/ KG')
    );
  }

  // Mitigasi Data Lokal Lama: Bersihkan seluruh data lokal (localStorage & IndexedDB) agar murni memakai Supabase / Master Import
  async clearLocalCatalog(clearSupabaseAlso: boolean = false): Promise<void> {
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(STORAGE_KEYS.LOCAL_DATA_PURGED, 'true');
        localStorage.removeItem(STORAGE_KEYS.PRODUCTS);
        localStorage.removeItem(STORAGE_KEYS.ALERTS);
      } catch {}
    }
    this.memoryProducts = [];
    await idbClearProducts();
    if (clearSupabaseAlso && this.isOnline()) {
      await Promise.all([
        serverCatalogService.clearServerCatalog().catch(() => false),
        supabaseService.isConfigured()
          ? supabaseService.deleteAllProducts().catch(() => false)
          : Promise.resolve(false),
      ]);
    }
    this.broadcastChange();
  }

  getProductById(id: string): Product | undefined {
    return this.getProducts().find((p) => p.id === id);
  }

  findProductByBarcode(barcode: string): Product | undefined {
    const clean = barcode
      .replace(/[\u0000-\u001F\u007F\u200B-\u200D\uFEFF]/g, '')
      .trim()
      .toLowerCase();
    if (!clean) return undefined;

    const products = this.getProducts();

    // Build candidate lookup keys (exact + GS1 AI (01) GTIN-14 extraction)
    const candidates = new Set<string>([clean]);
    const gs1GtinMatch = clean.match(/(?:\(01\)|^01)(\d{14})/);
    if (gs1GtinMatch) {
      const gtin14 = gs1GtinMatch[1];
      candidates.add(gtin14);
      candidates.add(gtin14.replace(/^0+/, ''));
      if (gtin14.startsWith('0')) {
        candidates.add(gtin14.slice(1));
      }
    }

    for (const candidate of candidates) {
      const exactBarcodeMatch = products.find((p) => p.barcode.trim().toLowerCase() === candidate);
      if (exactBarcodeMatch) return exactBarcodeMatch;
    }

    for (const candidate of candidates) {
      const exactSkuMatch = products.find((p) => p.sku.trim().toLowerCase() === candidate);
      if (exactSkuMatch) return exactSkuMatch;
    }

    // 2. Fallback for UPC-A / EAN-13 leading-zero differences between laptop & Android PDA scanners
    for (const candidate of candidates) {
      if (/^\d{6,}$/.test(candidate)) {
        const strippedClean = candidate.replace(/^0+/, '');
        if (strippedClean.length >= 6) {
          const bcMatch = products.find((p) => {
            const b = p.barcode.trim().toLowerCase();
            return /^\d{6,}$/.test(b) && b.replace(/^0+/, '') === strippedClean;
          });
          if (bcMatch) return bcMatch;

          const skuMatch = products.find((p) => {
            const s = p.sku.trim().toLowerCase();
            return /^\d{6,}$/.test(s) && s.replace(/^0+/, '') === strippedClean;
          });
          if (skuMatch) return skuMatch;
        }
      }
    }

    return undefined;
  }

  saveProduct(product: Product): Product {
    const products = [...this.getProducts()];
    const existingIndex = products.findIndex((p) => p.id === product.id);

    if (existingIndex >= 0) {
      products[existingIndex] = product;
    } else {
      products.unshift(product);
    }

    this.persistProducts(products);

    if (this.isOnline()) {
      serverCatalogService
        .pushServerCatalog({
          mode: 'upsert',
          products: [product],
          updatedAt: new Date().toISOString(),
        })
        .catch(() => {});
      if (supabaseService.isConfigured()) {
        supabaseService.upsertSingleProduct(product).catch(() => {});
      }
    } else {
      this.enqueueOfflineItem({
        id: `queue-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        type: 'PRODUCT_UPDATE',
        payload: product,
        timestamp: Date.now(),
        status: 'QUEUED',
      });
    }

    this.evaluateStockAlerts();
    this.broadcastChange();
    return product;
  }

  deleteProduct(productId: string) {
    const products = this.getProducts().filter((p) => p.id !== productId);
    this.persistProducts(products);
    if (this.isOnline()) {
      serverCatalogService
        .pushServerCatalog({
          mode: 'upsert',
          products: [],
          deletedIds: [productId],
          updatedAt: new Date().toISOString(),
        })
        .catch(() => {});
      if (supabaseService.isConfigured()) {
        supabaseService.deleteSingleProduct(productId).catch(() => {});
      }
    }
    this.broadcastChange();
  }

  // --- Stock Adjustments & Real-Time Sync ---
  adjustStock(
    productId: string,
    storeId: string,
    newQuantity: number,
    reason: StockAdjustment['reason'],
    userName: string
  ): ProductStock {
    const products = [...this.getProducts()];
    const product = products.find((p) => p.id === productId);
    if (!product) throw new Error('Product not found');

    const prevStock = product.stocks[storeId]?.quantity ?? 0;
    const minThreshold = product.stocks[storeId]?.minThreshold ?? 20;

    const updatedStock: ProductStock = {
      storeId,
      quantity: Math.max(0, newQuantity),
      minThreshold,
      lastUpdated: new Date().toISOString(),
    };

    product.stocks[storeId] = updatedStock;
    this.persistProducts(products);

    if (this.isOnline()) {
      serverCatalogService
        .pushServerCatalog({
          mode: 'upsert',
          products: [product],
          updatedAt: new Date().toISOString(),
        })
        .catch(() => {});
      if (supabaseService.isConfigured()) {
        supabaseService.upsertSingleProduct(product).catch(() => {});
      }
    }

    // Log adjustment transaction
    const adjustment: StockAdjustment = {
      id: `adj-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      storeId,
      productId,
      productName: product.name,
      sku: product.sku,
      previousQty: prevStock,
      newQty: newQuantity,
      delta: newQuantity - prevStock,
      reason,
      performedBy: userName,
      timestamp: new Date().toISOString(),
    };

    const adjustments = this.getAdjustments();
    adjustments.unshift(adjustment);
    try {
      localStorage.setItem(STORAGE_KEYS.ADJUSTMENTS, JSON.stringify(adjustments.slice(0, 300)));
    } catch {}

    if (!this.isOnline()) {
      this.enqueueOfflineItem({
        id: `queue-adj-${Date.now()}`,
        type: 'STOCK_ADJUSTMENT',
        payload: adjustment,
        timestamp: Date.now(),
        status: 'QUEUED',
      });
    }

    this.evaluateStockAlerts();
    this.broadcastChange();
    return updatedStock;
  }

  // Inter-Store Stock Transfer
  transferStock(
    fromStoreId: string,
    toStoreId: string,
    productId: string,
    quantity: number,
    userName: string
  ): StockTransfer {
    const products = [...this.getProducts()];
    const product = products.find((p) => p.id === productId);
    if (!product) throw new Error('Product not found');

    const sourceQty = product.stocks[fromStoreId]?.quantity ?? 0;
    if (sourceQty < quantity) {
      throw new Error(`Insufficient stock in origin store (${sourceQty} available)`);
    }

    // Deduct from source, add to destination
    const fromStock = product.stocks[fromStoreId];
    if (fromStock) {
      fromStock.quantity -= quantity;
      fromStock.lastUpdated = new Date().toISOString();
    }

    if (!product.stocks[toStoreId]) {
      product.stocks[toStoreId] = {
        storeId: toStoreId,
        quantity: 0,
        minThreshold: 20,
        lastUpdated: new Date().toISOString(),
      };
    }
    product.stocks[toStoreId].quantity += quantity;
    product.stocks[toStoreId].lastUpdated = new Date().toISOString();

    this.persistProducts(products);
    if (this.isOnline()) {
      serverCatalogService
        .pushServerCatalog({
          mode: 'upsert',
          products: [product],
          updatedAt: new Date().toISOString(),
        })
        .catch(() => {});
      if (supabaseService.isConfigured()) {
        supabaseService.upsertSingleProduct(product).catch(() => {});
      }
    }

    const transfer: StockTransfer = {
      id: `trf-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      fromStoreId,
      toStoreId,
      productId,
      productName: product.name,
      sku: product.sku,
      quantity,
      status: 'COMPLETED',
      initiatedBy: userName,
      timestamp: new Date().toISOString(),
    };

    const transfers = this.getTransfers();
    transfers.unshift(transfer);
    localStorage.setItem(STORAGE_KEYS.TRANSFERS, JSON.stringify(transfers.slice(0, 200)));

    if (!this.isOnline()) {
      this.enqueueOfflineItem({
        id: `queue-trf-${Date.now()}`,
        type: 'STOCK_TRANSFER',
        payload: transfer,
        timestamp: Date.now(),
        status: 'QUEUED',
      });
    }

    this.evaluateStockAlerts();
    this.broadcastChange();
    return transfer;
  }

  getAdjustments(): StockAdjustment[] {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.ADJUSTMENTS);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  getTransfers(): StockTransfer[] {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.TRANSFERS);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  // --- Offline Sync Queue ---
  getOfflineQueue(): SyncQueueItem[] {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.OFFLINE_QUEUE);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  private enqueueOfflineItem(item: SyncQueueItem) {
    const queue = this.getOfflineQueue();
    queue.push(item);
    localStorage.setItem(STORAGE_KEYS.OFFLINE_QUEUE, JSON.stringify(queue));
    this.broadcastChange();
  }

  async processOfflineQueue(): Promise<{ syncedCount: number }> {
    const queue = this.getOfflineQueue();
    if (queue.length === 0) return { syncedCount: 0 };

    const syncedCount = queue.length;
    localStorage.removeItem(STORAGE_KEYS.OFFLINE_QUEUE);
    this.broadcastChange();

    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
      new Notification('Cloud Synchronization Completed', {
        body: `${syncedCount} queued inventory update(s) successfully synced across all store locations.`,
        icon: '/icon-192.svg',
      });
    }

    return { syncedCount };
  }

  // --- Low-Stock Push Alerts & Notification System ---
  getAlerts(): LowStockAlert[] {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.ALERTS);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  markAlertAsRead(alertId: string) {
    const alerts = this.getAlerts();
    const alert = alerts.find((a) => a.id === alertId);
    if (alert) {
      alert.isRead = true;
      localStorage.setItem(STORAGE_KEYS.ALERTS, JSON.stringify(alerts));
      this.broadcastChange();
    }
  }

  markAllAlertsAsRead() {
    const alerts = this.getAlerts().map((a) => ({ ...a, isRead: true }));
    localStorage.setItem(STORAGE_KEYS.ALERTS, JSON.stringify(alerts));
    this.broadcastChange();
  }

  clearAlerts() {
    localStorage.removeItem(STORAGE_KEYS.ALERTS);
    this.broadcastChange();
  }

  evaluateStockAlerts() {
    const products = this.getProducts();
    const stores = this.getStores();
    const existingAlerts = this.getAlerts();
    const newAlerts: LowStockAlert[] = [...existingAlerts];
    let triggeredNew = false;

    const today = new Date().toISOString().split('T')[0];
    const existingAlertKeys = new Set(
      existingAlerts
        .filter((a) => a.timestamp.startsWith(today))
        .map((a) => `${a.productId}__${a.storeId}`)
    );

    // Cap alert scan to avoid generating thousands of alerts when 10,000 items are imported
    const sampleProducts = products.slice(0, 200);

    for (const product of sampleProducts) {
      if (newAlerts.length >= 100) break;
      for (const store of stores) {
        const stock = product.stocks[store.id];
        const currentQty = stock?.quantity ?? 0;
        const threshold = stock?.minThreshold ?? 20;

        if (currentQty <= threshold) {
          const alertKey = `${product.id}__${store.id}`;
          if (!existingAlertKeys.has(alertKey)) {
            existingAlertKeys.add(alertKey);
            const alert: LowStockAlert = {
              id: `alert-${product.id}-${store.id}-${Date.now()}`,
              productId: product.id,
              productName: product.name,
              sku: product.sku,
              barcode: product.barcode,
              storeId: store.id,
              storeName: store.name,
              currentStock: currentQty,
              minThreshold: threshold,
              timestamp: new Date().toISOString(),
              isRead: false,
            };
            newAlerts.unshift(alert);
            triggeredNew = true;
          }
        }
      }
    }

    if (triggeredNew) {
      try {
        localStorage.setItem(STORAGE_KEYS.ALERTS, JSON.stringify(newAlerts.slice(0, 100)));
      } catch {}
      audioService.playAlertTone();
      this.broadcastChange();
    }
  }

  // --- Stores ---
  getStores(): StoreLocation[] {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.STORES);
      return data ? JSON.parse(data) : INITIAL_STORES;
    } catch {
      return INITIAL_STORES;
    }
  }

  getActiveStoreId(): string {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEYS.ACTIVE_STORE) || '"store-krg"');
    } catch {
      return 'store-krg';
    }
  }

  setActiveStoreId(storeId: string) {
    localStorage.setItem(STORAGE_KEYS.ACTIVE_STORE, JSON.stringify(storeId));
    this.broadcastChange();
  }

  private cloneProductForSnapshot(p: Product): Product {
    const clonedStocks: Record<string, ProductStock> = {};
    if (p.stocks) {
      for (const [storeId, st] of Object.entries(p.stocks)) {
        clonedStocks[storeId] = { ...st };
      }
    }
    return {
      ...p,
      pricing: { ...p.pricing },
      stocks: clonedStocks,
      promotionalDiscount: p.promotionalDiscount ? { ...p.promotionalDiscount } : undefined,
    };
  }

  private prepareImportMutation(
    records: ImportProductRecord[],
    targetStoreId: string,
    updateExisting: boolean,
    replaceAllLocal: boolean,
    sourceProducts: Product[]
  ): {
    added: number;
    updated: number;
    skipped: number;
    duplicatesMerged: number;
    finalProducts: Product[];
    touchedProducts: Product[];
    removedIds: string[];
  } {
    const existingProducts = replaceAllLocal
      ? []
      : sourceProducts.map((p) => this.cloneProductForSnapshot(p));
    const stores = this.getStores();
    let added = 0;
    let updated = 0;
    let skipped = 0;
    let duplicatesMerged = 0;

    // Build O(1) hash maps so importing 10,000+ rows executes in < 100ms without freezing browser
    const skuMap = new Map<string, Product>();
    const skuNormalizedMap = new Map<string, Product>();
    const skuAllMatchesMap = new Map<string, Product[]>();
    const barcodeMap = new Map<string, Product>();
    const barcodeNormalizedMap = new Map<string, Product>();
    const nameMap = new Map<string, Product>();

    existingProducts.forEach((p) => {
      if (p.sku) {
        const skuLower = p.sku.trim().toLowerCase();
        if (skuLower) {
          const list = skuAllMatchesMap.get(skuLower);
          if (list) {
            list.push(p);
          } else {
            skuAllMatchesMap.set(skuLower, [p]);
            skuMap.set(skuLower, p);
          }
          const normSku = normalizeLooseSku(p.sku);
          if (normSku && !skuNormalizedMap.has(normSku)) {
            skuNormalizedMap.set(normSku, p);
          }
        }
      }
      if (p.barcode) {
        const bcLower = p.barcode.trim().toLowerCase();
        if (bcLower && !barcodeMap.has(bcLower)) barcodeMap.set(bcLower, p);
        const normBc = normalizeBarcodeLookup(p.barcode);
        if (normBc && !barcodeNormalizedMap.has(normBc)) barcodeNormalizedMap.set(normBc, p);
      }
      if (p.name) {
        const normName = p.name.replace(/\s+/g, ' ').trim().toLowerCase();
        if (normName && !nameMap.has(normName)) nameMap.set(normName, p);
      }
    });

    const newProductsToPrepend: Product[] = [];
    const touchedById = new Map<string, Product>();
    const removedProductsSet = new Set<Product>();
    const removedIdSet = new Set<string>();
    const batchSeenKeys = new Set<string>();
    const nowIso = new Date().toISOString();
    const todayFormatted = new Date().toLocaleDateString('en-GB');
    const batchTimestamp = Date.now();

    records.forEach((rec, idx) => {
      let cleanName = rec.name ? rec.name.trim().replace(/^["']+|["']+$/g, '').trim() : '';
      let rawSku = rec.sku ? rec.sku.trim() : '';
      if (!cleanName && rawSku) {
        cleanName = `ITEM SKU ${rawSku}`;
      }
      if (!cleanName) {
        skipped++;
        return;
      }

      let rawBarcode = rec.barcode ? rec.barcode.trim() : '';
      let unitPrice =
        typeof rec.price === 'number' && !isNaN(rec.price) && isFinite(rec.price)
          ? Math.max(0, Math.round(rec.price))
          : 0;
      let rawCategory = rec.category ? rec.category.trim() : '';
      let rawStock = rec.stock;

      if (cleanName.includes(';') && cleanName.split(';').length >= 3) {
        const parts = cleanName.split(';').map((s) => s.trim());
        cleanName = parts[0] || cleanName;
        if (parts[1] && !rawBarcode) rawBarcode = parts[1];
        if (parts[2] && unitPrice === 0) {
          const parsedP = parseInt(parts[2].replace(/[^0-9]/g, ''), 10);
          if (!isNaN(parsedP)) unitPrice = parsedP;
        }
        if (parts[3] && !rawSku) rawSku = parts[3];
        if (parts[4] && (!rawCategory || rawCategory === 'Grocery')) rawCategory = parts[4];
        if (parts[5] !== undefined && parts[5] !== '') {
          const parsedS = Math.round(parseFloat(parts[5].replace(',', '.')));
          if (!isNaN(parsedS)) rawStock = Math.max(0, parsedS);
        }
      }

      cleanName = cleanName.replace(/;+$/g, '').replace(/\s+/g, ' ').trim();
      if (!cleanName) {
        skipped++;
        return;
      }

      const normalizedCat = normalizeCategoryName(rawCategory);
      const safeStock =
        rawStock !== undefined && !isNaN(rawStock) && isFinite(rawStock)
          ? Math.max(0, Math.round(rawStock))
          : undefined;
      const barcodeProvided = rec.barcodeProvided ?? hasActualBarcode(rawBarcode);
      const preliminaryBarcode =
        barcodeProvided && rawBarcode ? sanitizeBarcodeValue(rawBarcode, rawSku || cleanName) : '';
      const normalizedNameKey = cleanName.replace(/\s+/g, ' ').trim().toLowerCase();

      const batchKey = rawSku
        ? `sku:${rawSku.toLowerCase()}`
        : preliminaryBarcode
          ? `bc:${preliminaryBarcode.toLowerCase()}`
          : `name:${cleanName.toLowerCase()}`;

      const isIntraFileDuplicate = batchSeenKeys.has(batchKey);
      if (isIntraFileDuplicate) {
        duplicatesMerged++;
      }
      batchSeenKeys.add(batchKey);

      // O(1) lookup: match by SKU first; only fall back to barcode/name if SKU is empty or target lacks an SKU
      let matchedProd: Product | undefined;
      if (rawSku) {
        matchedProd =
          skuMap.get(rawSku.trim().toLowerCase()) ||
          skuNormalizedMap.get(normalizeLooseSku(rawSku));
        if (!matchedProd) {
          const bcCandidate = preliminaryBarcode
            ? barcodeMap.get(preliminaryBarcode.toLowerCase()) ||
              barcodeNormalizedMap.get(normalizeBarcodeLookup(preliminaryBarcode))
            : undefined;
          const nameCandidate = nameMap.get(normalizedNameKey);
          if (bcCandidate && !bcCandidate.sku?.trim()) {
            matchedProd = bcCandidate;
          } else if (nameCandidate && !nameCandidate.sku?.trim()) {
            matchedProd = nameCandidate;
          }
        }
      } else {
        matchedProd =
          (preliminaryBarcode
            ? barcodeMap.get(preliminaryBarcode.toLowerCase()) ||
              barcodeNormalizedMap.get(normalizeBarcodeLookup(preliminaryBarcode))
            : undefined) || nameMap.get(normalizedNameKey);
      }

      if (matchedProd) {
        if (updateExisting || isIntraFileDuplicate) {
          matchedProd.name = cleanName.toUpperCase();
          nameMap.set(normalizedNameKey, matchedProd);

          if (rawSku) {
            const skuLower = rawSku.trim().toLowerCase();
            const canonicalId = `prod-sku-${rawSku.replace(/[^a-zA-Z0-9_-]/g, '')}`;
            // Prune any ghost duplicates in catalog sharing the exact same SKU
            const sameSkuList = skuAllMatchesMap.get(skuLower);
            if (sameSkuList && sameSkuList.length > 1) {
              for (const dup of sameSkuList) {
                if (dup !== matchedProd) {
                  removedProductsSet.add(dup);
                  if (dup.id) {
                    removedIdSet.add(dup.id);
                  }
                  touchedById.delete(dup.id);
                }
              }
              skuAllMatchesMap.set(skuLower, [matchedProd]);
            }
            matchedProd.sku = rawSku;
            // Preserve existing ID so Supabase ON CONFLICT (id) updates in-place; only replace legacy demo IDs
            if (!matchedProd.id || LEGACY_DEMO_IDS.has(matchedProd.id)) {
              if (matchedProd.id) {
                removedIdSet.add(matchedProd.id);
                touchedById.delete(matchedProd.id);
              }
              matchedProd.id = canonicalId;
            }
            skuMap.set(skuLower, matchedProd);
            skuNormalizedMap.set(normalizeLooseSku(rawSku), matchedProd);
          }

          // Excel / item list is the primary source of truth: overwrite barcode verbatim when provided
          if (barcodeProvided && hasActualBarcode(rawBarcode)) {
            const cleanedImportBarcode = sanitizeBarcodeValue(rawBarcode, matchedProd.sku || cleanName);
            const newBarcodeKey = cleanedImportBarcode.toLowerCase();
            const newNormBarcodeKey = normalizeBarcodeLookup(cleanedImportBarcode);
            const existingBarcode = (matchedProd.barcode || '').toLowerCase();
            const existingNormBarcode = normalizeBarcodeLookup(matchedProd.barcode || '');

            if (
              existingBarcode &&
              existingBarcode !== newBarcodeKey &&
              barcodeMap.get(existingBarcode) === matchedProd
            ) {
              barcodeMap.delete(existingBarcode);
            }
            if (
              existingNormBarcode &&
              existingNormBarcode !== newNormBarcodeKey &&
              barcodeNormalizedMap.get(existingNormBarcode) === matchedProd
            ) {
              barcodeNormalizedMap.delete(existingNormBarcode);
            }

            matchedProd.barcode = cleanedImportBarcode;
            matchedProd.barcodeType = detectBarcodeType(cleanedImportBarcode);
            barcodeMap.set(newBarcodeKey, matchedProd);
            if (newNormBarcodeKey) barcodeNormalizedMap.set(newNormBarcodeKey, matchedProd);
          } else if (!hasActualBarcode(matchedProd.barcode)) {
            matchedProd.barcode = sanitizeBarcodeValue(matchedProd.barcode, matchedProd.sku || cleanName);
            matchedProd.barcodeType = detectBarcodeType(matchedProd.barcode);
            barcodeMap.set(matchedProd.barcode.toLowerCase(), matchedProd);
            const normBc = normalizeBarcodeLookup(matchedProd.barcode);
            if (normBc) barcodeNormalizedMap.set(normBc, matchedProd);
          } else {
            matchedProd.barcodeType = detectBarcodeType(matchedProd.barcode);
          }

          // Overwrite old/un-updated prices; only preserve existing non-zero price if the new cell was completely blank
          if (unitPrice > 0 || rec.priceProvided !== false || matchedProd.pricing.unitPrice === 0) {
            matchedProd.pricing.unitPrice = unitPrice;
            if (!rec.bulkPrice) {
              matchedProd.pricing.bulkPrice = unitPrice > 0 ? Math.round(unitPrice * 22) : 0;
            }
          }
          if (rec.bulkPrice !== undefined && rec.bulkPrice > 0) {
            matchedProd.pricing.bulkPrice = Math.round(rec.bulkPrice);
          }
          if (rec.bulkQuantity !== undefined && rec.bulkQuantity > 0) {
            matchedProd.pricing.bulkQuantity = Math.round(rec.bulkQuantity);
          }
          if (rec.bulkLabel) matchedProd.pricing.bulkLabel = rec.bulkLabel.toUpperCase();
          if (rawCategory) {
            matchedProd.category = normalizedCat;
            matchedProd.department = rec.department || `${normalizedCat} / General`;
          } else if (rec.department) {
            matchedProd.department = rec.department;
          }
          if (rec.brand) matchedProd.brand = rec.brand;
          if (rec.supplier) matchedProd.supplier = rec.supplier;
          matchedProd.dateEffective = rec.dateEffective || todayFormatted;
          if (rec.unitLabel) matchedProd.pricing.unitLabel = rec.unitLabel.toUpperCase();

          if (safeStock !== undefined) {
            if (!matchedProd.stocks[targetStoreId]) {
              matchedProd.stocks[targetStoreId] = {
                storeId: targetStoreId,
                quantity: safeStock,
                minThreshold: rec.minThreshold ?? 20,
                lastUpdated: nowIso,
              };
            } else {
              matchedProd.stocks[targetStoreId].quantity = safeStock;
              if (rec.minThreshold !== undefined) matchedProd.stocks[targetStoreId].minThreshold = rec.minThreshold;
              matchedProd.stocks[targetStoreId].lastUpdated = nowIso;
            }
          }
          const alreadyUpdatedInBatch = touchedById.has(matchedProd.id);
          touchedById.set(matchedProd.id, matchedProd);
          if (!alreadyUpdatedInBatch) {
            updated++;
          }
        } else {
          skipped++;
        }
      } else {
        const newSku = rawSku || `100${Math.floor(10000 + Math.random() * 90000)}`;
        const cleanBarcode = sanitizeBarcodeValue(rawBarcode, newSku || cleanName);
        const initialStocks: Record<string, ProductStock> = {};

        stores.forEach((store) => {
          const isTarget = store.id === targetStoreId;
          const qty = isTarget ? (safeStock !== undefined ? safeStock : 50) : 35;
          initialStocks[store.id] = {
            storeId: store.id,
            quantity: qty,
            minThreshold: rec.minThreshold ?? 20,
            lastUpdated: nowIso,
          };
        });

        // Deterministic ID based on SKU when available so Supabase upsert never duplicates items
        const deterministicId = rawSku
          ? `prod-sku-${rawSku.replace(/[^a-zA-Z0-9_-]/g, '')}`
          : `prod-${batchTimestamp}-${idx}-${Math.random().toString(36).substring(2, 6)}`;

        const newProd: Product = {
          id: deterministicId,
          sku: newSku,
          barcode: cleanBarcode,
          barcodeType: detectBarcodeType(cleanBarcode),
          name: cleanName.toUpperCase(),
          category: normalizedCat,
          brand: rec.brand || rec.supplier || 'General',
          department: rec.department || `${normalizedCat} / General`,
          currency: 'Rp.',
          pricing: {
            unitLabel: (rec.unitLabel || 'PCS').toUpperCase(),
            unitQuantity: 1,
            unitPrice,
            bulkLabel: (rec.bulkLabel || 'CRT').toUpperCase(),
            bulkQuantity: rec.bulkQuantity || 24,
            bulkPrice:
              rec.bulkPrice && rec.bulkPrice > 0
                ? Math.round(rec.bulkPrice)
                : unitPrice > 0
                  ? Math.round(unitPrice * 22)
                  : 0,
          },
          stocks: initialStocks,
          dateEffective: rec.dateEffective || todayFormatted,
          supplier: rec.supplier,
          locationBin: 'A-01-01',
        };

        newProductsToPrepend.push(newProd);
        touchedById.set(newProd.id, newProd);
        const skuLower = newSku.toLowerCase();
        skuMap.set(skuLower, newProd);
        skuNormalizedMap.set(normalizeLooseSku(newSku), newProd);
        skuAllMatchesMap.set(skuLower, [newProd]);
        barcodeMap.set(cleanBarcode.toLowerCase(), newProd);
        const normBc = normalizeBarcodeLookup(cleanBarcode);
        if (normBc) barcodeNormalizedMap.set(normBc, newProd);
        nameMap.set(normalizedNameKey, newProd);
        added++;
      }
    });

    const filteredExisting =
      removedProductsSet.size > 0
        ? existingProducts.filter((p) => !removedProductsSet.has(p))
        : existingProducts;
    const finalProducts = [...newProductsToPrepend, ...filteredExisting];
    for (const prod of finalProducts) {
      removedIdSet.delete(prod.id);
    }
    return {
      added,
      updated,
      skipped,
      duplicatesMerged,
      finalProducts,
      touchedProducts: Array.from(touchedById.values()),
      removedIds: Array.from(removedIdSet),
    };
  }

  // --- Bulk Product Import (Supports 10,000 - 100,000+ Items with O(1) Lookup & IndexedDB + Server + Supabase) ---
  importProducts(
    records: ImportProductRecord[],
    targetStoreId: string = 'store-krg',
    updateExisting: boolean = true,
    replaceAllLocal: boolean = false,
    syncToCloud: boolean = true
  ): { added: number; updated: number; products: Product[]; touchedProducts: Product[] } {
    if (replaceAllLocal && typeof window !== 'undefined') {
      try {
        localStorage.setItem(STORAGE_KEYS.LOCAL_DATA_PURGED, 'true');
      } catch {}
    }

    const prepared = this.prepareImportMutation(
      records,
      targetStoreId,
      updateExisting,
      replaceAllLocal,
      this.getProducts()
    );

    this.persistProducts(prepared.finalProducts);

    if (syncToCloud && this.isOnline() && prepared.touchedProducts.length > 0) {
      serverCatalogService
        .pushServerCatalog({
          mode: replaceAllLocal ? 'replace' : 'upsert',
          products: replaceAllLocal ? prepared.finalProducts : prepared.touchedProducts,
          deletedIds: prepared.removedIds,
          updatedAt: new Date().toISOString(),
        })
        .catch(() => {});

      if (supabaseService.isConfigured()) {
        supabaseService
          .upsertProductsBatch(prepared.touchedProducts)
          .then(async (res) => {
            if (res.ok && prepared.removedIds.length > 0) {
              await supabaseService.deleteProductsByIds(prepared.removedIds);
            }
            if (res.ok && replaceAllLocal) {
              const remoteIds = await supabaseService.fetchAllProductIds();
              if (remoteIds) {
                const keepSet = new Set(prepared.finalProducts.map((p) => p.id));
                const staleIds = remoteIds.filter((id) => !keepSet.has(id));
                if (staleIds.length > 0) {
                  await supabaseService.deleteProductsByIds(staleIds);
                }
              }
            }
          })
          .catch(() => {});
      }
    }

    this.evaluateStockAlerts();
    this.broadcastChange();

    return {
      added: prepared.added,
      updated: prepared.updated,
      products: prepared.finalProducts,
      touchedProducts: prepared.touchedProducts,
    };
  }

  // Transactional Bulk Import with pre-commit validation, deep state snapshot, and Shared Server + Supabase Cloud sync
  async importProductsTransactional(
    records: ImportProductRecord[],
    targetStoreId: string = 'store-krg',
    updateExisting: boolean = true,
    replaceAllLocal: boolean = false,
    syncToCloud: boolean = true,
    onProgress?: (completed: number, total: number) => void
  ): Promise<ImportTransactionResult> {
    if (!Array.isArray(records) || records.length === 0) {
      return {
        ok: false,
        added: 0,
        updated: 0,
        skipped: 0,
        duplicatesMerged: 0,
        cloudSynced: 0,
        cloudAttempted: false,
        rolledBack: false,
        error: 'Tidak ada baris produk valid untuk diimpor.',
        products: this.getProducts(),
      };
    }

    const hasWindow = typeof window !== 'undefined';
    const prevProductsSnapshot = this.getProducts().map((p) => this.cloneProductForSnapshot(p));
    const prevPurgedFlag = hasWindow ? localStorage.getItem(STORAGE_KEYS.LOCAL_DATA_PURGED) : null;
    const prevAlertsRaw = hasWindow ? localStorage.getItem(STORAGE_KEYS.ALERTS) : null;

    const restoreLocalSnapshot = async () => {
      if (hasWindow) {
        try {
          if (prevPurgedFlag === null) {
            localStorage.removeItem(STORAGE_KEYS.LOCAL_DATA_PURGED);
          } else {
            localStorage.setItem(STORAGE_KEYS.LOCAL_DATA_PURGED, prevPurgedFlag);
          }
          if (prevAlertsRaw === null) {
            localStorage.removeItem(STORAGE_KEYS.ALERTS);
          } else {
            localStorage.setItem(STORAGE_KEYS.ALERTS, prevAlertsRaw);
          }
        } catch {}
      }
      await this.persistProductsAsync(prevProductsSnapshot);
      this.broadcastChange();
    };

    this.isMutatingRemote = true;
    try {
      const prepared = this.prepareImportMutation(
        records,
        targetStoreId,
        updateExisting,
        replaceAllLocal,
        prevProductsSnapshot
      );

      if (prepared.added === 0 && prepared.updated === 0 && prepared.skipped === 0) {
        return {
          ok: false,
          added: 0,
          updated: 0,
          skipped: prepared.skipped,
          duplicatesMerged: prepared.duplicatesMerged,
          cloudSynced: 0,
          cloudAttempted: false,
          rolledBack: false,
          error: 'Semua baris gagal validasi field wajib (Item Name / SKU). Import dibatalkan.',
          products: prevProductsSnapshot,
        };
      }

      if (replaceAllLocal && hasWindow) {
        try {
          localStorage.setItem(STORAGE_KEYS.LOCAL_DATA_PURGED, 'true');
        } catch {}
      }

      await this.persistProductsAsync(prepared.finalProducts);

      let cloudSynced = 0;
      let cloudAttempted = false;
      let serverSyncedOk = false;

      if (syncToCloud && this.isOnline() && prepared.touchedProducts.length > 0) {
        const mutationIso = new Date().toISOString();

        // 1. Push to Shared Server Catalog (/api/catalog) for instant LAN / multi-device sync
        serverSyncedOk = await serverCatalogService.pushServerCatalog({
          mode: replaceAllLocal ? 'replace' : 'upsert',
          products: replaceAllLocal ? prepared.finalProducts : prepared.touchedProducts,
          deletedIds: prepared.removedIds,
          updatedAt: mutationIso,
        });

        // 2. Push to Supabase Cloud
        if (supabaseService.isConfigured()) {
          cloudAttempted = true;
          const cloudRes = await supabaseService.upsertProductsBatch(
            prepared.touchedProducts,
            onProgress
          );

          if (!cloudRes.ok) {
            this.evaluateStockAlerts();
            this.broadcastChange();

            return {
              ok: true,
              added: prepared.added,
              updated: prepared.updated,
              skipped: prepared.skipped,
              duplicatesMerged: prepared.duplicatesMerged,
              cloudSynced: serverSyncedOk ? prepared.touchedProducts.length : cloudRes.synced || 0,
              cloudAttempted: true,
              rolledBack: false,
              error: serverSyncedOk ? undefined : cloudRes.error,
              products: prepared.finalProducts,
            };
          }

          cloudSynced = cloudRes.synced;

          // Clean up duplicate SKU rows and, when replacing the entire catalog, any obsolete remote IDs
          const idsToDelete = new Set<string>(prepared.removedIds);
          if (replaceAllLocal) {
            const remoteIds = await supabaseService.fetchAllProductIds();
            if (remoteIds) {
              const keepSet = new Set(prepared.finalProducts.map((p) => p.id));
              for (const rid of remoteIds) {
                if (!keepSet.has(rid)) idsToDelete.add(rid);
              }
            }
          }
          if (idsToDelete.size > 0) {
            await supabaseService.deleteProductsByIds(Array.from(idsToDelete));
          }
        } else if (serverSyncedOk) {
          cloudAttempted = true;
          cloudSynced = prepared.touchedProducts.length;
        }
      }

      if (hasWindow) {
        try {
          localStorage.setItem(STORAGE_KEYS.LAST_CATALOG_SYNC_AT, new Date().toISOString());
        } catch {}
      }

      this.evaluateStockAlerts();
      this.broadcastChange();

      return {
        ok: true,
        added: prepared.added,
        updated: prepared.updated,
        skipped: prepared.skipped,
        duplicatesMerged: prepared.duplicatesMerged,
        cloudSynced,
        cloudAttempted,
        rolledBack: false,
        products: prepared.finalProducts,
      };
    } catch (err: any) {
      await restoreLocalSnapshot();
      return {
        ok: false,
        added: 0,
        updated: 0,
        skipped: 0,
        duplicatesMerged: 0,
        cloudSynced: 0,
        cloudAttempted: false,
        rolledBack: true,
        error:
          err?.message ||
          'Terjadi error saat memproses import. Sistem telah melakukan rollback otomatis ke katalog sebelumnya.',
        products: prevProductsSnapshot,
      };
    } finally {
      this.isMutatingRemote = false;
    }
  }

  // Shared helper to load bundled 10,112-item master CSV (/ITEMLISTMASTER_cleaned.csv) into IndexedDB
  async loadBundledMasterCsv(
    targetStoreId: string = 'store-krg',
    syncToCloud: boolean = false
  ): Promise<{ count: number }> {
    const resp = await fetch('/ITEMLISTMASTER_cleaned.csv');
    if (!resp.ok) {
      throw new Error('File master CSV (/ITEMLISTMASTER_cleaned.csv) tidak ditemukan.');
    }
    const text = await resp.text();
    const parsed = parseAndValidateImportText(text, {
      skipBlocked: false,
      sanitizeBarcode: sanitizeBarcodeValue,
      normalizeCategory: normalizeCategoryName,
    });

    if (parsed.records.length === 0) {
      throw new Error('Master CSV tidak berisi baris produk yang valid.');
    }

    if (syncToCloud) {
      const txRes = await this.importProductsTransactional(
        parsed.records,
        targetStoreId,
        true,
        true,
        true
      );
      if (!txRes.ok) {
        throw new Error(txRes.error || 'Gagal menyinkronkan Master CSV ke Supabase.');
      }
      return { count: parsed.records.length };
    }

    this.importProducts(parsed.records, targetStoreId, true, true, false);
    return { count: parsed.records.length };
  }

  // --- Supabase Cloud Sync Helpers ---
  async syncAllToSupabase(
    onProgress?: (completed: number, total: number) => void
  ): Promise<{ ok: boolean; synced: number; error?: string }> {
    const products = this.getProducts();
    await serverCatalogService
      .pushServerCatalog({
        mode: 'replace',
        products,
        updatedAt: new Date().toISOString(),
      })
      .catch(() => false);
    return supabaseService.upsertProductsBatch(products, onProgress);
  }

  async pullAllFromSupabase(
    onProgress?: (loaded: number) => void
  ): Promise<{ ok: boolean; count: number; error?: string }> {
    const [supabaseRes, serverRes] = await Promise.all([
      supabaseService.isConfigured()
        ? supabaseService.fetchAllProductsWithStatus(onProgress)
        : Promise.resolve({ products: null, error: 'Supabase belum dikonfigurasi' }),
      serverCatalogService.fetchServerCatalog(),
    ]);

    const rawProducts =
      supabaseRes.products && supabaseRes.products.length > 0
        ? supabaseRes.products
        : serverRes.ok && serverRes.products && serverRes.products.length > 0
          ? serverRes.products
          : null;

    if (!rawProducts) {
      if (supabaseRes.products && supabaseRes.products.length === 0) {
        return {
          ok: false,
          count: 0,
          error:
            'Tabel public.products di Supabase masih kosong (0 baris). Silakan klik "Import CSV / Excel" untuk mengimpor master item list Anda.',
        };
      }
      return {
        ok: false,
        count: 0,
        error:
          supabaseRes.error ||
          'Gagal mengambil data dari Supabase (Pastikan SQL Schema sudah dijalankan di SQL Editor Supabase).',
      };
    }

    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(STORAGE_KEYS.LOCAL_DATA_PURGED, 'true');
        localStorage.setItem(STORAGE_KEYS.LAST_CATALOG_SYNC_AT, new Date().toISOString());
      } catch {}
    }

    const normalized = this.normalizeAndDeduplicateCatalog(rawProducts);
    await this.persistProductsAsync(normalized.products);
    this.broadcastChange();

    // Keep both Server (/api/catalog) and Supabase Cloud in sync sequentially (never racing)
    if (this.isOnline()) {
      serverCatalogService
        .pushServerCatalog({
          mode: 'replace',
          products: normalized.products,
          updatedAt: new Date().toISOString(),
        })
        .catch(() => {});

      if (supabaseService.isConfigured()) {
        if (!supabaseRes.products || supabaseRes.products.length === 0) {
          await supabaseService.upsertProductsBatch(normalized.products).catch(() => {});
        } else {
          if (normalized.repairedProducts.length > 0) {
            await supabaseService.upsertProductsBatch(normalized.repairedProducts).catch(() => {});
          }
          if (normalized.obsoleteIds.length > 0) {
            await supabaseService.deleteProductsByIds(normalized.obsoleteIds).catch(() => {});
          }
        }
      }
    }

    return { ok: true, count: normalized.products.length };
  }

  // --- Templates ---
  getTemplates(): LabelTemplateConfig[] {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.TEMPLATES);
      return data ? JSON.parse(data) : INITIAL_TEMPLATES;
    } catch {
      return INITIAL_TEMPLATES;
    }
  }

  saveTemplate(template: LabelTemplateConfig) {
    const templates = this.getTemplates();
    const idx = templates.findIndex((t) => t.id === template.id);
    if (idx >= 0) {
      templates[idx] = template;
    } else {
      templates.push(template);
    }
    localStorage.setItem(STORAGE_KEYS.TEMPLATES, JSON.stringify(templates));
    this.broadcastChange();
  }

  // --- Auth & Users ---
  getCurrentUser(): User {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.CURRENT_USER);
      return data ? JSON.parse(data) : INITIAL_USERS[0];
    } catch {
      return INITIAL_USERS[0];
    }
  }

  setCurrentUser(user: User) {
    localStorage.setItem(STORAGE_KEYS.CURRENT_USER, JSON.stringify(user));
    this.broadcastChange();
  }

  getAvailableUsers(): User[] {
    return INITIAL_USERS;
  }

  // --- Thermal Printer Settings ---
  getPrinterSettings(): ThermalPrinterSettings {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.PRINTER_SETTINGS);
      if (data) return JSON.parse(data);
    } catch {}
    return {
      connectionType: 'browser_print',
      printerLanguage: 'TSPL',
      paperWidthMm: 65,
      labelWidthMm: 65,
      labelHeightMm: 28,
      dpi: 203,
      darkness: 10,
      autoCut: true,
      feedLines: 2,
    };
  }

  savePrinterSettings(settings: ThermalPrinterSettings) {
    localStorage.setItem(STORAGE_KEYS.PRINTER_SETTINGS, JSON.stringify(settings));
    this.broadcastChange();
  }
}

export const storageService = new StorageService();
