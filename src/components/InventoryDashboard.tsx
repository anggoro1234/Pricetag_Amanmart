import React, { useState } from 'react';
import { 
  TrendingUp, 
  Package, 
  AlertTriangle, 
  DollarSign, 
  BarChart3, 
  PieChart, 
  FileText, 
  Download, 
  Printer, 
  Building2,
  Calendar,
  Layers,
  ArrowUpRight
} from 'lucide-react';
import { Product, ProductStock, StoreLocation, LabelTemplateConfig } from '../types';

interface InventoryDashboardProps {
  products: Product[];
  stores: StoreLocation[];
  activeStore: StoreLocation;
  onQuickPrint: (product: Product) => void;
  onAddBatchToQueue: (products: { product: Product; quantity: number }[]) => void;
}

export const InventoryDashboard: React.FC<InventoryDashboardProps> = ({
  products,
  stores,
  activeStore,
  onQuickPrint,
  onAddBatchToQueue,
}) => {
  const [selectedReportType, setSelectedReportType] = useState<'valuation' | 'reorder' | 'audit'>('reorder');

  // Calculate high-level KPIs
  const totalSkus = products.length;

  let totalAssetValue = 0;
  let totalUnits = 0;
  const lowStockItems: { product: Product; store: StoreLocation; current: number; min: number }[] = [];

  products.forEach((p) => {
    (Object.entries(p.stocks) as [string, ProductStock][]).forEach(([storeId, stock]) => {
      totalUnits += stock.quantity;
      totalAssetValue += stock.quantity * p.pricing.unitPrice;

      if (stock.quantity <= stock.minThreshold) {
        const s = stores.find((store) => store.id === storeId);
        if (s) {
          lowStockItems.push({
            product: p,
            store: s,
            current: stock.quantity,
            min: stock.minThreshold,
          });
        }
      }
    });
  });

  // Calculate value per category
  const categoryStats: Record<string, { count: number; value: number; units: number }> = {};
  products.forEach((p) => {
    if (!categoryStats[p.category]) {
      categoryStats[p.category] = { count: 0, value: 0, units: 0 };
    }
    const cat = categoryStats[p.category];
    cat.count += 1;
    (Object.values(p.stocks) as ProductStock[]).forEach((st) => {
      cat.units += st.quantity;
      cat.value += st.quantity * p.pricing.unitPrice;
    });
  });

  // Calculate stock by store
  const storeStockStats = stores.map((store) => {
    let units = 0;
    let val = 0;
    products.forEach((p) => {
      const q = p.stocks[store.id]?.quantity ?? 0;
      units += q;
      val += q * p.pricing.unitPrice;
    });
    return {
      store,
      units,
      val,
    };
  });

  // Export report to CSV
  const handleExportReport = () => {
    let headers: string[] = [];
    let rows: any[][] = [];
    let filename = '';

    if (selectedReportType === 'reorder') {
      headers = ['SKU', 'Barcode', 'Product Name', 'Store Location', 'Current Stock', 'Min Threshold', 'Unit Price'];
      rows = lowStockItems.map((item) => [
        item.product.sku,
        item.product.barcode,
        `"${item.product.name}"`,
        item.store.name,
        item.current,
        item.min,
        item.product.pricing.unitPrice,
      ]);
      filename = 'inventory_reorder_report.csv';
    } else {
      headers = ['SKU', 'Barcode', 'Product Name', 'Category', 'Total Units Across Stores', 'Unit Price', 'Total Valuation'];
      rows = products.map((p) => {
        const totalU = (Object.values(p.stocks) as ProductStock[]).reduce((sum, s) => sum + s.quantity, 0);
        return [
          p.sku,
          p.barcode,
          `"${p.name}"`,
          p.category,
          totalU,
          p.pricing.unitPrice,
          Number(totalU) * Number(p.pricing.unitPrice),
        ];
      });
      filename = 'inventory_valuation_report.csv';
    }

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Add all low stock items to batch queue
  const handleQueueAllLowStock = () => {
    const items = lowStockItems.map((item) => ({
      product: item.product,
      quantity: 5, // Print 5 labels for restocking
    }));
    onAddBatchToQueue(items);
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
              Rp {totalAssetValue.toLocaleString('id-ID')}
            </div>
            <div className="text-[11px] text-emerald-600 font-semibold mt-0.5">
              Across all 4 retail branches
            </div>
          </div>
          <div className="w-11 h-11 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
            <DollarSign className="w-5 h-5" />
          </div>
        </div>

        {/* Total SKUs */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Active SKU Catalog
            </span>
            <div className="text-xl font-black text-slate-900 mt-1">{totalSkus} Items</div>
            <div className="text-[11px] text-slate-500 mt-0.5">EAN-13 / Code128 Synced</div>
          </div>
          <div className="w-11 h-11 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
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
              {totalUnits.toLocaleString('id-ID')} Units
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">Ready for shelf placement</div>
          </div>
          <div className="w-11 h-11 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
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
              {lowStockItems.length} Warnings
            </div>
            <div className="text-[11px] text-red-500 font-semibold mt-0.5">
              Requires label &amp; reorder
            </div>
          </div>
          <div className="w-11 h-11 rounded-xl bg-red-50 text-red-600 flex items-center justify-center">
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
            <span className="text-xs text-slate-400">Asset Share</span>
          </div>

          <div className="space-y-3">
            {Object.entries(categoryStats).map(([category, stats]) => {
              const percent = Math.round((stats.value / (totalAssetValue || 1)) * 100);
              return (
                <div key={category} className="space-y-1">
                  <div className="flex justify-between text-xs font-medium">
                    <span className="text-slate-700 font-bold">{category}</span>
                    <span className="text-slate-500">
                      Rp {stats.value.toLocaleString('id-ID')} ({percent}%)
                    </span>
                  </div>
                  <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden">
                    <div
                      className="bg-blue-600 h-full rounded-full transition-all duration-500"
                      style={{ width: `${Math.max(5, percent)}%` }}
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
            <span className="text-xs text-slate-400">4 Locations</span>
          </div>

          <div className="space-y-3">
            {storeStockStats.map(({ store, units, val }) => {
              const percent = Math.round((units / (totalUnits || 1)) * 100);
              return (
                <div
                  key={store.id}
                  className="p-3 bg-slate-50 rounded-xl border border-slate-200/60 flex items-center justify-between"
                >
                  <div>
                    <div className="text-xs font-bold text-slate-800">{store.name}</div>
                    <div className="text-[11px] text-slate-500">
                      {store.city} ({store.code})
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs font-black text-slate-900">
                      {units.toLocaleString()} units ({percent}%)
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

      {/* Reports & Low-Stock Action Panel */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="p-5 border-b border-slate-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <h3 className="font-bold text-sm text-slate-800 flex items-center gap-2">
              <FileText className="w-4 h-4 text-red-600" />
              Critical Reorder &amp; Restocking Report
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Items at or below minimum threshold requiring new shelf price labels
            </p>
          </div>

          <div className="flex items-center gap-2 self-stretch sm:self-auto justify-end">
            <button
              onClick={handleQueueAllLowStock}
              disabled={lowStockItems.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-700 disabled:bg-slate-300 text-white rounded-xl text-xs font-bold shadow-xs transition"
            >
              <Layers className="w-3.5 h-3.5" />
              Batch Print All ({lowStockItems.length})
            </button>
            <button
              onClick={handleExportReport}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition"
            >
              <Download className="w-3.5 h-3.5" />
              Export CSV
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-slate-500 font-bold uppercase tracking-wider">
                <th className="py-3 px-4">Product Name</th>
                <th className="py-3 px-4">SKU / Barcode</th>
                <th className="py-3 px-4">Store Location</th>
                <th className="py-3 px-4 text-center">Current / Min</th>
                <th className="py-3 px-4">Unit Price</th>
                <th className="py-3 px-4 text-right">Quick Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {lowStockItems.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-slate-400">
                    All store locations are well-stocked. No low-stock alerts.
                  </td>
                </tr>
              ) : (
                lowStockItems.map(({ product, store, current, min }, idx) => (
                  <tr key={`${product.id}-${store.id}-${idx}`} className="hover:bg-slate-50">
                    <td className="py-3 px-4 font-bold text-slate-800">
                      {product.name}
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-500">
                      {product.sku} ({product.barcode})
                    </td>
                    <td className="py-3 px-4 text-slate-700 font-medium">
                      {store.name}
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
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
