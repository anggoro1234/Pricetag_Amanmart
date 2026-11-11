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
  ImportProductRecord
} from '../types';
import { INITIAL_PRODUCTS, INITIAL_STORES, INITIAL_TEMPLATES, INITIAL_USERS } from '../data/initialData';
import { audioService } from './audioService';

const STORAGE_KEYS = {
  PRODUCTS: 'aman_label_products_v1',
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
};

class StorageService {
  private channel: BroadcastChannel | null = null;
  private listeners: Set<() => void> = new Set();

  constructor() {
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      try {
        this.channel = new BroadcastChannel('aman_inventory_sync_channel');
        this.channel.onmessage = (event) => {
          if (event.data?.type === 'SYNC_EVENT') {
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
    }

    this.initDefaults();
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
      localStorage.setItem(STORAGE_KEYS.PRODUCTS, JSON.stringify(INITIAL_PRODUCTS));
    } else {
      // Ensure existing products have stocks for all 8 branches & merge any new default products
      try {
        const storedProds: Product[] = JSON.parse(localStorage.getItem(STORAGE_KEYS.PRODUCTS) || '[]');
        let modified = false;
        const todayFormatted = new Date().toLocaleDateString('en-GB');
        const updatedProds = storedProds.map((p) => {
          let pModified = false;
          const currentStocks = { ...(p.stocks || {}) };
          INITIAL_STORES.forEach((store) => {
            if (!currentStocks[store.id]) {
              pModified = true;
              // Fallback to old store stock if available
              const legacyStock = currentStocks['store-1'] || currentStocks['store-2'] || currentStocks['store-3'];
              currentStocks[store.id] = {
                storeId: store.id,
                quantity: legacyStock?.quantity ?? 35,
                minThreshold: legacyStock?.minThreshold ?? 20,
                lastUpdated: new Date().toISOString(),
              };
            }
          });
          if (p.dateEffective !== todayFormatted) {
            pModified = true;
          }
          if (pModified) {
            modified = true;
            return { ...p, stocks: currentStocks, dateEffective: todayFormatted };
          }
          return p;
        });

        // Merge any newly added default products (e.g. Sauce & Condiments) not yet in localStorage
        INITIAL_PRODUCTS.forEach((initProd) => {
          const exists = updatedProds.some(
            (p) => p.id === initProd.id || p.sku === initProd.sku || p.barcode === initProd.barcode
          );
          if (!exists) {
            updatedProds.push(initProd);
            modified = true;
          }
        });

        if (modified) {
          localStorage.setItem(STORAGE_KEYS.PRODUCTS, JSON.stringify(updatedProds));
        }
      } catch {}
    }

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
    }
  }

  isOnline(): boolean {
    if (this.isSimulatedOffline()) return false;
    if (typeof navigator === 'undefined') return true;
    return navigator.onLine;
  }

  private handleNetworkRestored() {
    if (!this.isSimulatedOffline()) {
      this.processOfflineQueue();
    }
  }

