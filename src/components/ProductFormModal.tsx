import React, { useState, useEffect } from 'react';
import { X, Save, Barcode as BarcodeIcon, Trash2 } from 'lucide-react';
import { Product, StoreLocation } from '../types';

interface ProductFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (product: Product) => void;
  onDelete?: (productId: string) => void;
  productToEdit?: Product | null;
  stores: StoreLocation[];
  activeStoreId: string;
}

export const ProductFormModal: React.FC<ProductFormModalProps> = ({
  isOpen,
  onClose,
  onSave,
  onDelete,
  productToEdit,
  stores,
  activeStoreId,
}) => {
  const [sku, setSku] = useState<string>('');
  const [barcode, setBarcode] = useState<string>('');
  const [name, setName] = useState<string>('');
  const [category, setCategory] = useState<string>('Grocery');
  const [brand, setBrand] = useState<string>('');
  const [unitLabel, setUnitLabel] = useState<string>('PCS');
  const [unitPrice, setUnitPrice] = useState<number>(5000);
  const [bulkLabel, setBulkLabel] = useState<string>('CRT');
  const [bulkQty, setBulkQty] = useState<number>(24);
  const [bulkPrice, setBulkPrice] = useState<number>(0);
  const [stockQuantity, setStockQuantity] = useState<number>(50);
  const [minThreshold, setMinThreshold] = useState<number>(20);

  // Sync form fields with actual productToEdit whenever modal opens or productToEdit changes
  useEffect(() => {
    if (!isOpen) return;

    if (productToEdit) {
      setSku(productToEdit.sku || '');
      setBarcode(productToEdit.barcode || '');
      setName(productToEdit.name || '');
      setCategory(productToEdit.category || 'Grocery');
      setBrand(productToEdit.brand || '');
      setUnitLabel(productToEdit.pricing?.unitLabel || 'PCS');
      setUnitPrice(productToEdit.pricing?.unitPrice ?? 0);
      setBulkLabel(productToEdit.pricing?.bulkLabel || 'CRT');
      setBulkQty(productToEdit.pricing?.bulkQuantity ?? 24);
      setBulkPrice(productToEdit.pricing?.bulkPrice ?? 0);
      setStockQuantity(productToEdit.stocks?.[activeStoreId]?.quantity ?? 0);
      setMinThreshold(productToEdit.stocks?.[activeStoreId]?.minThreshold ?? 20);
    } else {
      // Default values when adding a brand new product
      setSku(`100${Math.floor(1000 + Math.random() * 9000)}`);
      setBarcode(`899${Math.floor(1000000000 + Math.random() * 9000000000)}`);
      setName('');
      setCategory('Grocery');
      setBrand('');
      setUnitLabel('PCS');
      setUnitPrice(5000);
      setBulkLabel('CRT');
      setBulkQty(24);
      setBulkPrice(0);
      setStockQuantity(50);
      setMinThreshold(20);
    }
  }, [isOpen, productToEdit, activeStoreId]);

  if (!isOpen) return null;

  const handleGenerateEan13 = () => {
    // Generate valid 13-digit EAN barcode
    const raw12 = '899' + Math.floor(100000000 + Math.random() * 900000000).toString();
    // Compute checksum
    let sum = 0;
    for (let i = 0; i < 12; i++) {
      const n = parseInt(raw12[i]);
      sum += i % 2 === 0 ? n : n * 3;
    }
    const check = (10 - (sum % 10)) % 10;
    setBarcode(raw12 + check.toString());
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      alert('Please enter a product name');
      return;
    }

    const currentStocks: Product['stocks'] = {};
    if (productToEdit?.stocks) {
      Object.keys(productToEdit.stocks).forEach((k) => {
        currentStocks[k] = { ...productToEdit.stocks[k] };
      });
    }

    stores.forEach((s) => {
      if (!currentStocks[s.id]) {
        currentStocks[s.id] = {
          storeId: s.id,
          quantity: s.id === activeStoreId ? stockQuantity : 25,
          minThreshold: minThreshold,
          lastUpdated: new Date().toISOString(),
        };
      } else if (s.id === activeStoreId) {
        currentStocks[s.id] = {
          ...currentStocks[s.id],
          quantity: stockQuantity,
          minThreshold: minThreshold,
          lastUpdated: new Date().toISOString(),
        };
      }
    });

    const newProduct: Product = {
      ...(productToEdit || {}),
      id: productToEdit?.id || `prod-${Date.now()}`,
      sku: sku.trim(),
      barcode: barcode.trim(),
      barcodeType: productToEdit?.barcodeType || 'EAN13',
      name: name.trim().toUpperCase(),
      category: category.trim() || 'Grocery',
      brand: brand.trim() || 'General',
      department: productToEdit?.department || `${category.trim() || 'Grocery'} / General`,
      currency: productToEdit?.currency || 'Rp.',
      pricing: {
        unitLabel: unitLabel.trim().toUpperCase() || 'PCS',
        unitQuantity: productToEdit?.pricing?.unitQuantity || 1,
        unitPrice,
        bulkLabel: bulkLabel.trim().toUpperCase() || 'CRT',
        bulkQuantity: bulkQty || 24,
        bulkPrice: bulkPrice,
      },
      stocks: currentStocks,
      dateEffective: new Date().toLocaleDateString('en-GB'),
      locationBin: productToEdit?.locationBin || 'A-01-01',
    };

    onSave(newProduct);
    onClose();
  };

  const handleDeleteClick = () => {
    if (!productToEdit || !onDelete) return;
    if (window.confirm(`Hapus produk "${productToEdit.name}" (SKU: ${productToEdit.sku})?`)) {
      onDelete(productToEdit.id);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl overflow-hidden border border-slate-200 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-900 text-white flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <BarcodeIcon className="w-5 h-5 text-blue-400" />
              {productToEdit ? `Edit Product: ${productToEdit.name}` : 'Add New Inventory Product'}
            </h2>
            {productToEdit && (
              <p className="text-[11px] text-slate-400 font-mono mt-0.5">
                SKU: {productToEdit.sku} • Barcode: {productToEdit.barcode}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-4 text-xs">
          {/* Product Name */}
          <div>
            <label className="block font-bold uppercase tracking-wider text-slate-500 mb-1">
              Product Title / Shelf Label Description
            </label>
            <input
              type="text"
              placeholder="e.g. INDOMIE AYAM BAWANG BAG 69GR"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full px-3 py-2 border border-slate-300 rounded-lg font-bold text-slate-900 uppercase focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* SKU and Barcode */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-bold uppercase tracking-wider text-slate-500 mb-1">
                Internal SKU / PLU Code
              </label>
              <input
                type="text"
                value={sku}
                onChange={(e) => setSku(e.target.value)}
                required
                className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono font-bold"
              />
            </div>

            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="font-bold uppercase tracking-wider text-slate-500">
                  Barcode (EAN-13 / 128)
                </label>
                <button
                  type="button"
                  onClick={handleGenerateEan13}
                  className="text-blue-600 hover:text-blue-800 text-[10px] font-bold"
                >
                  Generate EAN-13
                </button>
              </div>
              <input
                type="text"
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                required
                className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono font-bold"
              />
            </div>
          </div>

          {/* Category and Brand */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-bold uppercase tracking-wider text-slate-500 mb-1">
                Category
              </label>
              <input
                type="text"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg font-medium"
              />
            </div>

            <div>
              <label className="block font-bold uppercase tracking-wider text-slate-500 mb-1">
                Brand
              </label>
              <input
                type="text"
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg font-medium"
              />
            </div>
          </div>

          {/* Multi-Tier Pricing */}
          <div className="p-4 bg-red-50/50 rounded-xl border border-red-200 space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-bold text-red-900 block text-xs uppercase tracking-wider">
                Retail Pricing (Harga PCS Utama &amp; Opsi Cadangan CRT)
              </span>
              <span className="text-[10px] text-slate-500 font-medium">
                Harga CRT tersimpan &amp; bisa di-toggle kapan saja
              </span>
            </div>

            {/* Unit Price */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-600 font-semibold mb-1">
                  Single Unit Price / Harga PCS (Rp.)
                </label>
                <input
                  type="number"
                  value={unitPrice}
                  onChange={(e) => setUnitPrice(parseInt(e.target.value) || 0)}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-lg font-bold text-red-600 font-mono"
                />
              </div>

              <div>
                <label className="block text-slate-600 font-semibold mb-1">
                  Unit Label (e.g. PCS, BTL)
                </label>
                <input
                  type="text"
                  value={unitLabel}
                  onChange={(e) => setUnitLabel(e.target.value)}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-lg font-bold uppercase"
                />
              </div>
            </div>

            {/* Bulk / Carton Price (Saved for future use, hidden by default on label/table) */}
            <div className="grid grid-cols-3 gap-2 pt-2 border-t border-red-200/60">
              <div>
                <label className="block text-slate-500 font-semibold mb-1">
                  Bulk / CRT Price (Rp.) [Opsional]
                </label>
                <input
                  type="number"
                  value={bulkPrice}
                  onChange={(e) => setBulkPrice(parseInt(e.target.value) || 0)}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-lg font-bold font-mono text-slate-700"
                />
              </div>

              <div>
                <label className="block text-slate-500 font-semibold mb-1">
                  Bulk Label (e.g. CRT)
                </label>
                <input
                  type="text"
                  value={bulkLabel}
                  onChange={(e) => setBulkLabel(e.target.value)}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-lg font-bold uppercase text-slate-700"
                />
              </div>

              <div>
                <label className="block text-slate-500 font-semibold mb-1">
                  Items in Bulk (Qty)
                </label>
                <input
                  type="number"
                  value={bulkQty}
                  onChange={(e) => setBulkQty(parseInt(e.target.value) || 1)}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-lg font-bold font-mono text-slate-700"
                />
              </div>
            </div>
          </div>

          {/* Initial Stock Level */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-bold uppercase tracking-wider text-slate-500 mb-1">
                Stock Quantity (Units)
              </label>
              <input
                type="number"
                value={stockQuantity}
                onChange={(e) => setStockQuantity(parseInt(e.target.value) || 0)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono font-bold"
              />
            </div>

            <div>
              <label className="block font-bold uppercase tracking-wider text-slate-500 mb-1">
                Min Reorder Alert Threshold
              </label>
              <input
                type="number"
                value={minThreshold}
                onChange={(e) => setMinThreshold(parseInt(e.target.value) || 0)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono font-bold text-amber-700"
              />
            </div>
          </div>

          {/* Footer */}
          <div className="pt-3 border-t border-slate-200 flex items-center justify-between gap-2">
            <div>
              {productToEdit && onDelete && (
                <button
                  type="button"
                  onClick={handleDeleteClick}
                  className="flex items-center gap-1.5 px-3.5 py-2 bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 rounded-xl font-bold transition"
                >
                  <Trash2 className="w-4 h-4" />
                  Hapus Item
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 border border-slate-300 text-slate-700 hover:bg-slate-100 rounded-xl font-semibold"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex items-center gap-1.5 px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold shadow-sm active:scale-95 transition"
              >
                <Save className="w-4 h-4" />
                Save Product
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
