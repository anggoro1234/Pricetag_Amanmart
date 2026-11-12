import { Product } from '../types';

export interface SupabaseConfig {
  url: string;
  anonKey: string;
  enabled: boolean;
  lastSyncedAt?: string;
}

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

// ============================================================================
// 2. Row Mapping between App Product Type & Supabase PostgreSQL Table
// ============================================================================
interface SupabaseProductRow {
  id: string;
  sku: string;
  barcode: string;
  barcode_type: string;
  name: string;
  category: string;
  brand: string;
  department: string;
  currency: string;
  unit_price: number;
  unit_label: string;
  unit_quantity: number;
  bulk_price: number;
  bulk_label: string;
  bulk_quantity: number;
  stocks: Record<string, any>;
  promotional_discount?: any;
  date_effective?: string;
  location_bin?: string;
  updated_at?: string;
}

const mapProductToRow = (p: Product): SupabaseProductRow => ({
  id: p.id,
  sku: p.sku || '',
  barcode: p.barcode || '',
  barcode_type: p.barcodeType || 'EAN13',
  name: p.name || '',
  category: p.category || 'Grocery',
  brand: p.brand || 'General',
  department: p.department || `${p.category || 'Grocery'} / General`,
  currency: p.currency || 'Rp.',
  unit_price: Number(p.pricing?.unitPrice ?? 0),
  unit_label: p.pricing?.unitLabel || 'PCS',
  unit_quantity: Number(p.pricing?.unitQuantity ?? 1),
  bulk_price: Number(p.pricing?.bulkPrice ?? 0),
  bulk_label: p.pricing?.bulkLabel || 'CRT',
  bulk_quantity: Number(p.pricing?.bulkQuantity ?? 24),
  stocks: p.stocks || {},
  promotional_discount: p.promotionalDiscount || null,
  date_effective: p.dateEffective || new Date().toLocaleDateString('en-GB'),
  location_bin: p.locationBin || 'A-01-01',
  updated_at: new Date().toISOString(),
});

const mapRowToProduct = (r: SupabaseProductRow): Product => ({
  id: r.id,
  sku: r.sku || '',
  barcode: r.barcode || '',
  barcodeType: (r.barcode_type as Product['barcodeType']) || 'EAN13',
  name: r.name || '',
  category: r.category || 'Grocery',
  brand: r.brand || 'General',
  department: r.department || `${r.category || 'Grocery'} / General`,
  currency: r.currency || 'Rp.',
  pricing: {
    unitLabel: r.unit_label || 'PCS',
    unitQuantity: Number(r.unit_quantity ?? 1),
    unitPrice: Number(r.unit_price ?? 0),
    bulkLabel: r.bulk_label || 'CRT',
    bulkQuantity: Number(r.bulk_quantity ?? 24),
    bulkPrice: Number(r.bulk_price ?? 0),
  },
  stocks: r.stocks || {},
  promotionalDiscount: r.promotional_discount || undefined,
  dateEffective: r.date_effective || new Date().toLocaleDateString('en-GB'),
  locationBin: r.location_bin || 'A-01-01',
});

