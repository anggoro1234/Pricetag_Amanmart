import React, { useState } from 'react';
import confetti from 'canvas-confetti';
import { 
  Printer, 
  Trash2, 
  Plus, 
  Minus, 
  X, 
  Layers, 
  FileCode, 
  Check, 
  Copy, 
  Search,
  GripVertical,
  Barcode as BarcodeIcon,
  FolderPlus,
  Tag
} from 'lucide-react';
import { Product, LabelTemplateConfig, StoreLocation, PrintQueueItem, ThermalPrinterSettings } from '../types';
import { LabelPreview } from './LabelPreview';
import { thermalPrinterService } from '../services/thermalPrinterService';
import { audioService } from '../services/audioService';

interface BatchPrintModalProps {
  isOpen: boolean;
  onClose: () => void;
  queue: PrintQueueItem[];
  products?: Product[];
  onAddProduct?: (product: Product, quantity?: number) => void;
  onReorderQueue?: (newQueue: PrintQueueItem[]) => void;
  onUpdateQuantity: (id: string, delta: number) => void;
  onRemoveItem: (id: string) => void;
  onClearQueue: () => void;
  templates: LabelTemplateConfig[];
  activeTemplateId: string;
  onSelectTemplate: (templateId: string) => void;
  onToggleBulkPrice?: (show: boolean) => void;
  activeStore: StoreLocation;
  printerSettings: ThermalPrinterSettings;
}

