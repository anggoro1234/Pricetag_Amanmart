import React, { useState, useRef, useMemo } from 'react';
import { 
  X, 
  Upload, 
  FileSpreadsheet, 
  Clipboard, 
  Download, 
  CheckCircle2, 
  AlertTriangle, 
  RefreshCw, 
  Building2, 
  ArrowRight,
  Info
} from 'lucide-react';
import { StoreLocation, ImportProductRecord, Product } from '../types';
import { audioService } from '../services/audioService';

interface ProductImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  stores: StoreLocation[];
  activeStoreId: string;
  existingProducts: Product[];
  onImportComplete: (importedProducts: ImportProductRecord[], targetStoreId: string, updateExisting: boolean) => void;
}

// Function to parse numeric price string with currency and separators
const parsePrice = (val: string): number => {
  if (!val) return 0;
  // Remove "Rp", "IDR", currency symbols, spaces
  let clean = val.replace(/[rR][pP]\.?|[iI][dD][rR]\.?|\$|€|\s+/g, '');
  
  // Check Indonesian / European decimal format e.g. "3.100,00" or "3.100" vs "3100.50"
  if (clean.includes('.') && clean.includes(',')) {
    clean = clean.replace(/\./g, '').replace(',', '.');
  } else if (clean.includes('.') && clean.indexOf('.') !== clean.lastIndexOf('.')) {
    // Multiple thousand dots e.g. 1.250.000
    clean = clean.replace(/\./g, '');
  } else if (clean.includes(',') && clean.indexOf(',') !== clean.lastIndexOf(',')) {
    clean = clean.replace(/,/g, '');
  } else if (clean.includes('.')) {
    // Check if it's thousands separator (e.g. 2.900) or decimal (e.g. 2.9)
    const parts = clean.split('.');
    if (parts[1] && parts[1].length === 3) {
      clean = clean.replace(/\./g, '');
    }
  } else if (clean.includes(',')) {
    const parts = clean.split(',');
    if (parts[1] && parts[1].length === 3) {
      clean = clean.replace(/,/g, '');
    } else {
      clean = clean.replace(',', '.');
    }
  }

  const num = parseFloat(clean);
  return isNaN(num) ? 0 : Math.round(num);
};

// Helper to split CSV line safely handling quotes
const parseCsvLine = (line: string): string[] => {
  const result: string[] = [];
  let cur = '';
  let inQuotes = false;
  // Determine primary delimiter: tab (\t), semicolon (;), or comma (,)
  let delim = ',';
  if (line.includes('\t')) delim = '\t';
  else if (line.includes(';') && !line.includes(',')) delim = ';';

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === delim && !inQuotes) {
      result.push(cur.trim().replace(/^"|"$/g, ''));
      cur = '';
    } else {
      cur += char;
    }
  }
  result.push(cur.trim().replace(/^"|"$/g, ''));
  return result;
};

