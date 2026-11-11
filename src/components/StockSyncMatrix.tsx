import React, { useState } from 'react';
import { 
  Building2, 
  ArrowRightLeft, 
  CheckCircle2, 
  Clock, 
  PlusCircle, 
  MinusCircle, 
  RefreshCw, 
  ArrowUpRight, 
  ShieldCheck, 
  Wifi, 
  WifiOff, 
  AlertTriangle,
  History
} from 'lucide-react';
import { Product, ProductStock, StoreLocation, StockTransfer, StockAdjustment, UserRole } from '../types';
import { storageService } from '../services/storageService';
import { audioService } from '../services/audioService';

interface StockSyncMatrixProps {
  products: Product[];
  stores: StoreLocation[];
  activeStore: StoreLocation;
  userRole: UserRole;
  userName: string;
}

export const StockSyncMatrix: React.FC<StockSyncMatrixProps> = ({
  products,
  stores,
  activeStore,
  userRole,
  userName,
}) => {
  const [activeTab, setActiveTab] = useState<'matrix' | 'transfers' | 'audit'>('matrix');
  const [transferModalOpen, setTransferModalOpen] = useState<boolean>(false);
  const [selectedProductId, setSelectedProductId] = useState<string>(products[0]?.id || '');
  const [fromStoreId, setFromStoreId] = useState<string>(stores[0]?.id || '');
  const [toStoreId, setToStoreId] = useState<string>(stores[1]?.id || '');
  const [transferQty, setTransferQty] = useState<number>(10);
  const [transferSuccess, setTransferSuccess] = useState<string | null>(null);

  const transfers = storageService.getTransfers();
  const adjustments = storageService.getAdjustments();
  const isOnline = storageService.isOnline();
  const pendingQueue = storageService.getOfflineQueue();

  const handleExecuteTransfer = (e: React.FormEvent) => {
    e.preventDefault();
    if (fromStoreId === toStoreId) {
      alert('Source and destination stores must be different.');
      return;
    }

    try {
      storageService.transferStock(
        fromStoreId,
        toStoreId,
        selectedProductId,
        transferQty,
        userName
      );
      audioService.playPrintCompleteChime();
      setTransferSuccess(`Successfully transferred ${transferQty} units!`);
      setTimeout(() => {
        setTransferSuccess(null);
        setTransferModalOpen(false);
      }, 1500);
    } catch (err: any) {
      alert(err.message || 'Transfer failed');
      audioService.playErrorTone();
    }
  };

  return (
    <div className="space-y-4">
      {/* Cloud Sync Status Header Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-indigo-950 p-5 rounded-2xl text-white shadow-md border border-slate-700 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-indigo-500/20 border border-indigo-400/40 flex items-center justify-center text-indigo-400">
            <Building2 className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-white">
                Multi-Store Cloud Stock Synchronization Engine
              </h2>
              <span className="flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                Live Sync Active
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Real-time stock balance across {stores.length} store branches &amp; central distribution depot
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 self-start md:self-auto">
          {pendingQueue.length > 0 && (
            <div className="bg-amber-500/20 border border-amber-500/40 text-amber-300 text-xs px-3 py-1.5 rounded-xl flex items-center gap-1.5 font-semibold">
              <Clock className="w-3.5 h-3.5" />
              {pendingQueue.length} Offline Actions Pending
            </div>
          )}

          {(userRole === 'ADMIN' || userRole === 'MANAGER') && (
            <button
              onClick={() => setTransferModalOpen(true)}
              className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition shadow-sm"
            >
              <ArrowRightLeft className="w-4 h-4" />
              New Inter-Store Transfer
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200 bg-white px-4 rounded-t-2xl gap-2 pt-2">
        <button
          onClick={() => setActiveTab('matrix')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold border-b-2 transition ${
            activeTab === 'matrix'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Building2 className="w-4 h-4" />
          Stock Levels Matrix
        </button>
        <button
          onClick={() => setActiveTab('transfers')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold border-b-2 transition ${
            activeTab === 'transfers'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <ArrowRightLeft className="w-4 h-4" />
          Transfer History ({transfers.length})
        </button>
        <button
          onClick={() => setActiveTab('audit')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold border-b-2 transition ${
            activeTab === 'audit'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <History className="w-4 h-4" />
          Stock Adjustment Audit Log ({adjustments.length})
        </button>
      </div>

      {/* Tab 1: Matrix View */}
      {activeTab === 'matrix' && (
        <div className="bg-white rounded-b-2xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 font-bold uppercase tracking-wider">
                  <th className="py-3 px-4">Product Details</th>
                  <th className="py-3 px-4">SKU / Barcode</th>
                  {stores.map((store) => (
                    <th key={store.id} className="py-3 px-4 text-center">
                      <div>{store.code}</div>
                      <div className="text-[10px] text-slate-400 font-normal">
                        {store.city}
                      </div>
                    </th>
                  ))}
                  <th className="py-3 px-4 text-center font-black text-slate-900">
                    Total Network
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {products.map((product) => {
                  const total = (Object.values(product.stocks) as ProductStock[]).reduce(
                    (sum, s) => sum + s.quantity,
                    0
                  );

                  return (
                    <tr key={product.id} className="hover:bg-slate-50/80 transition">
                      <td className="py-3 px-4 font-bold text-slate-800">
                        {product.name}
                        <div className="text-[11px] text-slate-400 font-normal">
                          {product.category}
                        </div>
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-600">
                        <div>{product.sku}</div>
                        <div className="text-[10px] text-slate-400">{product.barcode}</div>
                      </td>

                      {stores.map((store) => {
                        const stock = product.stocks[store.id];
                        const qty = stock?.quantity ?? 0;
                        const min = stock?.minThreshold ?? 20;
                        const isLow = qty <= min;

                        return (
                          <td key={store.id} className="py-3 px-4 text-center">
                            <span
                              className={`inline-block font-mono font-bold text-xs px-2.5 py-1 rounded-md ${
                                isLow
                                  ? 'bg-red-100 text-red-700 border border-red-200 font-black'
                                  : 'bg-slate-100 text-slate-800'
                              }`}
                            >
                              {qty}
                            </span>
                            {isLow && (
                              <span className="block text-[9px] text-red-600 font-bold mt-0.5">
                                LOW
                              </span>
                            )}
                          </td>
                        );
                      })}

                      <td className="py-3 px-4 text-center">
                        <span className="font-mono font-black text-sm text-indigo-700 bg-indigo-50 px-3 py-1 rounded-lg">
                          {total}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 2: Transfer History */}
      {activeTab === 'transfers' && (
        <div className="bg-white rounded-b-2xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 font-bold uppercase tracking-wider">
                  <th className="py-3 px-4">Date &amp; Time</th>
                  <th className="py-3 px-4">Product</th>
                  <th className="py-3 px-4">From Store</th>
                  <th className="py-3 px-4">To Store</th>
                  <th className="py-3 px-4 text-center">Quantity</th>
                  <th className="py-3 px-4">Initiated By</th>
                  <th className="py-3 px-4 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {transfers.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-slate-400">
                      No stock transfers recorded yet.
                    </td>
                  </tr>
                ) : (
                  transfers.map((t) => {
                    const from = stores.find((s) => s.id === t.fromStoreId);
                    const to = stores.find((s) => s.id === t.toStoreId);

                    return (
                      <tr key={t.id} className="hover:bg-slate-50 transition">
                        <td className="py-3 px-4 font-mono text-slate-500">
                          {new Date(t.timestamp).toLocaleString()}
                        </td>
                        <td className="py-3 px-4 font-bold text-slate-800">
                          {t.productName}
                          <div className="text-[10px] text-slate-400 font-mono">
                            SKU: {t.sku}
                          </div>
                        </td>
                        <td className="py-3 px-4 font-medium text-slate-700">
                          {from?.name || t.fromStoreId}
                        </td>
                        <td className="py-3 px-4 font-medium text-indigo-700">
                          {to?.name || t.toStoreId}
                        </td>
                        <td className="py-3 px-4 text-center font-bold text-slate-900 font-mono text-sm">
                          {t.quantity}
                        </td>
                        <td className="py-3 px-4 text-slate-600">{t.initiatedBy}</td>
                        <td className="py-3 px-4 text-right">
                          <span className="bg-emerald-100 text-emerald-800 text-[10px] font-extrabold px-2 py-0.5 rounded-full">
                            {t.status}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 3: Adjustments Audit Log */}
      {activeTab === 'audit' && (
        <div className="bg-white rounded-b-2xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 font-bold uppercase tracking-wider">
                  <th className="py-3 px-4">Date</th>
                  <th className="py-3 px-4">Store</th>
                  <th className="py-3 px-4">Product</th>
                  <th className="py-3 px-4">Reason</th>
                  <th className="py-3 px-4 text-center">Previous &rarr; New</th>
                  <th className="py-3 px-4 text-center">Delta</th>
                  <th className="py-3 px-4 text-right">Operator</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {adjustments.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-slate-400">
                      No stock adjustments logged yet.
                    </td>
                  </tr>
                ) : (
                  adjustments.map((a) => {
                    const st = stores.find((s) => s.id === a.storeId);
                    return (
                      <tr key={a.id} className="hover:bg-slate-50 transition">
                        <td className="py-3 px-4 font-mono text-slate-500">
                          {new Date(a.timestamp).toLocaleString()}
                        </td>
                        <td className="py-3 px-4 font-semibold text-slate-800">
                          {st?.name || a.storeId}
                        </td>
                        <td className="py-3 px-4 font-bold text-slate-800">
                          {a.productName}
                          <div className="text-[10px] text-slate-400 font-mono">
                            SKU: {a.sku}
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <span className="bg-slate-100 text-slate-700 text-[10px] font-semibold px-2 py-0.5 rounded">
                            {a.reason.replace(/_/g, ' ')}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-center font-mono">
                          {a.previousQty} &rarr; <strong>{a.newQty}</strong>
                        </td>
                        <td className="py-3 px-4 text-center font-mono font-bold">
                          <span
                            className={a.delta >= 0 ? 'text-emerald-600' : 'text-red-600'}
                          >
                            {a.delta > 0 ? `+${a.delta}` : a.delta}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right text-slate-600">
                          {a.performedBy}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Transfer Modal */}
      {transferModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden border border-slate-200">
            <div className="px-5 py-4 bg-slate-900 text-white flex items-center justify-between">
              <h3 className="font-bold text-sm text-white flex items-center gap-2">
                <ArrowRightLeft className="w-4 h-4 text-indigo-400" />
                Inter-Store Inventory Transfer
              </h3>
              <button
                onClick={() => setTransferModalOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleExecuteTransfer} className="p-5 space-y-4">
              {transferSuccess && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-xs font-semibold flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  {transferSuccess}
                </div>
              )}

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">
                  Select Product
                </label>
                <select
                  value={selectedProductId}
                  onChange={(e) => setSelectedProductId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs font-semibold"
                >
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} (SKU: {p.sku})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">
                    Source Store (From)
                  </label>
                  <select
                    value={fromStoreId}
                    onChange={(e) => setFromStoreId(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs font-semibold"
                  >
                    {stores.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">
                    Destination Store (To)
                  </label>
                  <select
                    value={toStoreId}
                    onChange={(e) => setToStoreId(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs font-semibold"
                  >
                    {stores.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">
                  Quantity to Transfer
                </label>
                <input
                  type="number"
                  min="1"
                  max="5000"
                  value={transferQty}
                  onChange={(e) => setTransferQty(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm font-bold font-mono"
                />
              </div>

              <div className="pt-3 border-t border-slate-200 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setTransferModalOpen(false)}
                  className="px-4 py-2 border border-slate-300 text-slate-700 hover:bg-slate-100 rounded-xl text-xs font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold"
                >
                  Confirm Transfer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