export const BatchPrintModal: React.FC<BatchPrintModalProps> = ({
  isOpen,
  onClose,
  queue,
  products = [],
  onAddProduct,
  onReorderQueue,
  onUpdateQuantity,
  onRemoveItem,
  onClearQueue,
  templates,
  activeTemplateId,
  onSelectTemplate,
  onToggleBulkPrice,
  activeStore,
  printerSettings,
}) => {
  const [layoutMode, setLayoutMode] = useState<'side_by_side' | 'single_roll' | 'sheet_grid'>('side_by_side');
  const [printSizeScale, setPrintSizeScale] = useState<number>(1.08);
  const [isPrinting, setIsPrinting] = useState<boolean>(false);
  const [showRawCommands, setShowRawCommands] = useState<boolean>(false);
  const [copiedCode, setCopiedCode] = useState<boolean>(false);

  // Category & search state for adding different products/categories inside modal
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isDragOverStage, setIsDragOverStage] = useState<boolean>(false);
  const [draggedQueueIndex, setDraggedQueueIndex] = useState<number | null>(null);

  if (!isOpen) return null;

  const currentTemplate = templates.find((t) => t.id === activeTemplateId) || templates[0];
  const totalLabels = queue.reduce((sum, item) => sum + item.quantity, 0);

  // Unique categories across all products
  const categories = ['ALL', ...Array.from(new Set(products.map((p) => p.category)))];

  // Categories currently represented in the print batch
  const activeBatchCategories = Array.from(new Set(queue.map((q) => q.product.category)));

  // Live print date formatted as DD/MM/YYYY
  const nowDate = new Date();
  const livePrintDateStr = `${String(nowDate.getDate()).padStart(2, '0')}/${String(
    nowDate.getMonth() + 1
  ).padStart(2, '0')}/${nowDate.getFullYear()}`;

  // Filter catalog products by selected category & search query
  const filteredCatalog = products.filter((p) => {
    const matchCategory = selectedCategory === 'ALL' || p.category === selectedCategory;
    const term = searchQuery.trim().toLowerCase();
    const matchSearch =
      !term ||
      p.name.toLowerCase().includes(term) ||
      p.barcode.toLowerCase().includes(term) ||
      p.sku.toLowerCase().includes(term) ||
      p.category.toLowerCase().includes(term);
    return matchCategory && matchSearch;
  });

  // Flattened array for printing each individual copy
  const flattenedLabels: { item: PrintQueueItem; copyIndex: number }[] = [];
  queue.forEach((item) => {
    for (let c = 0; c < item.quantity; c++) {
      flattenedLabels.push({ item, copyIndex: c + 1 });
    }
  });

  // Drag & Drop Handlers (Catalog Product -> Print Queue / Preview Stage)
  const handleDragStartCatalogProduct = (e: React.DragEvent, product: Product) => {
    e.dataTransfer.setData('application/x-amanmart-product-id', product.id);
    e.dataTransfer.effectAllowed = 'copy';
  };

  const handleDragOverZone = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (!isDragOverStage) {
      setIsDragOverStage(true);
    }
  };

  const handleDragLeaveZone = () => {
    setIsDragOverStage(false);
  };

  const handleDropProductOnZone = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOverStage(false);
    const productId = e.dataTransfer.getData('application/x-amanmart-product-id');
    if (productId && onAddProduct) {
      const found = products.find((p) => p.id === productId);
      if (found) {
        onAddProduct(found, 1);
        audioService.playScanBeep();
      }
    }
  };

  // Drag & Drop Reordering inside Queue
  const handleQueueDragStart = (e: React.DragEvent, index: number) => {
    setDraggedQueueIndex(index);
    e.dataTransfer.setData('application/x-amanmart-queue-index', String(index));
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleQueueDrop = (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    const productId = e.dataTransfer.getData('application/x-amanmart-product-id');
    if (productId && onAddProduct) {
      const found = products.find((p) => p.id === productId);
      if (found) {
        onAddProduct(found, 1);
        audioService.playScanBeep();
      }
      setDraggedQueueIndex(null);
      return;
    }

    if (draggedQueueIndex === null || draggedQueueIndex === targetIndex || !onReorderQueue) {
      setDraggedQueueIndex(null);
      return;
    }

    const updated = [...queue];
    const [moved] = updated.splice(draggedQueueIndex, 1);
    updated.splice(targetIndex, 0, moved);
    onReorderQueue(updated);
    setDraggedQueueIndex(null);
  };

  // Add all products from the currently selected category
  const handleAddCategoryToBatch = () => {
    if (!onAddProduct) return;
    const targetProducts =
      selectedCategory === 'ALL'
        ? filteredCatalog
        : products.filter((p) => p.category === selectedCategory);

    targetProducts.forEach((p) => {
      onAddProduct(p, 1);
    });
    audioService.playScanBeep();
  };

  // Trigger Print Execution
  const handleExecutePrint = async () => {
    if (flattenedLabels.length === 0) return;

    setIsPrinting(true);
    const printColumns = layoutMode === 'single_roll' ? 1 : 3;

    try {
      if (printerSettings.connectionType === 'browser_print') {
        thermalPrinterService.triggerSystemPrint('batch-printable-labels-area', printColumns, printSizeScale);
      } else {
        // Bluetooth or Serial TSPL direct print
        thermalPrinterService.triggerSystemPrint('batch-printable-labels-area', printColumns, printSizeScale);
      }

      // Play audio chime and trigger confetti
      audioService.playPrintCompleteChime();
      confetti({
        particleCount: 50,
        spread: 60,
        origin: { y: 0.8 },
      });
    } catch (err: any) {
      alert('Print error: ' + (err.message || 'Failed to communicate with printer'));
    } finally {
      setTimeout(() => setIsPrinting(false), 800);
    }
  };

  // Generate TSPL script for all queue items
  const generatedTsplCode = queue
    .map((item) => thermalPrinterService.generateTSPL(item.product, currentTemplate, item.quantity))
    .join('\r\n\r\n');

  const handleCopyCode = () => {
    navigator.clipboard.writeText(generatedTsplCode);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-2 sm:p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-7xl overflow-hidden border border-slate-200 flex flex-col max-h-[94vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-500/20 border border-red-400 flex items-center justify-center text-red-400">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-lg font-bold text-white">Bulk Batch Printing</h2>
                <span className="bg-red-500/20 text-red-400 text-xs px-2.5 py-0.5 rounded-full font-bold border border-red-500/30">
                  {totalLabels} Labels ({queue.length} Products)
                </span>
                {activeBatchCategories.length > 0 && (
                  <span className="bg-emerald-500/20 text-emerald-300 text-xs px-2.5 py-0.5 rounded-full font-bold border border-emerald-500/30">
                    {activeBatchCategories.length} Categories: {activeBatchCategories.join(' + ')}
                  </span>
                )}
                <span className="bg-blue-500/20 text-blue-300 text-xs px-2.5 py-0.5 rounded-full font-mono font-bold border border-blue-500/30">
                  Live Print Date: {livePrintDateStr}
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Pilih berbagai kategori produk atau Drag &amp; Drop produk ke antrean untuk cetak multi-kategori &amp; multi-barcode sekaligus
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowRawCommands(!showRawCommands)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-lg transition"
            >
              <FileCode className="w-3.5 h-3.5" />
              {showRawCommands ? 'Hide TSPL' : 'Raw TSPL / ESC-POS'}
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Toolbar Controls */}
        <div className="px-6 py-3 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-3 text-xs">
          {/* Template Selector */}
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-600">Template:</span>
            <select
              value={activeTemplateId}
              onChange={(e) => onSelectTemplate(e.target.value)}
              className="px-3 py-1.5 bg-white border border-slate-300 rounded-lg font-semibold text-slate-800 shadow-sm focus:ring-2 focus:ring-blue-500"
            >
              {templates.map((tmpl) => (
                <option key={tmpl.id} value={tmpl.id}>
                  {tmpl.name} ({tmpl.widthMm}x{tmpl.heightMm}mm)
                </option>
              ))}
            </select>
          </div>

          {/* Layout Mode */}
          <div className="flex items-center gap-1 bg-slate-200 p-1 rounded-lg">
            <button
              onClick={() => setLayoutMode('side_by_side')}
              className={`px-3 py-1 rounded font-semibold transition ${
                layoutMode === 'side_by_side'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              3-Column Side-by-Side (3 ke Samping)
            </button>
            <button
              onClick={() => setLayoutMode('single_roll')}
              className={`px-3 py-1 rounded font-semibold transition ${
                layoutMode === 'single_roll'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Single Roll (1 ke Bawah)
            </button>
            <button
              onClick={() => setLayoutMode('sheet_grid')}
              className={`px-3 py-1 rounded font-semibold transition ${
                layoutMode === 'sheet_grid'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              A4 Sheet Grid (3 Kolom)
            </button>
          </div>

          {/* Print Tag Size Selector for physical price tag holder */}
          <div className="flex items-center gap-1.5">
            <span className="font-bold text-slate-600">Ukuran Wadah Tag:</span>
            <select
              value={String(printSizeScale)}
              onChange={(e) => setPrintSizeScale(parseFloat(e.target.value))}
              className="px-2.5 py-1.5 bg-emerald-50 border border-emerald-300 rounded-lg font-bold text-emerald-900 shadow-xs focus:ring-2 focus:ring-emerald-500"
            >
              <option value="0.95">Standar (68x34mm)</option>
              <option value="1.08">Lebar Besar - Pas Wadah Rak (68x39mm)</option>
              <option value="1.2">Extra Besar (68x43mm)</option>
            </select>
          </div>

          {/* Toggle CRT Bulk Price vs PCS Only */}
          {onToggleBulkPrice && (
            <button
              onClick={() => onToggleBulkPrice(!currentTemplate.showBulkPrice)}
              className={`px-3 py-1.5 rounded-lg font-bold border transition ${
                currentTemplate.showBulkPrice
                  ? 'bg-blue-50 border-blue-300 text-blue-800'
                  : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-100'
              }`}
              title="Sembunyikan atau tampilkan harga CRT (data harga CRT tetap tersimpan)"
            >
              {currentTemplate.showBulkPrice ? 'Harga: PCS + CRT (Aktif)' : 'Harga: Hanya PCS (CRT Disembunyikan)'}
            </button>
          )}

          {/* Clear Queue */}
          {queue.length > 0 && (
            <button
              onClick={onClearQueue}
              className="flex items-center gap-1 text-red-600 hover:text-red-700 font-semibold"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Clear Queue
            </button>
          )}
        </div>

        {/* Modal Main Content: 3-Column Layout (1: Catalog/Category Picker, 2: Active Batch Queue, 3: Live Print Preview) */}
        <div className="flex-1 overflow-hidden flex flex-col lg:flex-row">
          {/* Column 1: Multi-Category Product Picker (Drag & Drop Source) */}
          <div className="w-full lg:w-64 border-b lg:border-b-0 lg:border-r border-slate-200 bg-white flex flex-col overflow-hidden max-h-60 lg:max-h-none flex-shrink-0">
            <div className="p-3 border-b border-slate-200 bg-emerald-50/60 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-xs text-emerald-900 uppercase tracking-wider flex items-center gap-1.5">
                  <Tag className="w-3.5 h-3.5 text-emerald-600" />
                  Pilih Kategori &amp; Produk
                </span>
                <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
                  Drag &amp; Drop
                </span>
              </div>

              {/* Category Dropdown */}
              <div className="flex gap-1.5">
                <select
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                  className="flex-1 px-2.5 py-1.5 bg-white border border-emerald-300 rounded-lg text-xs font-bold text-slate-800 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                >
                  {categories.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat === 'ALL' ? 'Semua Kategori (' + products.length + ')' : cat}
                    </option>
                  ))}
                </select>
                {selectedCategory !== 'ALL' && (
                  <button
                    onClick={handleAddCategoryToBatch}
                    className="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[11px] font-bold flex items-center gap-1 shadow-xs transition"
                    title={`Tambahkan semua produk kategori ${selectedCategory}`}
                  >
                    <FolderPlus className="w-3.5 h-3.5" />
                    +Kategori
                  </button>
                )}
              </div>

              {/* Quick Category Pills */}
              <div className="flex items-center gap-1 overflow-x-auto pb-1 no-scrollbar">
                {categories.map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setSelectedCategory(cat)}
                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap transition ${
                      selectedCategory === cat
                        ? 'bg-emerald-600 text-white shadow-xs'
                        : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    {cat === 'ALL' ? 'All' : cat}
                  </button>
                ))}
              </div>

              {/* Search Input */}
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Cari Indomie, Kecap, Saus, Barcode..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-8 pr-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                />
              </div>
            </div>

            {/* Draggable Product List */}
            <div className="flex-1 overflow-y-auto p-2.5 space-y-2 bg-slate-50/40">
              {filteredCatalog.length === 0 ? (
                <div className="p-4 text-center text-slate-400 text-xs">
                  Produk tidak ditemukan pada kategori ini.
                </div>
              ) : (
                filteredCatalog.map((prod) => {
                  const inQueueItem = queue.find((q) => q.product.id === prod.id);
                  return (
                    <div
                      key={prod.id}
                      draggable
                      onDragStart={(e) => handleDragStartCatalogProduct(e, prod)}
                      className={`p-2.5 rounded-xl border transition cursor-grab active:cursor-grabbing flex items-center justify-between gap-2 ${
                        inQueueItem
                          ? 'bg-emerald-50/70 border-emerald-300 shadow-xs'
                          : 'bg-white border-slate-200 hover:border-emerald-300 hover:shadow-xs'
                      }`}
                      title="Drag & Drop ke kanan atau klik tombol + untuk menambahkan ke cetakan"
                    >
                      <div className="flex items-start gap-2 min-w-0 flex-1">
                        <GripVertical className="w-4 h-4 text-slate-400 flex-shrink-0 mt-0.5" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[9px] font-extrabold uppercase px-1.5 py-0.2 bg-slate-100 text-slate-600 rounded">
                              {prod.category}
                            </span>
                            {inQueueItem && (
                              <span className="text-[9px] font-bold bg-emerald-600 text-white px-1.5 rounded">
                                {inQueueItem.quantity}x di Batch
                              </span>
                            )}
                          </div>
                          <div className="font-bold text-xs text-slate-800 truncate mt-0.5">
                            {prod.name}
                          </div>
                          <div className="flex items-center gap-2 text-[10px] text-slate-500 font-mono mt-0.5">
                            <span className="flex items-center gap-0.5">
                              <BarcodeIcon className="w-3 h-3 text-slate-400" />
                              {prod.barcode}
                            </span>
                            <span>•</span>
                            <span className="font-bold text-red-600 font-sans">
                              {prod.currency} {prod.pricing.unitPrice.toLocaleString('id-ID')}
                            </span>
                          </div>
                        </div>
                      </div>

                      <button
                        onClick={() => {
                          if (onAddProduct) {
                            onAddProduct(prod, 1);
                            audioService.playScanBeep();
                          }
                        }}
                        className="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold flex items-center gap-1 flex-shrink-0 shadow-xs transition active:scale-95"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Add
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Column 2: Queue Items List (Drop Target & Reorderable) */}
          <div
            onDragOver={handleDragOverZone}
            onDragLeave={handleDragLeaveZone}
            onDrop={handleDropProductOnZone}
            className={`w-full lg:w-60 border-b lg:border-b-0 lg:border-r border-slate-200 flex flex-col overflow-hidden max-h-56 lg:max-h-none flex-shrink-0 transition-colors ${
              isDragOverStage ? 'bg-emerald-50/80 border-emerald-400' : 'bg-slate-50/50'
            }`}
          >
            <div className="p-3 border-b border-slate-200 font-bold text-xs text-slate-600 uppercase tracking-wider flex justify-between items-center">
              <span>Items in Batch ({queue.length})</span>
              <span className="text-slate-400">{totalLabels} total</span>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {queue.length === 0 ? (
                <div className="p-6 text-center text-slate-400 text-xs border-2 border-dashed border-slate-300 rounded-xl">
                  Antrean kosong. Pilih atau <strong>Drag &amp; Drop</strong> produk (misal: Indomie &amp; Kecap/Saus) dari panel kiri ke sini.
                </div>
              ) : (
                queue.map((qItem, index) => (
                  <div
                    key={qItem.id}
                    draggable
                    onDragStart={(e) => handleQueueDragStart(e, index)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => handleQueueDrop(e, index)}
                    className="p-2.5 bg-white border border-slate-200 hover:border-emerald-300 rounded-xl shadow-xs flex flex-col gap-1.5 cursor-move"
                  >
                    <div className="flex justify-between items-start gap-1">
                      <div className="min-w-0">
                        <span className="inline-block text-[9px] font-bold uppercase px-1.5 py-0.2 bg-blue-50 text-blue-700 rounded mb-0.5">
                          {qItem.product.category}
                        </span>
                        <div className="font-bold text-xs text-slate-800 line-clamp-1">
                          {qItem.product.name}
                        </div>
                      </div>
                      <button
                        onClick={() => onRemoveItem(qItem.id)}
                        className="text-slate-400 hover:text-red-500 p-0.5 flex-shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="flex justify-between items-center text-[11px] text-slate-500">
                      <span className="font-mono flex items-center gap-1">
                        <BarcodeIcon className="w-3 h-3 text-slate-400" />
                        {qItem.product.barcode}
                      </span>
                      <span className="font-bold text-red-600">
                        {qItem.product.currency} {qItem.product.pricing.unitPrice.toLocaleString('id-ID')}
                      </span>
                    </div>

                    <div className="flex justify-between items-center pt-1 border-t border-slate-100">
                      <span className="text-[10px] text-slate-400 font-medium">
                        SKU: {qItem.product.sku} • Copies:
                      </span>
                      <div className="flex items-center gap-1.5 bg-slate-100 rounded-lg p-0.5">
                        <button
                          onClick={() => onUpdateQuantity(qItem.id, -1)}
                          className="w-5 h-5 flex items-center justify-center rounded bg-white text-slate-700 hover:bg-slate-200 text-xs"
                        >
                          <Minus className="w-3 h-3" />
                        </button>
                        <span className="w-6 text-center text-xs font-bold text-slate-800">
                          {qItem.quantity}
                        </span>
                        <button
                          onClick={() => onUpdateQuantity(qItem.id, 1)}
                          className="w-5 h-5 flex items-center justify-center rounded bg-white text-slate-700 hover:bg-slate-200 text-xs"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Column 3: Live Printable Stage Preview (Also Drop Target) */}
          <div
            onDragOver={handleDragOverZone}
            onDragLeave={handleDragLeaveZone}
            onDrop={handleDropProductOnZone}
            className={`flex-1 overflow-auto p-4 flex flex-col items-center transition-colors ${
              isDragOverStage ? 'bg-emerald-50/70 ring-2 ring-inset ring-emerald-400' : 'bg-slate-100'
            }`}
          >
            {showRawCommands ? (
              <div className="w-full h-full bg-slate-900 rounded-xl p-4 text-emerald-400 font-mono text-xs overflow-auto flex flex-col">
                <div className="flex justify-between items-center border-b border-slate-800 pb-2 mb-3">
                  <span className="text-slate-300 font-bold">TSPL Direct Command Buffer</span>
                  <button
                    onClick={handleCopyCode}
                    className="flex items-center gap-1 px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-white rounded text-[11px]"
                  >
                    {copiedCode ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    {copiedCode ? 'Copied' : 'Copy Commands'}
                  </button>
                </div>
                <pre className="flex-1 whitespace-pre-wrap">{generatedTsplCode}</pre>
              </div>
            ) : (
              <div className="w-full flex flex-col items-center space-y-3">
                <div className="text-center">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                    High-Fidelity Thermal Label Print Preview (3 Kolom ke Samping)
                  </span>
                  <p className="text-xs text-slate-500">
                    Showing {flattenedLabels.length} formatted labels across {activeBatchCategories.length || 0} categories (3 per baris kiri-kanan)
                  </p>
                </div>

                {/* Printable container targeted by Thermal Print Service */}
                <div
                  id="batch-printable-labels-area"
                  className={`bg-white p-3 rounded-xl shadow-md border transition-all w-full max-w-[860px] ${
                    isDragOverStage
                      ? 'border-emerald-500 border-2 ring-4 ring-emerald-500/10'
                      : 'border-slate-300'
                  } ${
                    layoutMode === 'side_by_side'
                      ? 'grid grid-cols-3 gap-2 justify-items-stretch items-start'
                      : layoutMode === 'single_roll'
                      ? 'flex flex-col gap-3 items-center max-w-xs'
                      : 'grid grid-cols-3 gap-2 p-3 border-dashed border-2 border-slate-400 justify-items-stretch items-start'
                  }`}
                >
                  {flattenedLabels.length === 0 ? (
                    <div className="col-span-3 py-12 px-8 text-center text-slate-400 text-sm">
                      Belum ada label untuk dicetak. Drag &amp; Drop produk dari daftar kategori di sebelah kiri ke area ini.
                    </div>
                  ) : (
                    flattenedLabels.map(({ item, copyIndex }, idx) => (
                      <div key={`${item.id}-${copyIndex}-${idx}`} className="flex flex-col items-center w-full">
                        <LabelPreview
                          product={item.product}
                          template={currentTemplate}
                          store={activeStore}
                          scale={layoutMode === 'single_roll' ? 1.05 : Math.min(1.05, 0.92 * printSizeScale)}
                          className="w-full"
                          isPrintMode={false}
                        />
                        <div className="flex items-center gap-1 mt-1 print:hidden">
                          <span className="text-[8px] font-bold bg-slate-100 text-slate-600 px-1 py-0.2 rounded">
                            {item.product.category}
                          </span>
                          <span className="text-[8px] text-slate-400 font-mono">
                            #{idx + 1}/{totalLabels}
                          </span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
          <div className="text-xs text-slate-500">
            Destination:{' '}
            <span className="font-semibold text-slate-800">
              {printerSettings.connectionType === 'browser_print'
                ? 'Standard Thermal / System Print Dialog'
                : 'Direct Hardware Device'}
            </span>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 font-semibold rounded-xl text-xs transition"
            >
              Close
            </button>

            <button
              onClick={handleExecutePrint}
              disabled={flattenedLabels.length === 0 || isPrinting}
              className="flex items-center gap-2 px-6 py-2.5 bg-red-600 hover:bg-red-700 disabled:bg-slate-300 text-white font-bold rounded-xl text-sm shadow-md transition"
            >
              <Printer className="w-4 h-4" />
              {isPrinting ? 'Printing Labels...' : `Print All ${totalLabels} Labels`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