export const ProductImportModal: React.FC<ProductImportModalProps> = ({
  isOpen,
  onClose,
  stores,
  activeStoreId,
  existingProducts,
  onImportComplete,
}) => {
  const [activeTab, setActiveTab] = useState<'upload' | 'paste'>('upload');
  const [targetStoreId, setTargetStoreId] = useState<string>(activeStoreId || stores[0]?.id || 'store-krg');
  const [updateExisting, setUpdateExisting] = useState<boolean>(true);
  const [rawText, setRawText] = useState<string>('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [importResult, setImportResult] = useState<{ added: number; updated: number } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Parse raw text into structured records
  const parsedRecords = useMemo((): ImportProductRecord[] => {
    if (!rawText.trim()) return [];

    const lines = rawText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    if (lines.length === 0) return [];

    // Analyze first line for potential header
    const firstRow = parseCsvLine(lines[0]);
    const lowerFirstRow = firstRow.map((c) => c.toLowerCase());

    const isHeader = lowerFirstRow.some(
      (h) =>
        h.includes('item') ||
        h.includes('nama') ||
        h.includes('product') ||
        h.includes('barang') ||
        h.includes('barcode') ||
        h.includes('harga') ||
        h.includes('price') ||
        h.includes('sku')
    );

    let nameIdx = 0;
    let barcodeIdx = 1;
    let priceIdx = 2;
    let skuIdx = -1;
    let categoryIdx = -1;
    let stockIdx = -1;
    let bulkPriceIdx = -1;

    let dataLines = lines;

    if (isHeader) {
      dataLines = lines.slice(1);
      lowerFirstRow.forEach((col, idx) => {
        if (col.includes('item') || col.includes('nama') || col.includes('product') || col.includes('barang')) {
          nameIdx = idx;
        } else if (col.includes('barcode') || col.includes('ean') || col.includes('upc') || col.includes('kode')) {
          barcodeIdx = idx;
        } else if (col.includes('harga') || col.includes('price') || col.includes('unit_price') || col.includes('rp')) {
          priceIdx = idx;
        } else if (col.includes('sku')) {
          skuIdx = idx;
        } else if (col.includes('category') || col.includes('kategori')) {
          categoryIdx = idx;
        } else if (col.includes('stock') || col.includes('stok') || col.includes('qty') || col.includes('jumlah')) {
          stockIdx = idx;
        } else if (col.includes('bulk') || col.includes('crt') || col.includes('karton')) {
          bulkPriceIdx = idx;
        }
      });
    }

    const records: ImportProductRecord[] = [];

    dataLines.forEach((line) => {
      const cols = parseCsvLine(line);
      if (cols.length === 0 || !cols.some((c) => c.length > 0)) return;

      const rawName = cols[nameIdx] || '';
      let rawBarcode = cols[barcodeIdx] || '';
      const rawPrice = cols[priceIdx] || '';

      // Handle scientific notation e.g. 8.99E+12
      if (rawBarcode.toUpperCase().includes('E+')) {
        try {
          rawBarcode = Number(rawBarcode).toFixed(0);
        } catch {}
      }

      const price = parsePrice(rawPrice);
      const name = rawName.trim().toUpperCase();

      if (!name) return;

      records.push({
        name,
        barcode: rawBarcode.replace(/\s+/g, ''),
        price,
        sku: skuIdx >= 0 && cols[skuIdx] ? cols[skuIdx].trim() : undefined,
        category: categoryIdx >= 0 && cols[categoryIdx] ? cols[categoryIdx].trim() : 'Grocery',
        stock: stockIdx >= 0 && cols[stockIdx] ? parseInt(cols[stockIdx]) || 50 : 50,
        bulkPrice: bulkPriceIdx >= 0 && cols[bulkPriceIdx] ? parsePrice(cols[bulkPriceIdx]) : undefined,
      });
    });

    return records;
  }, [rawText]);

  // Check matching status with existing catalog
  const previewStats = useMemo(() => {
    let existingMatches = 0;
    let newItems = 0;

    parsedRecords.forEach((rec) => {
      const exists = existingProducts.some(
        (p) =>
          (rec.barcode && p.barcode.toLowerCase() === rec.barcode.toLowerCase()) ||
          (rec.sku && p.sku.toLowerCase() === rec.sku.toLowerCase())
      );
      if (exists) existingMatches++;
      else newItems++;
    });

    return {
      total: parsedRecords.length,
      existingMatches,
      newItems,
    };
  }, [parsedRecords, existingProducts]);

  // Handle file reading
  const handleFileUpload = (file: File) => {
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      if (text) {
        setRawText(text);
        audioService.playScanBeep();
      }
    };
    reader.readAsText(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  };

  // Sample CSV generator for testing
  const handleDownloadSampleCsv = () => {
    const csvContent = [
      'Item Name,Barcode,Price,SKU,Category,Stock',
      'INDOMIE SOTO MIE 70GR,089686010022,2900,1001043,Instant Food,60',
      'TEH BOTOL SOSRO 450ML,8992688001017,7500,1003056,Beverages,45',
      'POKKY CHOCOLATE 47GR,8993077110123,9800,1004115,Snacks,35',
      'SABUN LIFEBUOY LEMON 85GR,8999999052058,4500,1005205,Personal Care,80',
      'MINYAK GORENG SANIA 2L,8992775211024,34500,1006001,Grocery,30',
      'ROTI TAWAR SARI ROTI,8998888123456,16000,1007010,Bakery,25',
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', 'template_import_produk_amanmart.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleExecuteImport = () => {
    if (parsedRecords.length === 0) return;
    setIsProcessing(true);

    try {
      onImportComplete(parsedRecords, targetStoreId, updateExisting);
      audioService.playPrintCompleteChime();
      setImportResult({
        added: previewStats.newItems,
        updated: updateExisting ? previewStats.existingMatches : 0,
      });

      setTimeout(() => {
        setIsProcessing(false);
        onClose();
      }, 1400);
    } catch (err: any) {
      alert(err.message || 'Import failed');
      setIsProcessing(false);
      audioService.playErrorTone();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl overflow-hidden border border-slate-200 flex flex-col max-h-[92vh]">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-500/20 border border-blue-400/40 flex items-center justify-center text-blue-400">
              <Upload className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                Import Products Catalog (Item, Barcode, Price)
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Upload CSV / Excel spreadsheet or paste product rows directly
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1 text-slate-800">
          {/* Target Branch and Option Row */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-200">
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                <Building2 className="w-3.5 h-3.5 text-blue-600" />
                Target Branch for Initial Stock
              </label>
              <select
                value={targetStoreId}
                onChange={(e) => setTargetStoreId(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.code}) - {s.city}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-slate-500 mt-1">
                Stock counts from imported rows will be allocated to this store.
              </p>
            </div>

            <div className="flex flex-col justify-between">
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                Update Options
              </label>
              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-slate-700">
                  <input
                    type="checkbox"
                    checked={updateExisting}
                    onChange={(e) => setUpdateExisting(e.target.checked)}
                    className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
                  />
                  <span>Update price &amp; details if Barcode/SKU already exists</span>
                </label>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleDownloadSampleCsv}
                    className="inline-flex items-center gap-1 text-[11px] font-bold text-blue-600 hover:text-blue-800 underline"
                  >
                    <Download className="w-3 h-3" />
                    Download Sample CSV Template
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Input Method Tabs */}
          <div>
            <div className="flex border-b border-slate-200 mb-4">
              <button
                type="button"
                onClick={() => setActiveTab('upload')}
                className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold border-b-2 transition ${
                  activeTab === 'upload'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                <FileSpreadsheet className="w-4 h-4" />
                Upload CSV / Excel File
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('paste')}
                className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold border-b-2 transition ${
                  activeTab === 'paste'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                <Clipboard className="w-4 h-4" />
                Copy &amp; Paste Spreadsheet Rows
              </button>
            </div>

            {/* Tab 1: Upload */}
            {activeTab === 'upload' && (
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition ${
                  isDragging
                    ? 'border-blue-500 bg-blue-50/50'
                    : 'border-slate-300 hover:border-blue-400 bg-slate-50/50 hover:bg-slate-50'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.txt,.tsv"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files && e.target.files[0]) {
                      handleFileUpload(e.target.files[0]);
                    }
                  }}
                />
                <div className="w-12 h-12 rounded-2xl bg-blue-100 text-blue-600 mx-auto flex items-center justify-center mb-3">
                  <Upload className="w-6 h-6" />
                </div>
                <h3 className="text-sm font-bold text-slate-800">
                  {fileName ? fileName : 'Choose CSV file or drag & drop here'}
                </h3>
                <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                  Supports comma (,), tab, or semicolon delimited CSV files with Item Name, Barcode, and Price columns.
                </p>
                {fileName && (
                  <div className="mt-3 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 text-xs font-bold">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                    File loaded ({parsedRecords.length} valid rows found)
                  </div>
                )}
              </div>
            )}

            {/* Tab 2: Paste */}
            {activeTab === 'paste' && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span>Copy rows directly from Excel or Google Sheets and paste below:</span>
                  <span className="font-mono text-[11px] text-slate-400">
                    Format: Item Name, Barcode, Price
                  </span>
                </div>
                <textarea
                  rows={6}
                  value={rawText}
                  onChange={(e) => setRawText(e.target.value)}
                  placeholder={`INDOMIE AYAM BAWANG 69GR, 089686010015, 2900\nINDOMIE AYAM SPESIAL 75GR, 089686010046, 2900\nULTRA MILK FULL CREAM 1000ML, 8992761011124, 21500`}
                  className="w-full p-3 font-mono text-xs bg-slate-50 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-800 placeholder-slate-400"
                />
              </div>
            )}
          </div>

          {/* Live Preview Table */}
          {parsedRecords.length > 0 && (
            <div className="space-y-3 pt-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                  Import Preview &amp; Verification
                </h4>
                <div className="flex items-center gap-2">
                  <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 text-slate-700">
                    Total: {previewStats.total}
                  </span>
                  <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800">
                    New: {previewStats.newItems}
                  </span>
                  {previewStats.existingMatches > 0 && (
                    <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-blue-100 text-blue-800">
                      Matches Existing: {previewStats.existingMatches}
                    </span>
                  )}
                </div>
              </div>

              <div className="border border-slate-200 rounded-xl overflow-hidden max-h-52 overflow-y-auto bg-white">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200 sticky top-0">
                    <tr>
                      <th className="py-2 px-3">Status</th>
                      <th className="py-2 px-3">Item Name</th>
                      <th className="py-2 px-3 font-mono">Barcode</th>
                      <th className="py-2 px-3 text-right">Unit Price</th>
                      <th className="py-2 px-3 text-right font-mono">Allocated Stock</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {parsedRecords.slice(0, 15).map((r, idx) => {
                      const isMatch = existingProducts.some(
                        (p) =>
                          (r.barcode && p.barcode.toLowerCase() === r.barcode.toLowerCase()) ||
                          (r.sku && p.sku.toLowerCase() === r.sku.toLowerCase())
                      );

                      return (
                        <tr key={idx} className="hover:bg-slate-50/80">
                          <td className="py-2 px-3">
                            {isMatch ? (
                              <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-700">
                                {updateExisting ? 'Update Price' : 'Skip'}
                              </span>
                            ) : (
                              <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-700">
                                Create New
                              </span>
                            )}
                          </td>
                          <td className="py-2 px-3 font-semibold text-slate-800">
                            {r.name}
                            {r.category && (
                              <span className="text-[10px] text-slate-400 font-normal ml-2">
                                ({r.category})
                              </span>
                            )}
                          </td>
                          <td className="py-2 px-3 font-mono text-slate-600">
                            {r.barcode || (
                              <span className="text-[10px] text-amber-600 font-sans italic">
                                Auto-generate EAN
                              </span>
                            )}
                          </td>
                          <td className="py-2 px-3 text-right font-bold text-slate-900">
                            Rp. {r.price.toLocaleString('id-ID')}
                          </td>
                          <td className="py-2 px-3 text-right font-mono font-bold text-slate-700">
                            {r.stock ?? 50}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {parsedRecords.length > 15 && (
                <p className="text-[11px] text-slate-500 text-center">
                  Showing first 15 of {parsedRecords.length} items. All items will be imported.
                </p>
              )}
            </div>
          )}

          {/* Success Banner */}
          {importResult && (
            <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 flex items-center gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
              <div>
                <p className="text-xs font-bold">Import Completed Successfully!</p>
                <p className="text-xs text-emerald-700">
                  Created {importResult.added} new products and updated {importResult.updated} existing products.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-bold text-slate-600 hover:text-slate-800 rounded-xl hover:bg-slate-200/60 transition"
          >
            Cancel
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={parsedRecords.length === 0 || isProcessing}
              onClick={handleExecuteImport}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold text-white shadow-sm transition ${
                parsedRecords.length === 0 || isProcessing
                  ? 'bg-slate-400 cursor-not-allowed'
                  : 'bg-blue-600 hover:bg-blue-700 active:scale-95'
              }`}
            >
              {isProcessing ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Importing Products...
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4" />
                  Import {parsedRecords.length > 0 ? `${parsedRecords.length} Products` : 'Products'}
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
