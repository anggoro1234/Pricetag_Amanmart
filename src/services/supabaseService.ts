import { Product } from '../types';
import { INITIAL_STORES } from '../data/initialData';
import { detectBarcodeType, sanitizeBarcodeValue } from '../utils/barcodeUtils';

export interface SupabaseConfig {
  url: string;
  anonKey: string;
  enabled: boolean;
  lastSyncedAt?: string;
}

// Built-in default credentials configured for Amanmart Supabase Project
export const DEFAULT_SUPABASE_URL = 'https://otbujeoxvwfnqwnpxnnd.supabase.co';
export const DEFAULT_SUPABASE_ANON_KEY = 'sb_publishable_RSUCLxMj9wXDfD6W6TiwWg_dKB9wnri';

const SUPABASE_CONFIG_KEY = 'aman_supabase_config_v1';
const IDB_NAME = 'amanmart_high_capacity_db';
const IDB_VERSION = 1;
const IDB_STORE = 'products_store';
const IDB_KEY = 'catalog_products';

// ============================================================================
// 1. IndexedDB High-Capacity Browser Storage (Supports 50,000+ items > 100MB)
//    Prevents localStorage 5MB QuotaExceededError when importing 10,000+ rows
// ============================================================================
const openIdb = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !('indexedDB' in window)) {
      reject(new Error('IndexedDB not supported'));
      return;
    }
    const req = window.indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
};

export const idbSaveProducts = async (products: Product[]): Promise<boolean> => {
  try {
    const db = await openIdb();
    return new Promise((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      store.put(products, IDB_KEY);
      tx.oncomplete = () => {
        db.close();
        resolve(true);
      };
      tx.onerror = () => {
        db.close();
        resolve(false);
      };
    });
  } catch {
    return false;
  }
};

export const idbGetProducts = async (): Promise<Product[] | null> => {
  try {
    const db = await openIdb();
    return new Promise((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const store = tx.objectStore(IDB_STORE);
      const req = store.get(IDB_KEY);
      req.onsuccess = () => {
        db.close();
        resolve(Array.isArray(req.result) ? req.result : null);
      };
      req.onerror = () => {
        db.close();
        resolve(null);
      };
    });
  } catch {
    return null;
  }
};

export const idbClearProducts = async (): Promise<boolean> => {
  try {
    const db = await openIdb();
    return new Promise((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      store.delete(IDB_KEY);
      tx.oncomplete = () => {
        db.close();
        resolve(true);
      };
      tx.onerror = () => {
        db.close();
        resolve(false);
      };
    });
  } catch {
    return false;
  }
};

export const idbSaveValue = async <T>(key: string, value: T): Promise<boolean> => {
  try {
    const db = await openIdb();
    return new Promise((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      store.put(value, key);
      tx.oncomplete = () => {
        db.close();
        resolve(true);
      };
      tx.onerror = () => {
        db.close();
        resolve(false);
      };
    });
  } catch {
    return false;
  }
};

export const idbGetValue = async <T>(key: string): Promise<T | null> => {
  try {
    const db = await openIdb();
    return new Promise((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const store = tx.objectStore(IDB_STORE);
      const req = store.get(key);
      req.onsuccess = () => {
        db.close();
        resolve((req.result ?? null) as T | null);
      };
      req.onerror = () => {
        db.close();
        resolve(null);
      };
    });
  } catch {
    return null;
  }
};

// ============================================================================
// 1B. Shared Server Catalog Endpoint (/api/catalog) for Cross-Device LAN/Node Sync
// ============================================================================
export const serverCatalogService = {
  async fetchServerCatalog(): Promise<{
    ok: boolean;
    updatedAt: string | null;
    products: Product[] | null;
  }> {
    if (typeof fetch === 'undefined') {
      return { ok: false, updatedAt: null, products: null };
    }
    try {
      const resp = await fetch('/api/catalog', {
        method: 'GET',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      });
      if (!resp.ok) {
        return { ok: false, updatedAt: null, products: null };
      }
      const contentType = resp.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        return { ok: false, updatedAt: null, products: null };
      }
      const data = await resp.json();
      if (!data || !data.ok || !Array.isArray(data.products)) {
        return { ok: false, updatedAt: null, products: null };
      }
      return {
        ok: true,
        updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : null,
        products: data.products as Product[],
      };
    } catch {
      return { ok: false, updatedAt: null, products: null };
    }
  },

  async pushServerCatalog(options: {
    mode: 'replace' | 'upsert';
    products: Product[];
    deletedIds?: string[];
    updatedAt?: string;
  }): Promise<boolean> {
    if (typeof fetch === 'undefined') return false;
    try {
      const resp = await fetch('/api/catalog', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          mode: options.mode,
          products: options.products,
          deletedIds: options.deletedIds || [],
          updatedAt: options.updatedAt || new Date().toISOString(),
        }),
      });
      if (!resp.ok) return false;
      const contentType = resp.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) return false;
      const data = await resp.json();
      return Boolean(data?.ok);
    } catch {
      return false;
    }
  },

  async clearServerCatalog(): Promise<boolean> {
    if (typeof fetch === 'undefined') return false;
    try {
      const resp = await fetch('/api/catalog', {
        method: 'DELETE',
        headers: { Accept: 'application/json' },
      });
      return resp.ok;
    } catch {
      return false;
    }
  },
};

