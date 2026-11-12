import React, { useState, useMemo } from 'react';
import { 
  Search, 
  Plus, 
  Printer, 
  Layers, 
  Download, 
  Upload, 
  Edit3, 
  Trash2,
  AlertTriangle, 
  ArrowUpDown, 
  Barcode as BarcodeIcon, 
  GripVertical,
  FolderPlus,
  Eye,
  EyeOff,
  Database,
  RefreshCw,
  CheckCircle2
} from 'lucide-react';
import { Product, ProductStock, StoreLocation, LabelTemplateConfig, UserRole, PrintQueueItem, ImportProductRecord } from '../types';
import { audioService } from '../services/audioService';
import { storageService, sanitizeBarcodeValue, normalizeCategoryName } from '../services/storageService';

interface ProductCatalogProps {
  products: Product[];
  activeStore: StoreLocation;
  stores: StoreLocation[];
  onQuickPrint: (product: Product) => void;
  onAddToBatch: (product: Product, quantity: number) => void;
  onAddBatchToQueue?: (items: { product: Product; quantity: number }[]) => void;
  onOpenBatchPrint?: () => void;
  batchQueue?: PrintQueueItem[];
  onAdjustStock: (product: Product) => void;
  onEditProduct: (product: Product) => void;
  onAddNewProduct: () => void;
  onDeleteProduct: (productId: string) => void;
  onOpenImport?: () => void;
  onOpenSupabaseModal?: () => void;
  userRole: UserRole;
  templates: LabelTemplateConfig[];
  showBulkPrice?: boolean;
  onToggleBulkPrice?: (show: boolean) => void;
}

