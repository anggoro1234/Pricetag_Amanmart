import { Product } from '../types';
import { INITIAL_STORES } from '../data/initialData';

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

const generateFallbackEan13 = (seed: string): string => {
  const cleanNum = (seed || '').replace(/[^0-9]/g, '');
  let digits9 = '';
  if (cleanNum.length >= 4 && cleanNum.length <= 9) {
    digits9 = cleanNum.padStart(9, '0');
  } else {
    let hash = 2166136261;
    const str = seed || 'amanmart';
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    digits9 = (Math.abs(hash) % 900000000 + 100000000).toString().slice(0, 9);
  }
  const raw12 = ('899' + digits9).slice(0, 12);
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const n = parseInt(raw12[i], 10) || 0;
    sum += i % 2 === 0 ? n : n * 3;
  }
  const check = (10 - (sum % 10)) % 10;
  return raw12 + check.toString();
};

const ensureValidBarcode = (rawBc: string, seed: string): string => {
  const clean = (rawBc || '').trim().replace(/\s+/g, '');
  if (!clean || /^0+$/.test(clean) || clean.length < 5 || /[^0-9]/.test(clean)) {
    return generateFallbackEan13(seed);
  }
  if (clean.length === 12) {
    let sum = 0;
    for (let i = 0; i < 12; i++) {
      const n = parseInt(clean[i], 10) || 0;
      sum += i % 2 === 0 ? n : n * 3;
    }
    return clean + ((10 - (sum % 10)) % 10).toString();
  }
  if (clean.length === 13) {
    const raw12 = clean.slice(0, 12);
    let sum = 0;
    for (let i = 0; i < 12; i++) {
      const n = parseInt(raw12[i], 10) || 0;
      sum += i % 2 === 0 ? n : n * 3;
    }
    return raw12 + ((10 - (sum % 10)) % 10).toString();
  }
  return clean;
};

const mapProductToRow = (p: Product): SupabaseProductRow => ({
  id: p.id || `prod-${p.sku || Date.now()}`,
  sku: p.sku || '',
  barcode: p.barcode || '',
  barcode_type: p.barcodeType || 'EAN13',
  name: p.name || '',
  category: p.category || 'Grocery',
  brand: p.brand || 'General',
  department: p.department || `${p.category || 'Grocery'} / General`,
  currency: p.currency || 'Rp.',
  unit_price: Math.round(Number(p.pricing?.unitPrice ?? 0)),
  unit_label: p.pricing?.unitLabel || 'PCS',
  unit_quantity: Number(p.pricing?.unitQuantity ?? 1),
  bulk_price: Math.round(Number(p.pricing?.bulkPrice ?? 0)),
  bulk_label: p.pricing?.bulkLabel || 'CRT',
  bulk_quantity: Number(p.pricing?.bulkQuantity ?? 24),
  stocks: p.stocks || {},
  promotional_discount: p.promotionalDiscount || null,
  date_effective: p.dateEffective || new Date().toLocaleDateString('en-GB'),
  location_bin: p.locationBin || 'A-01-01',
  updated_at: new Date().toISOString(),
});