// ============================================================================
// 2. Row Mapping between App Product Type & Supabase PostgreSQL Table
//    Supports both full app rows AND direct CSV uploads (SKU,Item Name,Barcode,Price,Category,Stock)
// ============================================================================
interface SupabaseProductRow {
  id?: string;
  sku?: string;
  barcode?: string;
  barcode_type?: string;
  name?: string;
  category?: string;
  brand?: string;
  department?: string;
  currency?: string;
  unit_price?: number;
  unit_label?: string;
  unit_quantity?: number;
  bulk_price?: number;
  bulk_label?: string;
  bulk_quantity?: number;
  stocks?: Record<string, any>;
  promotional_discount?: any;
  date_effective?: string;
  location_bin?: string;
  updated_at?: string;
  // Direct CSV headers fallback if imported via Supabase Dashboard CSV Upload
  SKU?: string;
  'Item Name'?: string;
  Barcode?: string;
  Price?: number;
  Category?: string;
  Stock?: number;
}

const toSafeInt = (val: any, fallback: number = 0): number => {
  const n = Number(val);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : fallback;
};

const mapProductToRow = (p: Product, includeCsvFallbackColumns = false): SupabaseProductRow => {
  const unitPrice = toSafeInt(p.pricing?.unitPrice, 0);
  const krgStock = toSafeInt(p.stocks?.['store-krg']?.quantity, 0);
  const baseRow: SupabaseProductRow = {
    id: p.id || `prod-${p.sku || Date.now()}`,
    sku: p.sku || '',
    barcode: p.barcode || '',
    barcode_type: p.barcodeType || 'EAN13',
    name: p.name || '',
    category: p.category || 'Grocery',
    brand: p.brand || 'General',
    department: p.department || `${p.category || 'Grocery'} / General`,
    currency: p.currency || 'Rp.',
    unit_price: unitPrice,
    unit_label: p.pricing?.unitLabel || 'PCS',
    unit_quantity: toSafeInt(p.pricing?.unitQuantity, 1) || 1,
    bulk_price: toSafeInt(p.pricing?.bulkPrice, 0),
    bulk_label: p.pricing?.bulkLabel || 'CRT',
    bulk_quantity: toSafeInt(p.pricing?.bulkQuantity, 24) || 24,
    stocks: p.stocks || {},
    promotional_discount: p.promotionalDiscount || null,
    date_effective: p.dateEffective || new Date().toLocaleDateString('en-GB'),
    location_bin: p.locationBin || 'A-01-01',
    updated_at: new Date().toISOString(),
  };

  if (includeCsvFallbackColumns) {
    baseRow.SKU = p.sku || '';
    baseRow['Item Name'] = p.name || '';
    baseRow.Barcode = p.barcode || '';
    baseRow.Price = unitPrice;
    baseRow.Category = p.category || 'Grocery';
    baseRow.Stock = krgStock;
  }

  return baseRow;
};