export const ProductCatalog: React.FC<ProductCatalogProps> = ({
  products,
  activeStore,
  stores,
  onQuickPrint,
  onAddToBatch,
  onAddBatchToQueue,
  onOpenBatchPrint,
  batchQueue = [],
  onAdjustStock,
  onEditProduct,
  onAddNewProduct,
  onDeleteProduct,
  onOpenImport,
  onOpenSupabaseModal,
  userRole,
  showBulkPrice = false,
  onToggleBulkPrice,
}) => {
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [filterLowStockOnly, setFilterLowStockOnly] = useState<boolean>(false);
  const [batchQuantities, setBatchQuantities] = useState<Record<string, number>>({});
  const [isDragOverTray, setIsDragOverTray] = useState<boolean>(false);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(100);
  const [isMigratingMaster, setIsMigratingMaster] = useState<boolean>(false);
  const [migrationMessage, setMigrationMessage] = useState<string | null>(null);

  const isLegacyLocalDemo = storageService.isUsingLegacyLocalDemoData();

  // Quick 1-click helper to parse & replace local demo data with the 10,112-row master CSV and sync to Supabase
  const handleReplaceWithMaster10k = async () => {
    setIsMigratingMaster(true);
    setMigrationMessage('Memuat 10.112 item dari Master Excel & menghapus data lokal lama...');
    try {
      const resp = await fetch('/ITEMLISTMASTER_cleaned.csv');
      if (!resp.ok) throw new Error('File master CSV tidak ditemukan.');
      const text = await resp.text();
      const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim().length > 0);
      const records: ImportProductRecord[] = [];

      // Parse CSV lines respecting quotes for "SKU,Item Name,Barcode,Price,Category,Stock"
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        const cols: string[] = [];
        let cur = '';
        let inQuotes = false;
        for (let cIdx = 0; cIdx < line.length; cIdx++) {
          const ch = line[cIdx];
          if (ch === '"') {
            if (inQuotes && line[cIdx + 1] === '"') {
              cur += '"';
              cIdx++;
            } else {
              inQuotes = !inQuotes;
            }
          } else if (ch === ',' && !inQuotes) {
            cols.push(cur.trim());
            cur = '';
          } else {
            cur += ch;
          }
        }
        cols.push(cur.trim());

        const sku = (cols[0] || '').trim();
        const rawName = (cols[1] || '').trim().replace(/^["']+|["']+$/g, '');
        const name = (rawName || (sku ? `ITEM SKU ${sku}` : '')).toUpperCase();
        if (!name) continue;

        const rawBarcode = (cols[2] || '').trim();
        const priceNum = parseFloat((cols[3] || '0').replace(/,/g, ''));
        const price = isNaN(priceNum) || priceNum < 0 ? 0 : Math.round(priceNum);
        const category = normalizeCategoryName(cols[4]);
        const stockNum = parseFloat((cols[5] || '0').replace(/,/g, ''));
        const stock = isNaN(stockNum) ? 0 : Math.max(0, Math.round(stockNum));

        records.push({
          sku: sku || undefined,
          name,
          barcode: sanitizeBarcodeValue(rawBarcode, sku || name),
          price,
          category,
          stock,
        });
      }

      storageService.importProducts(records, activeStore.id, true, true);
      setCurrentPage(1);
      audioService.playPrintCompleteChime();

      setMigrationMessage(
        `Berhasil! Data lokal lama telah dihapus dan digantikan dengan ${records.length.toLocaleString('id-ID')} item Master Amanmart (tersimpan di IndexedDB & sedang disinkronkan ke Supabase).`
      );
      setTimeout(() => setMigrationMessage(null), 7000);
    } catch (err: any) {
      setMigrationMessage(`Gagal memuat master data: ${err?.message || 'Unknown error'}`);
    } finally {
      setIsMigratingMaster(false);
    }
  };

  const handlePurgeLocalDataOnly = async () => {
    if (
      window.confirm(
        'Bersihkan seluruh data lokal lama (seperti BONELESS PAHA FZ/ KG, dll.) dari browser ini agar siap menggunakan data Supabase / Import baru?'
      )
    ) {
      await storageService.clearLocalCatalog(false);
      setCurrentPage(1);
      setMigrationMessage(
        'Data lokal lama berhasil dibersihkan! Sekarang Anda dapat meng-import 10.000+ item atau menarik data dari Supabase.'
      );
      setTimeout(() => setMigrationMessage(null), 5000);
    }
  };

  const categories = useMemo(
    () => ['ALL', ...Array.from(new Set(products.map((p) => p.category)))],
    [products]
  );

  const filteredProducts = useMemo(() => {
    const term = searchTerm
      .replace(/[\u0000-\u001F\u007F\u200B-\u200D\uFEFF]/g, '')
      .trim()
      .toLowerCase();
    const numericNoZero = /^\d{6,}$/.test(term) ? term.replace(/^0+/, '') : '';

    return products.filter((product) => {
      const matchesSearch =
        !term ||
        product.name.toLowerCase().includes(term) ||
        product.sku.toLowerCase().includes(term) ||
        product.barcode.toLowerCase().includes(term) ||
        (numericNoZero.length >= 6 &&
          product.barcode.trim().replace(/^0+/, '').toLowerCase() === numericNoZero) ||
        product.brand.toLowerCase().includes(term) ||
        product.category.toLowerCase().includes(term);

      const matchesCategory = selectedCategory === 'ALL' || product.category === selectedCategory;

      const currentStock = product.stocks[activeStore.id]?.quantity ?? 0;
      const threshold = product.stocks[activeStore.id]?.minThreshold ?? 20;
      const matchesLowStock = !filterLowStockOnly || currentStock <= threshold;

      return matchesSearch && matchesCategory && matchesLowStock;
    });
  }, [products, searchTerm, selectedCategory, activeStore.id, filterLowStockOnly]);

  const totalPages = Math.max(1, Math.ceil(filteredProducts.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedProducts = filteredProducts.slice((safePage - 1) * pageSize, safePage * pageSize);

  const getBatchQty = (productId: string) => batchQuantities[productId] || 1;

  const setBatchQty = (productId: string, val: number) => {
    setBatchQuantities({ ...batchQuantities, [productId]: Math.max(1, val) });
  };

  // Drag & Drop from Catalog Row to Multi-Category Print Tray
  const handleRowDragStart = (e: React.DragEvent, product: Product) => {
    e.dataTransfer.setData('application/x-catalog-product-id', product.id);
    e.dataTransfer.effectAllowed = 'copy';
  };

  const handleTrayDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (!isDragOverTray) setIsDragOverTray(true);
  };

  const handleTrayDragLeave = () => {
    setIsDragOverTray(false);
  };

  const handleTrayDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOverTray(false);
    const productId = e.dataTransfer.getData('application/x-catalog-product-id');
    if (productId) {
      const found = products.find((p) => p.id === productId);
      if (found) {
        onAddToBatch(found, getBatchQty(found.id));
        audioService.playScanBeep();
      }
    }
  };

  // Add current page products from the selected category to Batch Print safely
  const handleAddFilteredCategoryToBatch = () => {
    const targetList = paginatedProducts;
    if (onAddBatchToQueue) {
      onAddBatchToQueue(
        targetList.map((p) => ({
          product: p,
          quantity: getBatchQty(p.id),
        }))
      );
      return;
    }
    targetList.forEach((p) => {
      onAddToBatch(p, getBatchQty(p.id));
    });
    audioService.playScanBeep();
    if (onOpenBatchPrint) onOpenBatchPrint();
  };

  // Delete single product with confirmation
  const handleConfirmDelete = (product: Product) => {
    if (window.confirm(`Hapus item "${product.name}" (SKU: ${product.sku}) dari daftar produk?`)) {
      onDeleteProduct(product.id);
    }
  };

  // Export Catalog to CSV matching "SKU,Item Name,Barcode,Price,Category,Stock"
  const handleExportCSV = () => {
    const headers = ['SKU', 'Item Name', 'Barcode', 'Price', 'Category', 'Stock'];
    const rows = products.map((p) => [
      p.sku,
      `"${p.name.replace(/"/g, '""')}"`,
      p.barcode,
      p.pricing.unitPrice,
      p.category,
      p.stocks[activeStore.id]?.quantity ?? 0,
    ]);

    const csvBody = '\uFEFF' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\r\n');
    const blob = new Blob([csvBody], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `inventory_catalog_${activeStore.code}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const totalBatchLabels = batchQueue.reduce((sum, item) => sum + item.quantity, 0);
  const batchCategories = Array.from(new Set(batchQueue.map((i) => i.product.category)));

  return (
    <div className="space-y-4">
      {/* Mitigasi Data Lokal Lama & Integrasi Supabase Banner */}
      {(isLegacyLocalDemo || products.length === 0 || migrationMessage) && (
        <div className="p-4 rounded-2xl bg-gradient-to-r from-emerald-950 via-emerald-900 to-teal-900 text-white border border-emerald-700/60 shadow-sm flex flex-col lg:flex-row lg:items-center justify-between gap-3.5">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-400/40 flex items-center justify-center text-emerald-300 shrink-0 mt-0.5">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-xs sm:text-sm font-bold text-white">
                  {migrationMessage
                    ? 'Status Mitigasi & Sinkronisasi Supabase'
                    : isLegacyLocalDemo
                    ? 'Mitigasi Data Lokal Lama Terdeteksi (BONELESS PAHA FZ/ KG, dll.)'
                    : 'Katalog Lokal Kosong — Siap Memuat Data Supabase / Master 10.000+ Item'}
                </h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-500/30 border border-emerald-400/40 text-emerald-200">
                  Supabase Terhubung: otbujeoxvwfnqwnpxnnd
                </span>
              </div>
              <p className="text-[11px] sm:text-xs text-emerald-100/90 mt-1 leading-relaxed max-w-3xl">
                {migrationMessage
                  ? migrationMessage
                  : 'Data lokal lama bawaan browser sudah tidak diperlukan karena sistem kini terintegrasi dengan Supabase & IndexedDB High-Capacity. Klik tombol di kanan untuk langsung mengganti seluruh data lokal lama dengan 10.112 Item Master Excel Anda atau membersihkan data lokal.'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleReplaceWithMaster10k}
              disabled={isMigratingMaster}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-extrabold text-xs shadow-sm transition active:scale-95 disabled:opacity-50"
            >
              {isMigratingMaster ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <CheckCircle2 className="w-3.5 h-3.5" />
              )}
              <span>
                {isMigratingMaster
                  ? 'Memproses 10.112 Item...'
                  : 'Ganti dengan 10.112 Item Master & Sync Supabase'}
              </span>
            </button>

            {isLegacyLocalDemo && (
              <button
                type="button"
                onClick={handlePurgeLocalDataOnly}
                disabled={isMigratingMaster}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-red-500/20 hover:bg-red-500/30 border border-red-400/40 text-red-100 font-bold text-xs transition"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Hapus Data Lokal Lama</span>
              </button>
            )}

            {onOpenSupabaseModal && (
              <button
                type="button"
                onClick={onOpenSupabaseModal}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 text-white font-semibold text-xs transition"
              >
                <Database className="w-3.5 h-3.5 text-emerald-300" />
                <span>Panel Supabase</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Top Controls Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-col sm:flex-row gap-3 items-center justify-between">
        {/* Search Field */}
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder="Search or PDA Scan Name, SKU, Barcode..."
            value={searchTerm}
            onChange={(e) => {
              const cleaned = e.target.value.replace(/[\u0000-\u001F\u007F\u200B-\u200D\uFEFF]/g, '');
              setSearchTerm(cleaned);
            }}
            onPaste={(e) => {
              const pasted = e.clipboardData?.getData('text');
              if (pasted) {
                e.preventDefault();
                const cleaned = pasted.replace(/[\u0000-\u001F\u007F\u200B-\u200D\uFEFF]/g, '').trim();
                setSearchTerm(cleaned);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Tab' && searchTerm.trim().length >= 3) {
                e.preventDefault();
              }
            }}
            className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:ring-2 focus:ring-emerald-500 focus:outline-none"
          />
        </div>

        {/* Filters and Actions */}
        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto justify-end">
          {/* Category Dropdown */}
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
          >
            {categories.map((c) => (
              <option key={c} value={c}>
                {c === 'ALL' ? 'All Categories' : c}
              </option>
            ))}
          </select>

          {/* Toggle PCS Only vs PCS + CRT Bulk Price */}
          {onToggleBulkPrice && (
            <button
              onClick={() => onToggleBulkPrice(!showBulkPrice)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border transition ${
                showBulkPrice
                  ? 'bg-blue-50 border-blue-300 text-blue-800'
                  : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
              }`}
              title="Ubah tampilan harga CRT (data harga CRT tetap tersimpan aman)"
            >
              {showBulkPrice ? (
                <>
                  <Eye className="w-3.5 h-3.5 text-blue-600" />
                  Harga: PCS + CRT
                </>
              ) : (
                <>
                  <EyeOff className="w-3.5 h-3.5 text-slate-500" />
                  Harga: Hanya PCS
                </>
              )}
            </button>
          )}

          {/* Add Entire Selected Category to Print Batch */}
          {selectedCategory !== 'ALL' && filteredProducts.length > 0 && (
            <button
              onClick={handleAddFilteredCategoryToBatch}
              className="flex items-center gap-1.5 px-3 py-2 bg-blue-50 hover:bg-blue-100 border border-blue-300 text-blue-800 rounded-xl text-xs font-bold transition"
              title={`Tambahkan semua produk kategori ${selectedCategory} ke Batch Print`}
            >
              <FolderPlus className="w-3.5 h-3.5 text-blue-600" />
              + Print Kategori ({filteredProducts.length})
            </button>
          )}

          {/* Low Stock Filter Button */}
          <button
            onClick={() => setFilterLowStockOnly(!filterLowStockOnly)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border transition ${
              filterLowStockOnly
                ? 'bg-amber-50 border-amber-300 text-amber-800'
                : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
            }`}
          >
            <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
            Low Stock Only
          </button>

          {/* Export CSV */}
          <button
            onClick={handleExportCSV}
            className="flex items-center gap-1.5 px-3 py-2 bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition"
            title="Export to CSV"
          >
            <Download className="w-3.5 h-3.5" />
            Export
          </button>

          {/* Import CSV / Items */}
          {(userRole === 'ADMIN' || userRole === 'MANAGER') && onOpenImport && (
            <button
              onClick={onOpenImport}
              className="flex items-center gap-1.5 px-3 py-2 bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 text-emerald-800 rounded-xl text-xs font-bold transition shadow-xs"
              title="Import Item, Barcode, Price from CSV or Spreadsheet"
            >
              <Upload className="w-3.5 h-3.5 text-emerald-600" />
              Import
            </button>
          )}

          {/* Add Product Button (Admin or Manager) */}
          {(userRole === 'ADMIN' || userRole === 'MANAGER') && (
            <button
              onClick={onAddNewProduct}
              className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-sm transition active:scale-95"
            >
              <Plus className="w-4 h-4" />
              Add Product
            </button>
          )}
        </div>
      </div>

      {/* Multi-Category Drag & Drop Batch Print Dropzone Bar */}
      <div
        onDragOver={handleTrayDragOver}
        onDragLeave={handleTrayDragLeave}
        onDrop={handleTrayDrop}
        className={`p-3.5 rounded-2xl border-2 border-dashed transition-all flex flex-col sm:flex-row items-center justify-between gap-3 ${
          isDragOverTray
            ? 'bg-emerald-50 border-emerald-500 shadow-md scale-[1.005]'
            : batchQueue.length > 0
            ? 'bg-emerald-50/50 border-emerald-300'
            : 'bg-white border-slate-200'
        }`}
      >
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center flex-shrink-0">
            <Layers className="w-4 h-4" />
          </div>
          <div>
            <div className="text-xs font-bold text-slate-800 flex items-center gap-2 flex-wrap">
              <span>Multi-Category Batch Print Tray (Drag &amp; Drop Produk ke Sini)</span>
              {batchQueue.length > 0 && (
                <span className="bg-emerald-600 text-white text-[10px] px-2 py-0.5 rounded-full font-extrabold">
                  {batchQueue.length} Produk • {totalBatchLabels} Label ({batchCategories.join(', ')})
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-500">
              Tarik (drag) baris produk dari tabel di bawah ke kotak ini, atau klik tombol <strong>Print</strong> untuk menggabungkan produk beda kategori &amp; barcode (misal: Indomie + Kecap/Saus).
            </p>
          </div>
        </div>

        {onOpenBatchPrint && (
          <button
            onClick={onOpenBatchPrint}
            className="flex items-center gap-1.5 px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold shadow-xs transition flex-shrink-0"
          >
            <Printer className="w-3.5 h-3.5 text-emerald-400" />
            Buka Multi-Category Print ({totalBatchLabels})
          </button>
        )}
      </div>

      {/* Products Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/75 text-slate-500 font-bold uppercase tracking-wider">
                <th className="py-3 px-4">Item Details &amp; SKU</th>
                <th className="py-3 px-4">Barcode</th>
                <th className="py-3 px-4">
                  {showBulkPrice ? 'Unit / Bulk Pricing' : 'Unit Pricing (Per PCS)'}
                </th>
                <th className="py-3 px-4 text-center">
                  Stock at {activeStore.code}
                </th>
                <th className="py-3 px-4 text-center">All Stores Network</th>
                <th className="py-3 px-4 text-right">Label Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {paginatedProducts.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-400">
                    No products matched your search or filters.
                  </td>
                </tr>
              ) : (
                paginatedProducts.map((product) => {
                  const stock = product.stocks[activeStore.id];
                  const currentQty = stock?.quantity ?? 0;
                  const threshold = stock?.minThreshold ?? 20;
                  const isLow = currentQty <= threshold;
                  const isAttachedExample =
                    product.sku === '1001040' || product.sku === '1001041';
                  const inBatchItem = batchQueue.find((q) => q.product.id === product.id);

                  // Total stock across all branches
                  const totalNetworkStock = (Object.values(product.stocks) as ProductStock[]).reduce(
                    (sum, s) => sum + s.quantity,
                    0
                  );

                  return (
                    <tr
                      key={product.id}
                      draggable
                      onDragStart={(e) => handleRowDragStart(e, product)}
                      className={`hover:bg-slate-50/80 transition group cursor-grab active:cursor-grabbing ${
                        inBatchItem ? 'bg-emerald-50/30' : ''
                      }`}
                      title="Drag baris ini ke Multi-Category Batch Print Tray di atas untuk menambahkan ke cetakan"
                    >
                      {/* Product Name & SKU */}
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-2">
                          <GripVertical className="w-4 h-4 text-slate-300 group-hover:text-slate-500 flex-shrink-0" />
                          <div>
                            <div className="font-bold text-slate-900 flex items-center gap-1.5 flex-wrap">
                              {product.name}
                              {isAttachedExample && (
                                <span className="bg-blue-100 text-blue-700 text-[10px] font-extrabold px-1.5 py-0.5 rounded tracking-tight">
                                  ★ Attached Example
                                </span>
                              )}
                              {inBatchItem && (
                                <span className="bg-emerald-100 text-emerald-800 text-[10px] font-extrabold px-1.5 py-0.5 rounded">
                                  In Batch ({inBatchItem.quantity}x)
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-slate-400 flex items-center gap-2 mt-0.5">
                              <span className="font-mono font-semibold text-slate-600">
                                SKU: {product.sku}
                              </span>
                              <span>•</span>
                              <span>{product.brand}</span>
                              <span>•</span>
                              <span className="font-semibold text-emerald-700 bg-emerald-50 px-1.5 py-0.2 rounded">
                                {product.category}
                              </span>
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Barcode */}
                      <td className="py-3.5 px-4 font-mono text-slate-700">
                        <div className="flex items-center gap-1.5">
                          <BarcodeIcon className="w-4 h-4 text-slate-400" />
                          <span>{product.barcode}</span>
                        </div>
                      </td>

                      {/* Pricing (Shows only PCS price by default; CRT shown when toggled ON) */}
                      <td className="py-3.5 px-4">
                        <div className="font-bold text-red-600 text-sm leading-tight">
                          {product.currency} {product.pricing.unitPrice.toLocaleString('id-ID')}
                          <span className="text-xs text-slate-500 font-normal">
                            {' '}
                            / {product.pricing.unitLabel}
                          </span>
                        </div>
                        {showBulkPrice && product.pricing.bulkPrice ? (
                          <div className="text-[11px] text-slate-500 font-medium">
                            {product.currency} {product.pricing.bulkPrice.toLocaleString('id-ID')}
                            <span className="text-[10px]">
                              {' '}
                              / {product.pricing.bulkLabel} ({product.pricing.bulkQuantity})
                            </span>
                          </div>
                        ) : null}
                      </td>

                      {/* Current Store Stock */}
                      <td className="py-3.5 px-4 text-center">
                        <div className="inline-flex flex-col items-center">
                          <span
                            className={`font-black text-sm px-2.5 py-0.5 rounded-full ${
                              isLow
                                ? 'bg-red-100 text-red-700 border border-red-200'
                                : 'bg-emerald-100 text-emerald-800'
                            }`}
                          >
                            {currentQty} {product.pricing.unitLabel}s
                          </span>
                          {isLow && (
                            <span className="text-[10px] text-red-600 font-bold mt-0.5 flex items-center gap-1">
                              <AlertTriangle className="w-2.5 h-2.5" /> Reorder Alert (&le;{threshold})
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Total Network Stock */}
                      <td className="py-3.5 px-4 text-center">
                        <div className="text-xs font-bold text-slate-800">
                          {totalNetworkStock} total
                        </div>
                        <div className="text-[10px] text-slate-400">across {stores.length} locations</div>
                      </td>

                      {/* Label Actions */}
                      <td className="py-3.5 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {/* Batch Quantity Selector */}
                          <div className="flex items-center bg-slate-100 rounded-lg p-0.5">
                            <input
                              type="number"
                              min="1"
                              max="500"
                              value={getBatchQty(product.id)}
                              onChange={(e) =>
                                setBatchQty(product.id, parseInt(e.target.value) || 1)
                              }
                              className="w-10 text-center bg-transparent text-xs font-bold text-slate-700 border-none focus:outline-none"
                              title="Number of labels to print"
                            />
                            <button
                              onClick={() => {
                                onAddToBatch(product, getBatchQty(product.id));
                                audioService.playScanBeep();
                              }}
                              className="p-1 hover:bg-white rounded text-slate-700 hover:text-emerald-600 transition"
                              title="Add to Batch Print Queue"
                            >
                              <Layers className="w-3.5 h-3.5" />
                            </button>
                          </div>

                          {/* Quick 1-Click Print */}
                          <button
                            onClick={() => onQuickPrint(product)}
                            className="flex items-center gap-1 px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold shadow-xs transition active:scale-95"
                            title="Add & Open Multi-Category Print Preview"
                          >
                            <Printer className="w-3.5 h-3.5" />
                            Print
                          </button>

                          {/* Adjust Stock */}
                          {(userRole === 'ADMIN' || userRole === 'MANAGER') && (
                            <button
                              onClick={() => onAdjustStock(product)}
                              className="p-1.5 hover:bg-slate-100 text-slate-500 hover:text-slate-900 rounded-lg transition"
                              title="Adjust Stock Quantity"
                            >
                              <ArrowUpDown className="w-3.5 h-3.5" />
                            </button>
                          )}

                          {/* Edit Product Details */}
                          <button
                            onClick={() => onEditProduct(product)}
                            className="p-1.5 hover:bg-blue-50 text-slate-500 hover:text-blue-600 rounded-lg transition"
                            title={`Edit ${product.name}`}
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>

                          {/* Delete Product Item */}
                          <button
                            onClick={() => handleConfirmDelete(product)}
                            className="p-1.5 hover:bg-red-50 text-slate-400 hover:text-red-600 rounded-lg transition"
                            title={`Hapus ${product.name}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Controls for 10,000+ Items */}
        {filteredProducts.length > 0 && (
          <div className="px-4 py-3 border-t border-slate-200 bg-slate-50 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2 text-slate-600 font-medium">
              <span>
                Menampilkan{' '}
                <strong className="text-slate-900">
                  {(safePage - 1) * pageSize + 1}–{Math.min(safePage * pageSize, filteredProducts.length)}
                </strong>{' '}
                dari <strong className="text-slate-900">{filteredProducts.length.toLocaleString('id-ID')}</strong> produk
              </span>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setCurrentPage(1);
                }}
                className="ml-2 px-2 py-1 bg-white border border-slate-300 rounded-lg font-semibold text-slate-700"
              >
                <option value={50}>50 / hal</option>
                <option value={100}>100 / hal</option>
                <option value={250}>250 / hal</option>
                <option value={500}>500 / hal</option>
              </select>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setCurrentPage(1)}
                  disabled={safePage <= 1}
                  className="px-2.5 py-1 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 disabled:opacity-40 font-bold text-slate-700"
                >
                  &laquo; Awal
                </button>
                <button
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={safePage <= 1}
                  className="px-3 py-1 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 disabled:opacity-40 font-bold text-slate-700"
                >
                  &lsaquo; Prev
                </button>
                <span className="px-3 py-1 font-bold text-slate-800 bg-emerald-50 border border-emerald-200 rounded-lg">
                  Hal {safePage} / {totalPages}
                </span>
                <button
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={safePage >= totalPages}
                  className="px-3 py-1 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 disabled:opacity-40 font-bold text-slate-700"
                >
                  Next &rsaquo;
                </button>
                <button
                  onClick={() => setCurrentPage(totalPages)}
                  disabled={safePage >= totalPages}
                  className="px-2.5 py-1 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 disabled:opacity-40 font-bold text-slate-700"
                >
                  Akhir &raquo;
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
