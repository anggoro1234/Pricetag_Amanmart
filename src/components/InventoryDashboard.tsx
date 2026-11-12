import React, { useState, useMemo } from 'react';
import { 
  TrendingUp, 
  Package, 
  AlertTriangle, 
  DollarSign, 
  BarChart3, 
  FileText, 
  Download, 
  Printer, 
  Building2,
  Layers,
  Search,
  ChevronLeft,
  ChevronRight,
  Filter
} from 'lucide-react';
import { Product, ProductStock, StoreLocation } from '../types';

interface InventoryDashboardProps {
  products: Product[];
  stores: StoreLocation[];
  activeStore: StoreLocation;
  onQuickPrint: (product: Product) => void;
  onAddBatchToQueue: (products: { product: Product; quantity: number }[]) => void;
}

interface LowStockEntry {
  product: Product;
  store: StoreLocation;
  current: number;
  min: number;
}

export const InventoryDashboard: React.FC<InventoryDashboardProps> = ({
  products,
  stores,
  activeStore,
  onQuickPrint,
  onAddBatchToQueue,
}) => {
  const [selectedReportType, setSelectedReportType] = useState<'reorder' | 'valuation'>('reorder');
  const [selectedStoreFilter, setSelectedStoreFilter] = useState<string>(activeStore?.id || 'ALL');
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState<string>('ALL');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(50);

  // Fast single-pass O(N) memoized calculation for 10,000+ products across 8 branches
  const analyticsData = useMemo(() => {
    const storeMap = new Map<string, StoreLocation>();
    const storeStatsMap = new Map<string, { store: StoreLocation; units: number; val: number; lowStockCount: number }>();

    stores.forEach((s) => {
      storeMap.set(s.id, s);
      storeStatsMap.set(s.id, { store: s, units: 0, val: 0, lowStockCount: 0 });
    });

    let totalAssetValue = 0;
    let totalUnits = 0;
    const lowStockItems: LowStockEntry[] = [];
    const categoryStats: Record<string, { count: number; value: number; units: number }> = {};
    const categoriesSet = new Set<string>();

    for (let i = 0; i < products.length; i++) {
      const p = products[i];
      const unitPrice = Number(p.pricing?.unitPrice) || 0;
      const catName = p.category || 'Grocery';
      categoriesSet.add(catName);

      if (!categoryStats[catName]) {
        categoryStats[catName] = { count: 0, value: 0, units: 0 };
      }
      const catEntry = categoryStats[catName];
      catEntry.count += 1;

      const stocksObj = p.stocks || {};
      const storeIds = Object.keys(stocksObj);

      for (let j = 0; j < storeIds.length; j++) {
        const storeId = storeIds[j];
        const stock: ProductStock | undefined = stocksObj[storeId];
        if (!stock) continue;

        const qty = Number(stock.quantity) || 0;
        const min = Number(stock.minThreshold ?? 20);
        const itemVal = qty * unitPrice;

        totalUnits += qty;
        totalAssetValue += itemVal;
        catEntry.units += qty;
        catEntry.value += itemVal;

        const stStat = storeStatsMap.get(storeId);
        if (stStat) {
          stStat.units += qty;
          stStat.val += itemVal;
          if (qty <= min) {
            stStat.lowStockCount += 1;
            lowStockItems.push({
              product: p,
              store: stStat.store,
              current: qty,
              min,
            });
          }
        } else if (qty <= min) {
          const foundStore = storeMap.get(storeId);
          if (foundStore) {
            lowStockItems.push({
              product: p,
              store: foundStore,
              current: qty,
              min,
            });
          }
        }
      }
    }

    const sortedCategories = Object.entries(categoryStats).sort((a, b) => b[1].value - a[1].value);
    const storeStockStats = Array.from(storeStatsMap.values());
    const categories = ['ALL', ...Array.from(categoriesSet)];

    return {
      totalSkus: products.length,
      totalAssetValue,
      totalUnits,
      lowStockItems,
      sortedCategories,
      storeStockStats,
      categories,
    };
  }, [products, stores]);

  // Filtered rows for the selected report type (Memoized so searching/filtering 10,000+ rows is instant)
  const filteredLowStock = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return analyticsData.lowStockItems.filter((entry) => {
      if (selectedStoreFilter !== 'ALL' && entry.store.id !== selectedStoreFilter) return false;
      if (selectedCategoryFilter !== 'ALL' && entry.product.category !== selectedCategoryFilter) return false;
      if (q) {
        return (
          entry.product.name.toLowerCase().includes(q) ||
          entry.product.sku.toLowerCase().includes(q) ||
          entry.product.barcode.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [analyticsData.lowStockItems, selectedStoreFilter, selectedCategoryFilter, searchTerm]);

  const filteredValuationProducts = useMemo(() => {
    if (selectedReportType !== 'valuation') return [];
    const q = searchTerm.trim().toLowerCase();
    return products.filter((p) => {
      if (selectedCategoryFilter !== 'ALL' && p.category !== selectedCategoryFilter) return false;
      if (q) {
        return (
          p.name.toLowerCase().includes(q) ||
          p.sku.toLowerCase().includes(q) ||
          p.barcode.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [products, selectedReportType, selectedCategoryFilter, searchTerm]);

  const totalReportRows =
    selectedReportType === 'reorder' ? filteredLowStock.length : filteredValuationProducts.length;
  const totalPages = Math.max(1, Math.ceil(totalReportRows / pageSize));
  const safePage = Math.min(currentPage, totalPages);

  const paginatedLowStock = useMemo(() => {
    if (selectedReportType !== 'reorder') return [];
    const start = (safePage - 1) * pageSize;
    return filteredLowStock.slice(start, start + pageSize);
  }, [selectedReportType, filteredLowStock, safePage, pageSize]);

  const paginatedValuation = useMemo(() => {
    if (selectedReportType !== 'valuation') return [];
    const start = (safePage - 1) * pageSize;
    return filteredValuationProducts.slice(start, start + pageSize);
  }, [selectedReportType, filteredValuationProducts, safePage, pageSize]);

  // High-Capacity Blob CSV Export (Supports 10,000+ rows without browser URI limit crash)
  const handleExportReport = () => {
    let headers: string[] = [];
    let rows: (string | number)[][] = [];
    let filename = '';

    if (selectedReportType === 'reorder') {
      headers = ['SKU', 'Barcode', 'Product Name', 'Category', 'Store Location', 'Current Stock', 'Min Threshold', 'Unit Price'];
      rows = filteredLowStock.map((item) => [
        item.product.sku,
        `="${item.product.barcode}"`,
        `"${item.product.name.replace(/"/g, '""')}"`,
        item.product.category,
        item.store.name,
        item.current,
        item.min,
        item.product.pricing.unitPrice,
      ]);
      filename = `inventory_reorder_report_${selectedStoreFilter === 'ALL' ? 'all_branches' : selectedStoreFilter}.csv`;
    } else {
      headers = ['SKU', 'Barcode', 'Product Name', 'Category', 'Units (Selected Scope)', 'Unit Price', 'Total Valuation'];
      rows = filteredValuationProducts.map((p) => {
        const totalU =
          selectedStoreFilter === 'ALL'
            ? (Object.values(p.stocks) as ProductStock[]).reduce((sum, s) => sum + (Number(s.quantity) || 0), 0)
            : Number(p.stocks[selectedStoreFilter]?.quantity ?? 0);
        return [
          p.sku,
          `="${p.barcode}"`,
          `"${p.name.replace(/"/g, '""')}"`,
          p.category,
          totalU,
          p.pricing.unitPrice,
          totalU * Number(p.pricing.unitPrice || 0),
        ];
      });
      filename = `inventory_valuation_report_${selectedStoreFilter === 'ALL' ? 'all_branches' : selectedStoreFilter}.csv`;
    }

    const csvBody = '\uFEFF' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\r\n');
    const blob = new Blob([csvBody], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Queue current page items to batch print safely (prevents DOM freeze from queuing 10,000 SVGs at once)
  const handleQueueCurrentPageLowStock = () => {
    const sourceItems =
      selectedReportType === 'reorder'
        ? paginatedLowStock.map((item) => item.product)
        : paginatedValuation;

    const uniqueProductsMap = new Map<string, Product>();
    sourceItems.forEach((p) => {
      if (!uniqueProductsMap.has(p.id)) {
        uniqueProductsMap.set(p.id, p);
      }
    });

    const items = Array.from(uniqueProductsMap.values()).map((product) => ({
      product,
      quantity: 1,
    }));

    if (items.length > 0) {
      onAddBatchToQueue(items);
    }
  };

  return (
    <div className="space-y-6">
      {/* KPI Cards Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Valuation */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Total Inventory Value
            </span>
            <div className="text-xl font-black text-slate-900 mt-1">
              Rp {analyticsData.totalAssetValue.toLocaleString('id-ID')}
            </div>
            <div className="text-[11px] text-emerald-600 font-semibold mt-0.5">
              Across all {stores.length} retail branches
            </div>
          </div>
          <div className="w-11 h-11 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
            <DollarSign className="w-5 h-5" />
          </div>
        </div>

        {/* Total SKUs */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Active SKU Catalog
            </span>
            <div className="text-xl font-black text-slate-900 mt-1">
              {analyticsData.totalSkus.toLocaleString('id-ID')} Items
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">EAN-13 / Code128 Synced</div>
          </div>
          <div className="w-11 h-11 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
            <Package className="w-5 h-5" />
          </div>
        </div>

        {/* Total Stock Units */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Total Stock Units
            </span>
            <div className="text-xl font-black text-slate-900 mt-1">
              {analyticsData.totalUnits.toLocaleString('id-ID')} Units
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">Ready for shelf placement</div>
          </div>
          <div className="w-11 h-11 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
            <TrendingUp className="w-5 h-5" />
          </div>
        </div>

        {/* Low Stock Alerts */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Low-Stock Warnings
            </span>
            <div className="text-xl font-black text-red-600 mt-1">
              {filteredLowStock.length.toLocaleString('id-ID')} Warnings
            </div>
            <div className="text-[11px] text-red-500 font-semibold mt-0.5">
              {selectedStoreFilter === 'ALL'
                ? `Across ${stores.length} branches`
                : `At selected branch`}
            </div>
          </div>
          <div className="w-11 h-11 rounded-xl bg-red-50 text-red-600 flex items-center justify-center shrink-0">
            <AlertTriangle className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Analytics Charts & Visualizations */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Category Breakdown Bar Chart */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-blue-600" />
              <h3 className="font-bold text-sm text-slate-800">
                Inventory Valuation by Category
              </h3>
            </div>
            <span className="text-xs text-slate-400">
              {analyticsData.sortedCategories.length} Categories
            </span>
          </div>

          <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
            {analyticsData.sortedCategories.map(([category, stats]) => {
              const percent = Math.round(
                (stats.value / (analyticsData.totalAssetValue || 1)) * 100
              );
              return (
                <div key={category} className="space-y-1">
                  <div className="flex justify-between text-xs font-medium">
                    <span className="text-slate-700 font-bold">
                      {category}{' '}
                      <span className="text-[11px] font-normal text-slate-400">
                        ({stats.count.toLocaleString('id-ID')} SKU)
                      </span>
                    </span>
                    <span className="text-slate-500">
                      Rp {stats.value.toLocaleString('id-ID')} ({percent}%)
                    </span>
                  </div>
                  <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden">
                    <div
                      className="bg-blue-600 h-full rounded-full transition-all duration-500"
                      style={{ width: `${Math.max(4, percent)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Store Comparison */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Building2 className="w-4 h-4 text-indigo-600" />
              <h3 className="font-bold text-sm text-slate-800">
                Stock Distribution Across Store Branches
              </h3>
            </div>
            <span className="text-xs text-slate-400">{stores.length} Locations</span>
          </div>

          <div className="space-y-2.5 max-h-80 overflow-y-auto pr-1">
            {analyticsData.storeStockStats.map(({ store, units, val, lowStockCount }) => {
              const percent = Math.round((units / (analyticsData.totalUnits || 1)) * 100);
              const isSelected = selectedStoreFilter === store.id;
              return (
                <div
                  key={store.id}
                  onClick={() => {
                    setSelectedStoreFilter(isSelected ? 'ALL' : store.id);
                    setCurrentPage(1);
                  }}
                  className={`p-3 rounded-xl border transition cursor-pointer flex items-center justify-between ${
                    isSelected
                      ? 'bg-indigo-50/80 border-indigo-300 shadow-xs'
                      : 'bg-slate-50 border-slate-200/60 hover:bg-slate-100/80'
                  }`}
                  title="Klik untuk memfilter tabel laporan berdasarkan cabang ini"
                >
                  <div>
                    <div className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                      <span>{store.name}</span>
                      <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-slate-200 text-slate-700">
                        {store.code}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500 flex items-center gap-2 mt-0.5">
                      <span>{store.city}</span>
                      <span>•</span>
                      <span className="text-red-600 font-semibold">
                        {lowStockCount.toLocaleString('id-ID')} low stock
                      </span>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs font-black text-slate-900">
                      {units.toLocaleString('id-ID')} units ({percent}%)
                    </div>
                    <div className="text-[10px] text-slate-500">
                      Rp {val.toLocaleString('id-ID')}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Reports & Low-Stock Action Panel (Paginated & Searchable for 10,000+ Items) */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-bold text-sm text-slate-800 flex items-center gap-2">
                <FileText className="w-4 h-4 text-red-600" />
                {selectedReportType === 'reorder'
                  ? 'Critical Reorder & Restocking Report'
                  : 'Full Catalog Valuation & Stock Report'}
              </h3>
              <div className="inline-flex rounded-lg bg-slate-100 p-0.5 border border-slate-200 text-[11px] font-bold">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedReportType('reorder');
                    setCurrentPage(1);
                  }}
                  className={`px-2.5 py-1 rounded-md transition ${
                    selectedReportType === 'reorder'
                      ? 'bg-white text-red-600 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Low-Stock Reorder ({filteredLowStock.length.toLocaleString('id-ID')})
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedReportType('valuation');
                    setCurrentPage(1);
                  }}
                  className={`px-2.5 py-1 rounded-md transition ${
                    selectedReportType === 'valuation'
                      ? 'bg-white text-emerald-700 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Valuation Report ({products.length.toLocaleString('id-ID')})
                </button>
              </div>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Menampilkan halaman {safePage} dari {totalPages.toLocaleString('id-ID')} ({totalReportRows.toLocaleString('id-ID')} baris ditemukan — dioptimalkan agar super cepat &amp; bebas lag)
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleQueueCurrentPageLowStock}
              disabled={totalReportRows === 0}
              className="flex items-center gap-1.5 px-3 py-2 bg-red-600 hover:bg-red-700 disabled:bg-slate-300 text-white rounded-xl text-xs font-bold shadow-xs transition"
              title="Tambahkan produk di halaman ini ke antrean Batch Print"
            >
              <Layers className="w-3.5 h-3.5" />
              Batch Print Halaman Ini (
              {selectedReportType === 'reorder'
                ? paginatedLowStock.length
                : paginatedValuation.length}
              )
            </button>
            <button
              onClick={handleExportReport}
              disabled={totalReportRows === 0}
              className="flex items-center gap-1.5 px-3 py-2 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 text-white rounded-xl text-xs font-semibold transition"
            >
              <Download className="w-3.5 h-3.5" />
              Export Semua ({totalReportRows.toLocaleString('id-ID')}) ke CSV
            </button>
          </div>
        </div>

        {/* Filter & Pagination Bar */}
        <div className="px-4 sm:px-5 py-3 bg-slate-50 border-b border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-2 flex-1">
            {/* Search Input */}
            <div className="relative w-full sm:w-64">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setCurrentPage(1);
                }}
                placeholder="Cari Nama, SKU, Barcode..."
                className="w-full pl-8 pr-3 py-1.5 bg-white border border-slate-300 rounded-xl text-xs font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            {/* Store Branch Filter */}
            <div className="flex items-center gap-1.5">
              <Filter className="w-3.5 h-3.5 text-slate-400 hidden sm:inline" />
              <select
                value={selectedStoreFilter}
                onChange={(e) => {
                  setSelectedStoreFilter(e.target.value);
                  setCurrentPage(1);
                }}
                className="px-2.5 py-1.5 bg-white border border-slate-300 rounded-xl text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                <option value="ALL">Semua Cabang ({stores.length} Lokasi)</option>
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    Cabang {s.code} - {s.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Category Filter */}
            <select
              value={selectedCategoryFilter}
              onChange={(e) => {
                setSelectedCategoryFilter(e.target.value);
                setCurrentPage(1);
              }}
              className="px-2.5 py-1.5 bg-white border border-slate-300 rounded-xl text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              {analyticsData.categories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat === 'ALL' ? 'Semua Kategori' : cat}
                </option>
              ))}
            </select>
          </div>

          {/* Pagination Controls */}
          <div className="flex items-center justify-between md:justify-end gap-2">
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setCurrentPage(1);
              }}
              className="px-2 py-1 bg-white border border-slate-300 rounded-lg text-xs font-semibold text-slate-700"
            >
              <option value={50}>50 / hal</option>
              <option value={100}>100 / hal</option>
              <option value={200}>200 / hal</option>
            </select>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={safePage <= 1}
                className="p-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 disabled:opacity-40"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <span className="px-2.5 py-1 rounded-lg bg-white border border-slate-200 font-bold text-slate-700">
                {safePage} / {totalPages.toLocaleString('id-ID')}
              </span>
              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={safePage >= totalPages}
                className="p-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 disabled:opacity-40"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Table Content */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-slate-500 font-bold uppercase tracking-wider">
                <th className="py-3 px-4">Product Name</th>
                <th className="py-3 px-4">SKU / Barcode</th>
                <th className="py-3 px-4">
                  {selectedReportType === 'reorder' ? 'Store Location' : 'Category'}
                </th>
                <th className="py-3 px-4 text-center">
                  {selectedReportType === 'reorder' ? 'Current / Min' : 'Total Stock'}
                </th>
                <th className="py-3 px-4">Unit Price</th>
                <th className="py-3 px-4 text-right">Quick Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {selectedReportType === 'reorder' ? (
                paginatedLowStock.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-10 text-center text-slate-400">
                      Tidak ada item low-stock untuk filter cabang/kategori ini.
                    </td>
                  </tr>
                ) : (
                  paginatedLowStock.map(({ product, store, current, min }, idx) => (
                    <tr key={`${product.id}-${store.id}-${idx}`} className="hover:bg-slate-50">
                      <td className="py-3 px-4 font-bold text-slate-800">
                        <div>{product.name}</div>
                        <div className="text-[10px] font-normal text-emerald-700">
                          {product.category}
                        </div>
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-500">
                        {product.sku} ({product.barcode})
                      </td>
                      <td className="py-3 px-4 text-slate-700 font-medium">
                        {store.name} ({store.code})
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span className="font-mono font-bold text-red-600 bg-red-50 px-2 py-0.5 rounded border border-red-200">
                          {current} / {min}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-bold text-slate-900">
                        {product.currency} {product.pricing.unitPrice.toLocaleString('id-ID')}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <button
                          onClick={() => onQuickPrint(product)}
                          className="flex items-center gap-1 px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold ml-auto transition"
                        >
                          <Printer className="w-3 h-3 text-blue-600" />
                          Print Label
                        </button>
                      </td>
                    </tr>
                  ))
                )
              ) : paginatedValuation.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-slate-400">
                    Tidak ada produk yang cocok dengan pencarian Anda.
                  </td>
                </tr>
              ) : (
                paginatedValuation.map((product) => {
                  const scopedQty =
                    selectedStoreFilter === 'ALL'
                      ? (Object.values(product.stocks) as ProductStock[]).reduce(
                          (sum, s) => sum + (Number(s.quantity) || 0),
                          0
                        )
                      : Number(product.stocks[selectedStoreFilter]?.quantity ?? 0);
                  const totalVal = scopedQty * Number(product.pricing.unitPrice || 0);

                  return (
                    <tr key={product.id} className="hover:bg-slate-50">
                      <td className="py-3 px-4 font-bold text-slate-800">{product.name}</td>
                      <td className="py-3 px-4 font-mono text-slate-500">
                        {product.sku} ({product.barcode})
                      </td>
                      <td className="py-3 px-4 text-slate-700 font-medium">
                        {product.category}
                      </td>
                      <td className="py-3 px-4 text-center font-mono font-bold text-slate-800">
                        {scopedQty.toLocaleString('id-ID')} PCS
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-bold text-slate-900">
                          {product.currency} {product.pricing.unitPrice.toLocaleString('id-ID')}
                        </div>
                        <div className="text-[10px] text-emerald-700 font-semibold">
                          Nilai: Rp {totalVal.toLocaleString('id-ID')}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <button
                          onClick={() => onQuickPrint(product)}
                          className="flex items-center gap-1 px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold ml-auto transition"
                        >
                          <Printer className="w-3 h-3 text-blue-600" />
                          Print Label
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Bottom Pagination Footer */}
        {totalPages > 1 && (
          <div className="px-4 sm:px-5 py-3 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-600">
            <span>
              Menampilkan baris{' '}
              <strong>{((safePage - 1) * pageSize + 1).toLocaleString('id-ID')}</strong> –{' '}
              <strong>
                {Math.min(safePage * pageSize, totalReportRows).toLocaleString('id-ID')}
              </strong>{' '}
              dari <strong>{totalReportRows.toLocaleString('id-ID')}</strong> total item
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setCurrentPage(1)}
                disabled={safePage <= 1}
                className="px-2.5 py-1 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 font-semibold disabled:opacity-40"
              >
                First
              </button>
              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={safePage <= 1}
                className="px-2.5 py-1 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 font-semibold disabled:opacity-40"
              >
                Prev
              </button>
              <span className="px-3 py-1 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 font-bold">
                Hal {safePage} / {totalPages.toLocaleString('id-ID')}
              </span>
              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={safePage >= totalPages}
                className="px-2.5 py-1 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 font-semibold disabled:opacity-40"
              >
                Next
              </button>
              <button
                type="button"
                onClick={() => setCurrentPage(totalPages)}
                disabled={safePage >= totalPages}
                className="px-2.5 py-1 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 font-semibold disabled:opacity-40"
              >
                Last
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