const mapRowToProduct = (r: SupabaseProductRow, index: number): Product => {
  const sku = String(r.sku || r.SKU || `${1000000 + index}`).trim();
  const rawName = String(r.name || r['Item Name'] || '').trim();
  const name = (rawName || `ITEM SKU ${sku}`).toUpperCase();
  const rawBarcode = String(r.barcode || r.Barcode || '').trim();
  const barcode = sanitizeBarcodeValue(rawBarcode, sku || name);
  const barcodeType = detectBarcodeType(barcode);
  const category = String(r.category || r.Category || 'Grocery').trim() || 'Grocery';
  const unitPrice = Math.max(0, Math.round(Number(r.unit_price ?? r.Price ?? 0) || 0));
  const bulkPrice = Math.max(
    0,
    Math.round(Number(r.bulk_price ?? (unitPrice > 0 ? unitPrice * 22 : 0)) || 0)
  );

  const nowIso = new Date().toISOString();
  const rawStocks = r.stocks && typeof r.stocks === 'object' ? { ...r.stocks } : {};
  const fallbackCsvStock =
    r.Stock !== undefined && r.Stock !== null && !isNaN(Number(r.Stock))
      ? Math.max(0, Math.round(Number(r.Stock)))
      : 50;

  INITIAL_STORES.forEach((store) => {
    if (!rawStocks[store.id]) {
      rawStocks[store.id] = {
        storeId: store.id,
        quantity: store.id === 'store-krg' ? fallbackCsvStock : 35,
        minThreshold: 20,
        lastUpdated: nowIso,
      };
    } else {
      rawStocks[store.id] = {
        ...rawStocks[store.id],
        storeId: store.id,
        quantity: Math.max(0, Math.round(Number(rawStocks[store.id].quantity) || 0)),
        minThreshold: Number(rawStocks[store.id].minThreshold ?? 20),
      };
    }
  });

  return {
    id: r.id || `prod-sb-${sku}-${index}`,
    sku,
    barcode,
    barcodeType,
    name,
    category,
    brand: r.brand || 'General',
    department: r.department || `${category} / General`,
    currency: r.currency || 'Rp.',
    pricing: {
      unitLabel: r.unit_label || 'PCS',
      unitQuantity: Number(r.unit_quantity ?? 1),
      unitPrice,
      bulkLabel: r.bulk_label || 'CRT',
      bulkQuantity: Number(r.bulk_quantity ?? 24),
      bulkPrice,
    },
    stocks: rawStocks,
    promotionalDiscount: r.promotional_discount || undefined,
    dateEffective: r.date_effective || new Date().toLocaleDateString('en-GB'),
    locationBin: r.location_bin || 'A-01-01',
  };
};

function extractMissingColumnFromError(errText: string): string | null {
  if (!errText) return null;
  const pgrstMatch = errText.match(/Could not find the '([^']+)' column/i);
  if (pgrstMatch && pgrstMatch[1]) return pgrstMatch[1];

  const pgRelMatch = errText.match(/column "([^"]+)" of relation/i);
  if (pgRelMatch && pgRelMatch[1]) return pgRelMatch[1];

  const pgColMatch = errText.match(/column "([^"]+)" does not exist/i);
  if (pgColMatch && pgColMatch[1]) return pgColMatch[1];

  return null;
}

// ============================================================================
// 3. Supabase Cloud Integration Service (Chunked Batch Upsert + Paginated Fetch)
// ============================================================================
class SupabaseService {
  private unsupportedColumns = new Set<string>();
  private useCsvFallbackColumns = false;
  private resolvedConflictTarget: string = 'id';

  getConfig(): SupabaseConfig {
    const envUrl = ((import.meta as any).env?.VITE_SUPABASE_URL || '').trim();
    const envKey = ((import.meta as any).env?.VITE_SUPABASE_ANON_KEY || '').trim();

    const fallbackUrl =
      envUrl && !envUrl.includes('your-project-id') ? envUrl : DEFAULT_SUPABASE_URL;
    const fallbackKey =
      envKey && !envKey.includes('your-anon') ? envKey : DEFAULT_SUPABASE_ANON_KEY;

    if (typeof window !== 'undefined') {
      try {
        const raw = localStorage.getItem(SUPABASE_CONFIG_KEY);
        if (raw) {
          const parsed: SupabaseConfig = JSON.parse(raw);
          const resolvedUrl = (parsed.url || fallbackUrl).replace(/\/+$/, '');
          const resolvedKey = parsed.anonKey || fallbackKey;
          return {
            url: resolvedUrl,
            anonKey: resolvedKey,
            enabled: parsed.enabled ?? Boolean(resolvedUrl && resolvedKey),
            lastSyncedAt: parsed.lastSyncedAt,
          };
        }
      } catch {}
    }

    return {
      url: fallbackUrl.replace(/\/+$/, ''),
      anonKey: fallbackKey,
      enabled: Boolean(fallbackUrl && fallbackKey),
    };
  }

  saveConfig(config: SupabaseConfig) {
    if (typeof window === 'undefined') return;
    const cleanConfig: SupabaseConfig = {
      ...config,
      url: config.url.trim().replace(/\/+$/, ''),
      anonKey: config.anonKey.trim(),
    };
    try {
      localStorage.setItem(SUPABASE_CONFIG_KEY, JSON.stringify(cleanConfig));
    } catch {}
  }

