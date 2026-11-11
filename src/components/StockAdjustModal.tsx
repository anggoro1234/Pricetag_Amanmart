import React, { useState } from 'react';
import { X, ArrowUpDown, Check, AlertCircle } from 'lucide-react';
import { Product, StoreLocation, StockAdjustment } from '../types';

interface StockAdjustModalProps {
  isOpen: boolean;
  onClose: () => void;
  product: Product | null;
  activeStore: StoreLocation;
  onConfirmAdjust: (
    productId: string,
    storeId: string,
    newQuantity: number,
    reason: StockAdjustment['reason']
  ) => void;
}

export const StockAdjustModal: React.FC<StockAdjustModalProps> = ({
  isOpen,
  onClose,
  product,
  activeStore,
  onConfirmAdjust,
}) => {
  if (!isOpen || !product) return null;

  const currentStock = product.stocks[activeStore.id]?.quantity ?? 0;
  const [newQty, setNewQty] = useState<number>(currentStock);
  const [reason, setReason] = useState<StockAdjustment['reason']>('RECEIVED_SHIPMENT');

  const delta = newQty - currentStock;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onConfirmAdjust(product.id, activeStore.id, newQty, reason);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden border border-slate-200">
        <div className="px-5 py-4 bg-slate-900 text-white flex items-center justify-between">
          <h3 className="font-bold text-sm text-white flex items-center gap-2">
            <ArrowUpDown className="w-4 h-4 text-blue-400" />
            Adjust Inventory Stock
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs">
          <div>
            <div className="text-xs font-bold text-slate-800">{product.name}</div>
            <div className="text-[11px] text-slate-500 font-mono">
              SKU: {product.sku} | Location: {activeStore.name}
            </div>
          </div>

          <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex justify-between items-center">
            <span className="text-slate-600 font-semibold">Current Recorded Stock:</span>
            <span className="font-mono font-bold text-slate-900 text-sm">
              {currentStock} {product.pricing.unitLabel}s
            </span>
          </div>

          <div>
            <label className="block font-bold uppercase tracking-wider text-slate-500 mb-1">
              New Verified Stock Count
            </label>
            <input
              type="number"
              min="0"
              value={newQty}
              onChange={(e) => setNewQty(Math.max(0, parseInt(e.target.value) || 0))}
              className="w-full px-3 py-2 border border-slate-300 rounded-xl font-mono text-base font-bold text-slate-900"
            />
            <div className="mt-1 text-right font-mono font-semibold">
              Delta:{' '}
              <span className={delta >= 0 ? 'text-emerald-600' : 'text-red-600'}>
                {delta > 0 ? `+${delta}` : delta} units
              </span>
            </div>
          </div>

          <div>
            <label className="block font-bold uppercase tracking-wider text-slate-500 mb-1">
              Adjustment Reason
            </label>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value as any)}
              className="w-full px-3 py-2 border border-slate-300 rounded-xl font-semibold text-slate-800"
            >
              <option value="RECEIVED_SHIPMENT">Received Shipment / Restock</option>
              <option value="SALE">Physical Counter Sale</option>
              <option value="AUDIT_CORRECTION">Stocktake Audit Count Correction</option>
              <option value="DAMAGED">Damaged / Broken in Transit</option>
              <option value="EXPIRED">Expired / Disposed</option>
            </select>
          </div>

          <div className="pt-3 border-t border-slate-200 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-slate-300 text-slate-700 hover:bg-slate-100 rounded-xl font-semibold"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold shadow-sm active:scale-95 transition"
            >
              Save Stock Level
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