// ============================================================================
// 3. Supabase Cloud Integration Service (Chunked Batch Upsert + Paginated Fetch)
// ============================================================================
class SupabaseService {
  getConfig(): SupabaseConfig {
    const envUrl = ((import.meta as any).env?.VITE_SUPABASE_URL || '').trim();
    const envKey = ((import.meta as any).env?.VITE_SUPABASE_ANON_KEY || '').trim();

    if (typeof window !== 'undefined') {
      try {
        const raw = localStorage.getItem(SUPABASE_CONFIG_KEY);
        if (raw) {
          const parsed: SupabaseConfig = JSON.parse(raw);
          return {
            url: (parsed.url || envUrl).replace(/\/+$/, ''),
            anonKey: parsed.anonKey || envKey,
            enabled: parsed.enabled ?? Boolean(parsed.url && parsed.anonKey),
            lastSyncedAt: parsed.lastSyncedAt,
          };
        }
      } catch {}
    }

    const isEnvValid =
      Boolean(envUrl && envKey) && !envUrl.includes('your-project-id');

    return {
      url: isEnvValid ? envUrl.replace(/\/+$/, '') : '',
      anonKey: isEnvValid ? envKey : '',
      enabled: isEnvValid,
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

  private getHeaders(cfg: SupabaseConfig, extra?: Record<string, string>): Record<string, string> {
    return {
      apikey: cfg.anonKey,
      Authorization: `Bearer ${cfg.anonKey}`,
      'Content-Type': 'application/json',
      ...extra,
    };
  }

  // Test connection and verify if `products` table exists
  async testConnection(customUrl?: string, customKey?: string): Promise<{
    ok: boolean;
    message: string;
    totalRemoteCount?: number;
  }> {
    const cfg = this.getConfig();
    const url = (customUrl ?? cfg.url).trim().replace(/\/+$/, '');
    const anonKey = (customKey ?? cfg.anonKey).trim();

    if (!url || !anonKey) {
      return {
        ok: false,
        message: 'Project URL dan Anon Public Key Supabase wajib diisi.',
      };
    }

    if (!url.startsWith('https://') && !url.startsWith('http://')) {
      return {
        ok: false,
        message: 'Format URL tidak valid. Gunakan format https://<project-id>.supabase.co',
      };
    }

    try {
      const resp = await fetch(`${url}/rest/v1/products?select=id&limit=1`, {
        method: 'GET',
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`,
          Prefer: 'count=exact',
        },
      });

      if (!resp.ok) {
        const errText = await resp.text();
        if (resp.status === 404 || errText.includes('relation') || errText.includes('does not exist') || errText.includes('PGRST205')) {
          return {
            ok: false,
            message:
              'Terhubung ke Supabase, tetapi tabel "products" belum dibuat. Silakan salin & jalankan SQL Schema di menu SQL Editor Supabase Anda.',
          };
        }
        if (resp.status === 401 || resp.status === 403) {
          return {
            ok: false,
            message: 'Autentikasi gagal (401/403). Pastikan Anon Public Key benar dan RLS Policy sudah diaktifkan.',
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
        message: `Berhasil terhubung ke Supabase! (${totalRemoteCount.toLocaleString('id-ID')} produk tersimpan di Cloud)`,
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

        const resp = await fetch(
          `${cfg.url}/rest/v1/products?select=*&order=updated_at.desc`,
          {
            method: 'GET',
            headers: {
              ...this.getHeaders(cfg),
              Range: `${rangeStart}-${rangeEnd}`,
            },
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
        // Safety cap at 100,000 rows
        if (offset >= 100000) break;
      }

      this.saveConfig({ ...cfg, lastSyncedAt: new Date().toISOString() });
      return allRows.map(mapRowToProduct);
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

        const resp = await fetch(`${cfg.url}/rest/v1/products?on_conflict=id`, {
          method: 'POST',
          headers: this.getHeaders(cfg, {
            Prefer: 'resolution=merge-duplicates,return=minimal',
          }),
          body: JSON.stringify(chunk),
        });

        if (!resp.ok) {
          const errText = await resp.text();
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
      const resp = await fetch(`${cfg.url}/rest/v1/products?on_conflict=id`, {
        method: 'POST',
        headers: this.getHeaders(cfg, {
          Prefer: 'resolution=merge-duplicates,return=minimal',
        }),
        body: JSON.stringify([mapProductToRow(product)]),
      });
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
      const resp = await fetch(
        `${cfg.url}/rest/v1/products?id=eq.${encodeURIComponent(productId)}`,
        {
          method: 'DELETE',
          headers: this.getHeaders(cfg, {
            Prefer: 'return=minimal',
          }),
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
export const SUPABASE_SQL_SCHEMA = `-- Jalankan di Supabase Dashboard -> SQL Editor -> New Query:
CREATE TABLE IF NOT EXISTS public.products (
  id TEXT PRIMARY KEY,
  sku TEXT NOT NULL,
  barcode TEXT NOT NULL,
  barcode_type TEXT DEFAULT 'EAN13',
  name TEXT NOT NULL,
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
  date_effective TEXT,
  location_bin TEXT DEFAULT 'A-01-01',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

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