  isConfigured(): boolean {
    const cfg = this.getConfig();
    return Boolean(cfg.enabled && cfg.url && cfg.anonKey && cfg.url.startsWith('http'));
  }

  // Helper fetch that supports both standard JWT anon keys (eyJ...) and new Supabase publishable keys (sb_publishable_...)
  private async requestWithKeyFallback(
    url: string,
    anonKey: string,
    init: RequestInit,
    extraHeaders?: Record<string, string>
  ): Promise<Response> {
    if (anonKey.startsWith('sb_')) {
      const headersApiKeyOnly: Record<string, string> = {
        apikey: anonKey,
        ...extraHeaders,
      };
      const resp = await fetch(url, { ...init, headers: headersApiKeyOnly });
      if (resp.status === 401) {
        return fetch(url, {
          ...init,
          headers: {
            apikey: anonKey,
            Authorization: `Bearer ${anonKey}`,
            ...extraHeaders,
          },
        });
      }
      return resp;
    }

    const headersWithBearer: Record<string, string> = {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      ...extraHeaders,
    };
    return fetch(url, { ...init, headers: headersWithBearer });
  }

  // Test connection and verify if `products` table exists
  async testConnection(customUrl?: string, customKey?: string): Promise<{
    ok: boolean;
    message: string;
    totalRemoteCount?: number;
    tableMissing?: boolean;
  }> {
    const cfg = this.getConfig();
    const url = (customUrl ?? cfg.url).trim().replace(/\/+$/, '');
    const anonKey = (customKey ?? cfg.anonKey).trim();

    if (!url || !anonKey) {
      return {
        ok: false,
        message: 'Project URL dan API Key Supabase wajib diisi.',
      };
    }

    if (!url.startsWith('https://') && !url.startsWith('http://')) {
      return {
        ok: false,
        message: 'Format URL tidak valid. Gunakan format https://<project-id>.supabase.co',
      };
    }

    try {
      const resp = await this.requestWithKeyFallback(
        `${url}/rest/v1/products?select=*&limit=1`,
        anonKey,
        { method: 'GET' },
        { Prefer: 'count=exact' }
      );

      if (!resp.ok) {
        const errText = await resp.text();
        if (
          resp.status === 404 ||
          errText.includes('relation') ||
          errText.includes('does not exist') ||
          errText.includes('PGRST205') ||
          errText.includes('schema cache')
        ) {
          return {
            ok: false,
            tableMissing: true,
            message:
              'API Supabase Terhubung! Namun tabel "public.products" belum dibuat di project Anda. Silakan klik "Copy SQL Schema" pada Langkah 1 lalu jalankan (Run) di menu SQL Editor Supabase Anda.',
          };
        }
        if (resp.status === 401 || resp.status === 403) {
          return {
            ok: false,
            message:
              'Autentikasi gagal (401/403). Pastikan Publishable / Anon Key benar dan RLS Policy sudah diaktifkan melalui SQL Schema.',
          };
        }
        return {
          ok: false,
          message: `Gagal terhubung (${resp.status}): ${errText.slice(0, 120)}`,
        };
      }

      const contentRange = resp.headers.get('content-range') || '';
      const totalPart = contentRange.split('/')[1];
      const totalRemoteCount = totalPart && totalPart !== '*' ? parseInt(totalPart, 10) : 0;

      return {
        ok: true,
        message: `Terhubung ke Supabase (${url})! Saat ini terdapat ${totalRemoteCount.toLocaleString('id-ID')} item produk di Cloud.`,
        totalRemoteCount,
      };
    } catch (err: any) {
      return {
        ok: false,
        message: `Koneksi gagal: ${err?.message || 'Periksa koneksi internet dan Project URL Supabase Anda.'}`,
      };
    }
  }