const mapRowToProduct = (r: SupabaseProductRow, index: number): Product => {
  const sku = String(r.sku || r.SKU || `${1000000 + index}`).trim();
  const rawName = String(r.name || r['Item Name'] || '').trim();
  const name = (rawName || `ITEM SKU ${sku}`).toUpperCase();
  const rawBarcode = String(r.barcode || r.Barcode || '').trim();
  const barcode = ensureValidBarcode(rawBarcode, sku || name);
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
    barcodeType: (r.barcode_type as Product['barcodeType']) || 'EAN13',
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

// ============================================================================
// 3. Supabase Cloud Integration Service (Chunked Batch Upsert + Paginated Fetch)
// ============================================================================
class SupabaseService {
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
    if (typeof window !== 'undefined') return;
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

  private getHeaders(cfg: SupabaseConfig, extra?: Record<string, string>): Record<string, string> {
    return {
      apikey: cfg.anonKey,
      Authorization: `Bearer ${cfg.anonKey}`,
      'Content-Type': 'application/json',
      ...extra,
    };
  }

  // Helper fetch that supports both standard JWT anon keys (eyJ...) and new Supabase publishable keys (sb_publishable_...)
  private async requestWithKeyFallback(
    url: string,
    anonKey: string,
    init: RequestInit,
    extraHeaders?: Record<string, string>
  ): Promise<Response> {
    const headersWithBearer: Record<string, string> = {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      ...extraHeaders,
    };
    const resp = await fetch(url, { ...init, headers: headersWithBearer });
    if (resp.status === 401 && anonKey.startsWith('sb_')) {
      const headersApiKeyOnly: Record<string, string> = {
        apikey: anonKey,
        ...extraHeaders,
      };
      return fetch(url, { ...init, headers: headersApiKeyOnly });
    }
    return resp;
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
        `${url}/rest/v1/products?select=id&limit=1`,
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

  // Fetch all products (supports 10,000+ rows using paginated 1,000-row Range requests)
  async fetchAllProducts(onProgress?: (loaded: number) => void): Promise<Product[] | null> {
    if (!this.isConfigured()) return null;
    const cfg = this.getConfig();

    const pageSize = 1000;
    let offset = 0;
    const allRows: SupabaseProductRow[] = [];

    try {
      while (true) {
        const rangeStart = offset;
        const rangeEnd = offset + pageSize - 1;

        const resp = await this.requestWithKeyFallback(
          `${cfg.url}/rest/v1/products?select=*`,
          cfg.anonKey,
          { method: 'GET' },
          {
            'Content-Type': 'application/json',
            Range: `${rangeStart}-${rangeEnd}`,
          }
        );

        if (!resp.ok) {
          return null;
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

        offset += pageSize;
        if (offset >= 100000) break;
      }

      this.saveConfig({ ...cfg, lastSyncedAt: new Date().toISOString() });
      return allRows.map((row, idx) => mapRowToProduct(row, idx));
    } catch {
      return null;
    }
  }

  // Upsert 10,000+ products in safe batches of 400 rows per HTTP request
  async upsertProductsBatch(
    products: Product[],
    onProgress?: (completed: number, total: number) => void
  ): Promise<{ ok: boolean; synced: number; error?: string }> {
    if (!this.isConfigured()) {
      return { ok: false, synced: 0, error: 'Supabase belum dikonfigurasi' };
    }

    const cfg = this.getConfig();
    const batchSize = 400;
    const total = products.length;
    let synced = 0;

    try {
      for (let i = 0; i < total; i += batchSize) {
        const chunk = products.slice(i, i + batchSize).map(mapProductToRow);

        const resp = await this.requestWithKeyFallback(
          `${cfg.url}/rest/v1/products?on_conflict=id`,
          cfg.anonKey,
          {
            method: 'POST',
            body: JSON.stringify(chunk),
          },
          {
            'Content-Type': 'application/json',
            Prefer: 'resolution=merge-duplicates,return=minimal',
          }
        );

        if (!resp.ok) {
          const errText = await resp.text();
          if (
            resp.status === 404 ||
            errText.includes('relation') ||
            errText.includes('does not exist') ||
            errText.includes('PGRST205')
          ) {
            return {
              ok: false,
              synced,
              error:
                'Tabel "public.products" belum dibuat di Supabase. Silakan jalankan SQL Schema di menu SQL Editor Supabase Anda terlebih dahulu.',
            };
          }
          return {
            ok: false,
            synced,
            error: `Supabase error (${resp.status}): ${errText.slice(0, 150)}`,
          };
        }

        synced += chunk.length;
        if (onProgress) {
          onProgress(synced, total);
        }
      }

      this.saveConfig({ ...cfg, lastSyncedAt: new Date().toISOString() });
      return { ok: true, synced };
    } catch (err: any) {
      return {
        ok: false,
        synced,
        error: err?.message || 'Gagal mengunggah batch ke Supabase',
      };
    }
  }

  // Upsert a single product
  async upsertSingleProduct(product: Product): Promise<boolean> {
    if (!this.isConfigured()) return false;
    const cfg = this.getConfig();
    try {
      const resp = await this.requestWithKeyFallback(
        `${cfg.url}/rest/v1/products?on_conflict=id`,
        cfg.anonKey,
        {
          method: 'POST',
          body: JSON.stringify([mapProductToRow(product)]),
        },
        {
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates,return=minimal',
        }
      );
      return resp.ok;
    } catch {
      return false;
    }
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
