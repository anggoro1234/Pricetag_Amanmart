-- ============================================================================
-- AMANMART PRICETAG & INVENTORY SYSTEM - SUPABASE SQL SCHEMA (SUPPORT 10.000+ ITEM)
-- Project URL: https://otbujeoxvwfnqwnpxnnd.supabase.co
--
-- Cara Pakai:
-- 1. Buka dashboard https://supabase.com/dashboard/project/otbujeoxvwfnqwnpxnnd
-- 2. Buka menu "SQL Editor" di sidebar kiri -> klik "New Query"
-- 3. Copy & Paste seluruh isi file ini lalu klik tombol "Run"
-- ============================================================================

-- 1. Tabel Utama Produk (Mendukung Import via Web App maupun Import CSV Langsung di Supabase)
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
  -- Kolom opsional untuk kompatibilitas jika Anda meng-upload file CSV
  -- (SKU,Item Name,Barcode,Price,Category,Stock) langsung lewat Supabase Table Editor:
  "SKU" TEXT,
  "Item Name" TEXT,
  "Barcode" TEXT,
  "Price" NUMERIC,
  "Category" TEXT,
  "Stock" NUMERIC
);

-- Pastikan kolom kompatibilitas CSV tersedia jika tabel sudah pernah dibuat sebelumnya
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS "SKU" TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS "Item Name" TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS "Barcode" TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS "Price" NUMERIC;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS "Category" TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS "Stock" NUMERIC;

-- 2. Trigger Otomatis: Jika data masuk dari CSV Supabase ("SKU", "Item Name", "Barcode", "Price", "Category", "Stock"),
--    otomatis salin dan normalkan ke kolom utama aplikasi (sku, name, barcode, unit_price, category, stocks)
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

-- 3. Index untuk pencarian cepat 10.000+ data berdasarkan SKU, Barcode, Nama, dan Kategori
CREATE INDEX IF NOT EXISTS idx_products_sku ON public.products (sku);
CREATE INDEX IF NOT EXISTS idx_products_barcode ON public.products (barcode);
CREATE INDEX IF NOT EXISTS idx_products_name ON public.products (name);
CREATE INDEX IF NOT EXISTS idx_products_category ON public.products (category);

-- 4. Aktifkan Row Level Security (RLS) & Kebijakan Akses API
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public access on products" ON public.products;
DROP POLICY IF EXISTS "Allow public read access on products" ON public.products;
DROP POLICY IF EXISTS "Allow public insert access on products" ON public.products;
DROP POLICY IF EXISTS "Allow public update access on products" ON public.products;
DROP POLICY IF EXISTS "Allow public delete access on products" ON public.products;

CREATE POLICY "Allow public access on products"
  ON public.products
  FOR ALL
  USING (true)
  WITH CHECK (true);