  // Fetch all products with explicit error reporting (uses limit/offset query params to avoid Range CORS issues on mobile browsers)
  async fetchAllProductsWithStatus(onProgress?: (loaded: number) => void): Promise<{
    products: Product[] | null;
    error?: string;
  }> {
    if (!this.isConfigured()) {
      return { products: null, error: 'Supabase belum dikonfigurasi.' };
    }
    const cfg = this.getConfig();

    const pageSize = 1000;
    let offset = 0;
    let useOrderById = true;
    const allRows: SupabaseProductRow[] = [];

    try {
      while (true) {
        const orderClause = useOrderById ? '&order=id.asc' : '';
        let resp = await this.requestWithKeyFallback(
          `${cfg.url}/rest/v1/products?select=*${orderClause}&limit=${pageSize}&offset=${offset}`,
          cfg.anonKey,
          { method: 'GET' },
          { 'Content-Type': 'application/json' }
        );

        if (!resp.ok && useOrderById && resp.status === 400) {
          useOrderById = false;
          resp = await this.requestWithKeyFallback(
            `${cfg.url}/rest/v1/products?select=*&limit=${pageSize}&offset=${offset}`,
            cfg.anonKey,
            { method: 'GET' },
            { 'Content-Type': 'application/json' }
          );
        }

        if (!resp.ok) {
          const errText = await resp.text().catch(() => '');
          return {
            products: null,
            error: `HTTP ${resp.status}: ${errText.slice(0, 140) || 'Gagal membaca tabel public.products di Supabase.'}`,
          };
        }

        const pageData: SupabaseProductRow[] = await resp.json();
        if (!Array.isArray(pageData) || pageData.length === 0) {
          break;
        }

        allRows.push(...pageData);
        if (onProgress) onProgress(allRows.length);

        if (pageData.length < pageSize) {
          break;
        }

        offset += pageData.length;
        if (offset >= 100000) break;
      }

      this.saveConfig({ ...cfg, lastSyncedAt: new Date().toISOString() });
      return { products: allRows.map((row, idx) => mapRowToProduct(row, idx)) };
    } catch (err: any) {
      return {
        products: null,
        error: err?.message || 'Koneksi ke Supabase gagal saat menarik katalog.',
      };
    }
  }

  // Fetch all products (supports 10,000+ rows using paginated 1,000-row requests)
  async fetchAllProducts(onProgress?: (loaded: number) => void): Promise<Product[] | null> {
    const res = await this.fetchAllProductsWithStatus(onProgress);
    return res.products;
  }

  private buildSanitizedRow(prod: Product): Record<string, any> {
    const raw = mapProductToRow(prod, this.useCsvFallbackColumns) as Record<string, any>;
    const sanitized: Record<string, any> = {};
    for (const key of Object.keys(raw)) {
      if (!this.unsupportedColumns.has(key)) {
        sanitized[key] = raw[key];
      }
    }
    return sanitized;
  }

  private async uploadSingleChunkWithAdaptation(
    cfg: SupabaseConfig,
    chunkProducts: Product[]
  ): Promise<{ ok: boolean; syncedIds: string[]; error?: string }> {
    const conflictCandidates = [this.resolvedConflictTarget, 'id', 'sku', 'SKU', ''].filter(
      (v, idx, arr) => arr.indexOf(v) === idx
    );
    let candidateIdx = 0;
    let lastErrText = '';
    let lastStatus = 0;

    for (let attempt = 0; attempt < 18; attempt++) {
      const currentConflict = conflictCandidates[candidateIdx] ?? '';
      const payloadRows = chunkProducts.map((p) => this.buildSanitizedRow(p));

      const querySuffix = currentConflict ? `?on_conflict=${encodeURIComponent(currentConflict)}` : '';
      const endpoint = `${cfg.url}/rest/v1/products${querySuffix}`;

      let resp: Response | null = null;
      try {
        resp = await this.requestWithKeyFallback(
          endpoint,
          cfg.anonKey,
          {
            method: 'POST',
            body: JSON.stringify(payloadRows),
          },
          {
            'Content-Type': 'application/json',
            Prefer: 'resolution=merge-duplicates,return=minimal',
          }
        );
      } catch (netErr: any) {
        lastErrText = netErr?.message || 'Network error during batch upload';
        await new Promise((r) => setTimeout(r, 300 * Math.min(attempt + 1, 4)));
        continue;
      }

      if (resp.ok) {
        this.resolvedConflictTarget = currentConflict;
        const syncedIds = chunkProducts
          .map((p) => p.id || `prod-${p.sku}`)
          .filter(Boolean);
        return { ok: true, syncedIds };
      }

      lastStatus = resp.status;
      lastErrText = await resp.text().catch(() => '');

      // Retry transient rate limits or 5xx errors
      if (resp.status === 429 || resp.status >= 500) {
        await new Promise((r) => setTimeout(r, 350 * Math.min(attempt + 1, 4)));
        continue;
      }

      // Check if table itself is missing
      if (
        resp.status === 404 ||
        lastErrText.includes('PGRST205') ||
        (lastErrText.includes('relation') && lastErrText.includes('does not exist'))
      ) {
        return {
          ok: false,
          syncedIds: [],
          error:
            'Tabel "public.products" belum dibuat di Supabase. Silakan jalankan SQL Schema di menu SQL Editor Supabase Anda terlebih dahulu.',
        };
      }

      // Check if a specific column is missing in the remote table schema
      const missingCol = extractMissingColumnFromError(lastErrText);
      if (missingCol && !this.unsupportedColumns.has(missingCol)) {
        this.unsupportedColumns.add(missingCol);
        if (['sku', 'name', 'barcode', 'unit_price', 'category', 'stocks'].includes(missingCol)) {
          this.useCsvFallbackColumns = true;
        }
        if (missingCol === currentConflict && candidateIdx + 1 < conflictCandidates.length) {
          candidateIdx++;
        }
        continue;
      }

      // Check if ON CONFLICT target constraint does not match remote table
      if (
        resp.status === 400 &&
        (lastErrText.includes('42P10') ||
          lastErrText.includes('ON CONFLICT') ||
          lastErrText.includes('constraint') ||
          lastErrText.includes('PGRST100')) &&
        candidateIdx + 1 < conflictCandidates.length
      ) {
        candidateIdx++;
        continue;
      }

      break;
    }

    return {
      ok: false,
      syncedIds: [],
      error: lastStatus
        ? `Supabase error (${lastStatus}): ${lastErrText.slice(0, 160)}`
        : lastErrText || 'Koneksi terputus saat mengirim batch ke Supabase',
    };
  }

