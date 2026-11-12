-- ============================================================================
-- AMANMART PRICETAG & INVENTORY SYSTEM - SUPABASE SQL SCHEMA
-- Cara Pakai:
-- 1. Buka dashboard https://supabase.com -> pilih Project Anda
-- 2. Buka menu "SQL Editor" di sidebar kiri -> klik "New Query"
-- 3. Copy & Paste seluruh isi file ini lalu klik tombol "Run"
-- ============================================================================

-- 1. Tabel Utama Produk (Mendukung 10.000 - 100.000+ Item Katalog)
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

-- 2. Index untuk pencarian cepat 10.000+ data berdasarkan SKU, Barcode, Nama, dan Kategori
CREATE INDEX IF NOT EXISTS idx_products_sku ON public.products (sku);
CREATE INDEX IF NOT EXISTS idx_products_barcode ON public.products (barcode);
CREATE INDEX IF NOT EXISTS idx_products_name ON public.products (name);
CREATE INDEX IF NOT EXISTS idx_products_category ON public.products (category);

-- 3. Aktifkan Row Level Security (RLS) & Kebijakan Akses API
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read access on products" ON public.products;
CREATE POLICY "Allow public read access on products"
  ON public.products
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Allow public insert access on products" ON public.products;
CREATE POLICY "Allow public insert access on products"
  ON public.products
  FOR INSERT
  WITH CHECK (true);

DROP POLICY IF EXISTS "Allow public update access on products" ON public.products;
CREATE POLICY "Allow public update access on products"
  ON public.products
  FOR UPDATE
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Allow public delete access on products" ON public.products;
CREATE POLICY "Allow public delete access on products"
  ON public.products
  FOR DELETE
  USING (true);
