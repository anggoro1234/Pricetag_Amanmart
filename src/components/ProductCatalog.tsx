import React, { useState } from 'react';
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
  EyeOff
} from 'lucide-react';
import { Product, ProductStock, StoreLocation, LabelTemplateConfig, UserRole, PrintQueueItem } from '../types';
import { audioService } from '../services/audioService';

interface ProductCatalogProps {
  products: Product[];
  activeStore: StoreLocation;
  stores: StoreLocation[];
  onQuickPrint: (product: Product) => void;
  onAddToBatch: (product: Product, quantity: number) => void;
  onOpenBatchPrint?: () => void;
  batchQueue?: PrintQueueItem[];
  onAdjustStock: (product: Product) => void;
  onEditProduct: (product: Product) => void;
  onAddNewProduct: () => void;
  onDeleteProduct: (productId: string) => void;
  onOpenImport?: () => void;
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
  onOpenBatchPrint,
  batchQueue = [],
  onAdjustStock,
  onEditProduct,
  onAddNewProduct,
  onDeleteProduct,
  onOpenImport,
  userRole,
  showBulkPrice = false,
  onToggleBulkPrice,
}) => {
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [filterLowStockOnly, setFilterLowStockOnly] = useState<boolean>(false);
  const [batchQuantities, setBatchQuantities] = useState<Record<string, number>>({});
  const [isDragOverTray, setIsDragOverTray] = useState<boolean>(false);

  const categories = ['ALL', ...Array.from(new Set(products.map((p) => p.category)))];

  const filteredProducts = products.filter((product) => {
    const term = searchTerm.toLowerCase();
    const matchesSearch =
      product.name.toLowerCase().includes(term) ||
      product.sku.toLowerCase().includes(term) ||
      product.barcode.toLowerCase().includes(term) ||
      product.brand.toLowerCase().includes(term) ||
      product.category.toLowerCase().includes(term);

    const matchesCategory = selectedCategory === 'ALL' || product.category === selectedCategory;

    const currentStock = product.stocks[activeStore.id]?.quantity ?? 0;
    const threshold = product.stocks[activeStore.id]?.minThreshold ?? 20;
    const matchesLowStock = !filterLowStockOnly || currentStock <= threshold;

    return matchesSearch && matchesCategory && matchesLowStock;
  });

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

  // Add all filtered products from the current category to Batch Print
  const handleAddFilteredCategoryToBatch = () => {
    filteredProducts.forEach((p) => {
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

  // Export Catalog to CSV (Excel-safe ";" delimiter and ="barcode" text formula)
  const handleExportCSV = () => {
    const headers = ['Item Name', 'Barcode', 'Price', 'SKU', 'Category', 'Stock'];
    const rows = products.map((p) => [
      `"${p.name.replace(/"/g, '""')}"`,
      `="${p.barcode}"`,
      p.pricing.unitPrice,
      p.sku,
      p.category,
      p.stocks[activeStore.id]?.quantity ?? 0,
    ]);

    const csvBody = '\uFEFF' + [headers.join(';'), ...rows.map((e) => e.join(';'))].join('\r\n');
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
      {/* Top Controls Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-col sm:flex-row gap-3 items-center justify-between">
        {/* Search Field */}
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search by Name, SKU, Barcode, Brand..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
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
              {filteredProducts.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-400">
                    No products matched your search or filters.
                  </td>
                </tr>
              ) : (
                filteredProducts.map((product) => {
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
      </div>
    </div>
  );
};