  // Upsert 10,000+ products in fast schema-adaptive batches (deduplicated by id & sku to prevent ON CONFLICT errors)
  async upsertProductsBatch(
    products: Product[],
    onProgress?: (completed: number, total: number) => void
  ): Promise<{ ok: boolean; synced: number; syncedIds?: string[]; error?: string }> {
    if (!this.isConfigured()) {
      return { ok: false, synced: 0, syncedIds: [], error: 'Supabase belum dikonfigurasi' };
    }
    if (!products || products.length === 0) {
      return { ok: true, synced: 0, syncedIds: [] };
    }

    // Deduplicate by resolved row id and SKU (last wins) so Postgres never hits 21000 ON CONFLICT duplicate row error
    const dedupById = new Map<string, Product>();
    const skuOwnerId = new Map<string, string>();
    for (const prod of products) {
      const id = prod.id || `prod-${prod.sku || Date.now()}`;
      const skuKey = String(prod.sku || '').trim().toLowerCase();
      if (skuKey && skuOwnerId.has(skuKey)) {
        const existingId = skuOwnerId.get(skuKey)!;
        dedupById.delete(existingId);
      }
      dedupById.set(id, { ...prod, id });
      if (skuKey) skuOwnerId.set(skuKey, id);
    }

    const uniqueProducts = Array.from(dedupById.values());
    const cfg = this.getConfig();
    const batchSize = 250;
    const total = uniqueProducts.length;
    let synced = 0;
    const syncedIds: string[] = [];

    const chunks: Product[][] = [];
    for (let i = 0; i < total; i += batchSize) {
      chunks.push(uniqueProducts.slice(i, i + batchSize));
    }

    try {
      // Upload first chunk first to lock in any schema adaptation or conflict target
      if (chunks.length > 0) {
        const firstRes = await this.uploadSingleChunkWithAdaptation(cfg, chunks[0]);
        if (!firstRes.ok) {
          return {
            ok: false,
            synced,
            syncedIds,
            error: firstRes.error,
          };
        }
        synced += chunks[0].length;
        syncedIds.push(...firstRes.syncedIds);
        if (onProgress) onProgress(synced, total);
      }

      // Upload remaining chunks with bounded concurrency (3) for fast 10,000+ item sync
      const concurrency = 3;
      for (let i = 1; i < chunks.length; i += concurrency) {
        const batchGroup = chunks.slice(i, i + concurrency);
        const groupResults = await Promise.all(
          batchGroup.map((chunk) => this.uploadSingleChunkWithAdaptation(cfg, chunk))
        );

        for (let j = 0; j < groupResults.length; j++) {
          const res = groupResults[j];
          const chunk = batchGroup[j];
          if (!res.ok) {
            return {
              ok: false,
              synced,
              syncedIds,
              error: res.error,
            };
          }
          synced += chunk.length;
          syncedIds.push(...res.syncedIds);
          if (onProgress) onProgress(synced, total);
        }
      }

      this.saveConfig({ ...cfg, lastSyncedAt: new Date().toISOString() });
      return { ok: true, synced, syncedIds };
    } catch (err: any) {
      return {
        ok: false,
        synced,
        syncedIds,
        error: err?.message || 'Gagal mengunggah batch ke Supabase',
      };
    }
  }