  // --- Products Management ---
  getProducts(): Product[] {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.PRODUCTS);
      return data ? JSON.parse(data) : INITIAL_PRODUCTS;
    } catch {
      return INITIAL_PRODUCTS;
    }
  }

  getProductById(id: string): Product | undefined {
    return this.getProducts().find((p) => p.id === id);
  }

  findProductByBarcode(barcode: string): Product | undefined {
    const clean = barcode.trim().toLowerCase();
    return this.getProducts().find(
      (p) => p.barcode.toLowerCase() === clean || p.sku.toLowerCase() === clean
    );
  }

  saveProduct(product: Product): Product {
    const products = this.getProducts();
    const existingIndex = products.findIndex((p) => p.id === product.id);

    if (existingIndex >= 0) {
      products[existingIndex] = product;
    } else {
      products.unshift(product);
    }

    localStorage.setItem(STORAGE_KEYS.PRODUCTS, JSON.stringify(products));

    if (!this.isOnline()) {
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
    localStorage.setItem(STORAGE_KEYS.PRODUCTS, JSON.stringify(products));
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
    const products = this.getProducts();
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
    localStorage.setItem(STORAGE_KEYS.PRODUCTS, JSON.stringify(products));

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
    localStorage.setItem(STORAGE_KEYS.ADJUSTMENTS, JSON.stringify(adjustments.slice(0, 300)));

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
    const products = this.getProducts();
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

    localStorage.setItem(STORAGE_KEYS.PRODUCTS, JSON.stringify(products));

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

    // Simulate reliable cloud background sync
    const syncedCount = queue.length;
    localStorage.removeItem(STORAGE_KEYS.OFFLINE_QUEUE);
    this.broadcastChange();

    // Trigger push notification of sync completion
    if ('Notification' in window && Notification.permission === 'granted') {
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

    products.forEach((product) => {
      stores.forEach((store) => {
        const stock = product.stocks[store.id];
        const currentQty = stock?.quantity ?? 0;
        const threshold = stock?.minThreshold ?? 20;

        if (currentQty <= threshold) {
          // Check if alert already exists for this product and store today
          const today = new Date().toISOString().split('T')[0];
          const exists = existingAlerts.some(
            (a) => a.productId === product.id && a.storeId === store.id && a.timestamp.startsWith(today)
          );

          if (!exists) {
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

            // Trigger system browser push notification if permitted
            if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
              new Notification(`⚠️ Low Stock Alert: ${product.name}`, {
                body: `Only ${currentQty} units left at ${store.name} (Min threshold: ${threshold}). Tap to print reorder labels.`,
                icon: '/icon-192.svg',
              });
            }
          }
        }
      });
    });

    if (triggeredNew) {
      localStorage.setItem(STORAGE_KEYS.ALERTS, JSON.stringify(newAlerts.slice(0, 100)));
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

  // --- Bulk Product Import (Item, Barcode, Price) ---
  importProducts(
    records: ImportProductRecord[],
    targetStoreId: string = 'store-krg',
    updateExisting: boolean = true
  ): { added: number; updated: number; products: Product[] } {
    const products = this.getProducts();
    const stores = this.getStores();
    let added = 0;
    let updated = 0;

    // Helper to generate valid EAN-13 barcode if omitted
    const generateEan13 = () => {
      const raw12 = '899' + Math.floor(100000000 + Math.random() * 900000000).toString();
      let sum = 0;
      for (let i = 0; i < 12; i++) {
        const n = parseInt(raw12[i]);
        sum += i % 2 === 0 ? n : n * 3;
      }
      const check = (10 - (sum % 10)) % 10;
      return raw12 + check.toString();
    };

    records.forEach((rec, idx) => {
      const cleanName = rec.name ? rec.name.trim() : '';
      if (!cleanName) return;

      const cleanBarcode = rec.barcode ? rec.barcode.trim().replace(/\s+/g, '') : generateEan13();
      const unitPrice = typeof rec.price === 'number' && !isNaN(rec.price) ? Math.max(0, rec.price) : 0;

      // Check if product already exists by barcode or SKU
      const existingIdx = products.findIndex(
        (p) =>
          (cleanBarcode && p.barcode.toLowerCase() === cleanBarcode.toLowerCase()) ||
          (rec.sku && p.sku.toLowerCase() === rec.sku.trim().toLowerCase())
      );

      if (existingIdx >= 0) {
        if (updateExisting) {
          const existing = products[existingIdx];
          existing.name = cleanName.toUpperCase();
          if (unitPrice > 0) existing.pricing.unitPrice = unitPrice;
          if (rec.bulkPrice !== undefined && rec.bulkPrice > 0) existing.pricing.bulkPrice = rec.bulkPrice;
          if (rec.bulkQuantity !== undefined && rec.bulkQuantity > 0) existing.pricing.bulkQuantity = rec.bulkQuantity;
          if (rec.bulkLabel) existing.pricing.bulkLabel = rec.bulkLabel.toUpperCase();
          if (rec.category) existing.category = rec.category;
          if (rec.brand) existing.brand = rec.brand;
          if (rec.unitLabel) existing.pricing.unitLabel = rec.unitLabel.toUpperCase();

          // Update stock for target store if specified
          if (rec.stock !== undefined && !isNaN(rec.stock)) {
            if (!existing.stocks[targetStoreId]) {
              existing.stocks[targetStoreId] = {
                storeId: targetStoreId,
                quantity: rec.stock,
                minThreshold: rec.minThreshold ?? 20,
                lastUpdated: new Date().toISOString(),
              };
            } else {
              existing.stocks[targetStoreId].quantity = rec.stock;
              if (rec.minThreshold !== undefined) existing.stocks[targetStoreId].minThreshold = rec.minThreshold;
              existing.stocks[targetStoreId].lastUpdated = new Date().toISOString();
            }
          }
          updated++;
        }
      } else {
        // Create new product
        const newSku = rec.sku ? rec.sku.trim() : `100${Math.floor(1000 + Math.random() * 9000)}`;
        const initialStocks: Record<string, ProductStock> = {};

        stores.forEach((store) => {
          const isTarget = store.id === targetStoreId;
          const qty = isTarget ? (rec.stock !== undefined ? rec.stock : 50) : 35;
          initialStocks[store.id] = {
            storeId: store.id,
            quantity: qty,
            minThreshold: rec.minThreshold ?? 20,
            lastUpdated: new Date().toISOString(),
          };
        });

        const newProd: Product = {
          id: `prod-${Date.now()}-${idx}-${Math.random().toString(36).substring(2, 6)}`,
          sku: newSku,
          barcode: cleanBarcode,
          barcodeType: 'EAN13',
          name: cleanName.toUpperCase(),
          category: rec.category || 'Grocery',
          brand: rec.brand || 'General',
          department: `${rec.category || 'Grocery'} / General`,
          currency: 'Rp.',
          pricing: {
            unitLabel: (rec.unitLabel || 'PCS').toUpperCase(),
            unitQuantity: 1,
            unitPrice,
            bulkLabel: (rec.bulkLabel || 'CRT').toUpperCase(),
            bulkQuantity: rec.bulkQuantity || 24,
            bulkPrice: rec.bulkPrice || (unitPrice > 0 ? Math.round(unitPrice * 22) : 0),
          },
          stocks: initialStocks,
          dateEffective: new Date().toLocaleDateString('en-GB'),
          locationBin: 'A-01-01',
        };

        products.unshift(newProd);
        added++;
      }
    });

    localStorage.setItem(STORAGE_KEYS.PRODUCTS, JSON.stringify(products));
    this.evaluateStockAlerts();
    this.broadcastChange();

    return { added, updated, products };
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