  // Upsert a single product
  async upsertSingleProduct(product: Product): Promise<boolean> {
    const res = await this.upsertProductsBatch([product]);
    return res.ok;
  }

  // Delete a single product from Supabase
  async deleteSingleProduct(productId: string): Promise<boolean> {
    if (!this.isConfigured()) return false;
    const cfg = this.getConfig();
    try {
      const resp = await this.requestWithKeyFallback(
        `${cfg.url}/rest/v1/products?id=eq.${encodeURIComponent(productId)}`,
        cfg.anonKey,
        { method: 'DELETE' },
        {
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        }
      );
      return resp.ok;
    } catch {
      return false;
    }
  }

  // Fetch all product IDs from Supabase (used when replacing catalog to clean up obsolete remote rows)
  async fetchAllProductIds(): Promise<string[] | null> {
    if (!this.isConfigured()) return null;
    const cfg = this.getConfig();
    const pageSize = 1000;
    let offset = 0;
    const ids: string[] = [];

    try {
      while (true) {
        const resp = await this.requestWithKeyFallback(
          `${cfg.url}/rest/v1/products?select=id&order=id.asc&limit=${pageSize}&offset=${offset}`,
          cfg.anonKey,
          { method: 'GET' },
          { 'Content-Type': 'application/json' }
        );
        if (!resp.ok) return null;
        const rows: { id?: string }[] = await resp.json();
        if (!Array.isArray(rows) || rows.length === 0) break;
        for (const r of rows) {
          if (r.id) ids.push(r.id);
        }
        if (rows.length < pageSize) break;
        offset += rows.length;
        if (offset >= 100000) break;
      }
      return ids;
    } catch {
      return null;
    }
  }

  // Delete specific product IDs (used for compensating rollback and stale-row cleanup)
  async deleteProductsByIds(ids: string[]): Promise<{ ok: boolean; error?: string }> {
    if (!this.isConfigured() || ids.length === 0) return { ok: true };
    const cfg = this.getConfig();
    const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
    const chunkSize = 80;

    try {
      for (let i = 0; i < uniqueIds.length; i += chunkSize) {
        const slice = uniqueIds.slice(i, i + chunkSize);
        const inClause = slice.map((id) => `"${id.replace(/"/g, '\\"')}"`).join(',');
        let resp: Response | null = null;
        let lastErrText = '';
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            resp = await this.requestWithKeyFallback(
              `${cfg.url}/rest/v1/products?id=in.${encodeURIComponent(`(${inClause})`)}`,
              cfg.anonKey,
              { method: 'DELETE' },
              {
                'Content-Type': 'application/json',
                Prefer: 'return=minimal',
              }
            );
            if (resp.ok || (resp.status !== 429 && resp.status < 500)) break;
            lastErrText = await resp.text();
          } catch (netErr: any) {
            lastErrText = netErr?.message || 'Network error during delete';
            resp = null;
          }
          if (attempt < 2) await new Promise((r) => setTimeout(r, 350 * (attempt + 1)));
        }
        if (!resp) {
          return { ok: false, error: lastErrText || 'Cloud delete failed' };
        }
        if (!resp.ok) {
          const errText = lastErrText || (await resp.text());
          return { ok: false, error: `Rollback delete error (${resp.status}): ${errText.slice(0, 120)}` };
        }
      }
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message || 'Cloud rollback delete failed' };
    }
  }

  // Delete all products from Supabase table (when user wants a clean reset)
  async deleteAllProducts(): Promise<boolean> {
    if (!this.isConfigured()) return false;
    const cfg = this.getConfig();
    try {
      const resp = await this.requestWithKeyFallback(
        `${cfg.url}/rest/v1/products?id=neq.___never_match___`,
        cfg.anonKey,
        { method: 'DELETE' },
        {
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        }
      );
      return resp.ok;
    } catch {
      return false;
    }
  }
}

export const supabaseService = new SupabaseService();

// Ready-to-copy SQL Schema string for UI Modal display
export const SUPABASE_SQL_SCHEMA = `-- Jalankan di Supabase Dashboard (https://otbujeoxvwfnqwnpxnnd.supabase.co) -> SQL Editor -> New Query:
CREATE TABLE IF NOT EXISTS public.products (
  id TEXT PRIMARY KEY DEFAULT ('prod-' || gen_random_uuid()::text),
  sku TEXT DEFAULT '',
  barcode TEXT DEFAULT '',
  barcode_type TEXT DEFAULT 'EAN13',
  name TEXT DEFAULT '',
  category TEXT DEFAULT 'Grocery',
  brand TEXT DEFAULT 'General',
  department TEXT DEFAULT 'Grocery / General',
  currency TEXT DEFAULT 'Rp.',
  unit_price NUMERIC DEFAULT 0,
  unit_label TEXT DEFAULT 'PCS',
  unit_quantity INTEGER DEFAULT 1,
  bulk_price NUMERIC DEFAULT 0,
  bulk_label TEXT DEFAULT 'CRT',
  bulk_quantity INTEGER DEFAULT 24,
  stocks JSONB DEFAULT '{}'::jsonb,
  promotional_discount JSONB DEFAULT NULL,
  date_effective TEXT DEFAULT to_char(NOW(), 'DD/MM/YYYY'),
  location_bin TEXT DEFAULT 'A-01-01',
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  "SKU" TEXT,
  "Item Name" TEXT,
  "Barcode" TEXT,
  "Price" NUMERIC,
  "Category" TEXT,
  "Stock" NUMERIC
);

CREATE OR REPLACE FUNCTION public.normalize_amanmart_product_row()
RETURNS TRIGGER AS $$
DECLARE
  clean_stock INTEGER;
BEGIN
  IF (NEW.id IS NULL OR NEW.id = '') THEN
    NEW.id := 'prod-' || COALESCE(NULLIF(TRIM(NEW.sku), ''), NULLIF(TRIM(NEW."SKU"), ''), gen_random_uuid()::text);
  END IF;
  IF (NEW.sku IS NULL OR NEW.sku = '') AND NEW."SKU" IS NOT NULL THEN
    NEW.sku := TRIM(NEW."SKU");
  END IF;
  IF (NEW.name IS NULL OR NEW.name = '') AND NEW."Item Name" IS NOT NULL THEN
    NEW.name := UPPER(TRIM(NEW."Item Name"));
  END IF;
  IF (NEW.name IS NULL OR NEW.name = '') THEN
    NEW.name := 'ITEM SKU ' || COALESCE(NULLIF(NEW.sku, ''), NEW.id);
  END IF;
  IF (NEW.barcode IS NULL OR NEW.barcode = '' OR NEW.barcode = '0') AND NEW."Barcode" IS NOT NULL THEN
    NEW.barcode := TRIM(NEW."Barcode");
  END IF;
  IF (NEW.unit_price IS NULL OR NEW.unit_price = 0) AND NEW."Price" IS NOT NULL THEN
    NEW.unit_price := ROUND(GREATEST(0, NEW."Price"));
  END IF;
  IF (NEW.bulk_price IS NULL OR NEW.bulk_price = 0) AND NEW.unit_price > 0 THEN
    NEW.bulk_price := ROUND(NEW.unit_price * 22);
  END IF;
  IF (NEW.category IS NULL OR NEW.category = '' OR NEW.category = 'Grocery') AND NEW."Category" IS NOT NULL AND TRIM(NEW."Category") <> '' THEN
    NEW.category := INITCAP(TRIM(NEW."Category"));
  END IF;
  IF NEW.department IS NULL OR NEW.department = '' THEN
    NEW.department := COALESCE(NEW.category, 'Grocery') || ' / General';
  END IF;
  IF (NEW.stocks IS NULL OR NEW.stocks = '{}'::jsonb) AND NEW."Stock" IS NOT NULL THEN
    clean_stock := GREATEST(0, ROUND(NEW."Stock")::INTEGER);
    NEW.stocks := jsonb_build_object(
      'store-krg', jsonb_build_object('storeId', 'store-krg', 'quantity', clean_stock, 'minThreshold', 20, 'lastUpdated', NOW())
    );
  END IF;
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_normalize_amanmart_product ON public.products;
CREATE TRIGGER trg_normalize_amanmart_product
  BEFORE INSERT OR UPDATE ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.normalize_amanmart_product_row();

CREATE INDEX IF NOT EXISTS idx_products_sku ON public.products (sku);
CREATE INDEX IF NOT EXISTS idx_products_barcode ON public.products (barcode);
CREATE INDEX IF NOT EXISTS idx_products_name ON public.products (name);
CREATE INDEX IF NOT EXISTS idx_products_category ON public.products (category);

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public access on products" ON public.products;
CREATE POLICY "Allow public access on products"
  ON public.products
  FOR ALL
  USING (true)
  WITH CHECK (true);`;
