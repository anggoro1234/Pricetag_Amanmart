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
  ShieldCheck,
  RotateCcw
} from 'lucide-react';
import { StoreLocation, ImportProductRecord, Product, ImportTransactionResult } from '../types';
import { audioService } from '../services/audioService';
import { sanitizeBarcodeValue, normalizeCategoryName, storageService } from '../services/storageService';
import {
  DynamicsPriceTierOption,
  parseAndValidateImportText,
} from '../utils/importMapper';
import { convertExcelBufferToCsv, toStandardAmanmartCsv } from '../utils/excelToCsv';

interface ProductImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  stores: StoreLocation[];
  activeStoreId: string;
  existingProducts: Product[];
  onImportComplete: (
    importedProducts: ImportProductRecord[],
    targetStoreId: string,
    updateExisting: boolean,
    replaceAllLocal: boolean,
    onProgress?: (completed: number, total: number) => void
  ) => Promise<ImportTransactionResult | void> | ImportTransactionResult | void;
}

// Parse HTML / XML table (when user uploads an .xls file saved as HTML/XML table from Excel)
const extractTextFromHtmlOrXmlSpreadsheet = (content: string): string | null => {
  if (!content.includes('<table') && !content.includes('<Row') && !content.includes('<tr')) {
    return null;
  }
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(content, 'text/html');
    const rows = Array.from(doc.querySelectorAll('tr, Row'));
    if (rows.length === 0) return null;

    const csvLines: string[] = [];
    rows.forEach((tr) => {
      const cells = Array.from(tr.querySelectorAll('td, th, Cell, Data'));
      if (cells.length > 0) {
        const vals = cells.map((c) => (c.textContent || '').replace(/\r?\n/g, ' ').trim());
        if (vals.some((v) => v.length > 0)) {
          csvLines.push(vals.join('\t'));
        }
      }
    });
    return csvLines.length > 0 ? csvLines.join('\n') : null;
  } catch {
    return null;
  }
};

// Decompress a single ZIP entry using CompressionMethod 0 (stored) or 8 (deflate-raw)
const readZipEntryText = async (
  bytes: Uint8Array,
  view: DataView,
  localHeaderOffset: number,
  compression: number,
  compressedSize: number
): Promise<string | null> => {
  if (localHeaderOffset + 30 > bytes.length) return null;
  if (view.getUint32(localHeaderOffset, true) !== 0x04034b50) return null;

  const lfhNameLen = view.getUint16(localHeaderOffset + 26, true);
  const lfhExtraLen = view.getUint16(localHeaderOffset + 28, true);
  const dataStart = localHeaderOffset + 30 + lfhNameLen + lfhExtraLen;
  if (dataStart + compressedSize > bytes.length) return null;

  const compressedData = bytes.subarray(dataStart, dataStart + compressedSize);
  if (compression === 0) {
    return new TextDecoder('utf-8').decode(compressedData);
  }
  if (compression === 8 && typeof DecompressionStream !== 'undefined') {
    const ds = new DecompressionStream('deflate-raw');
    const writer = ds.writable.getWriter();
    writer.write(compressedData);
    writer.close();
    return new Response(ds.readable).text();
  }
  return null;
};

// Native browser .xlsx (ZIP + XML) reader supporting ZIP Central Directory (data descriptors) and dynamic sheet paths
const extractTextFromXlsxBuffer = async (buffer: ArrayBuffer): Promise<string | null> => {
  try {
    const bytes = new Uint8Array(buffer);
    if (bytes.length < 22 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) return null;

    const view = new DataView(buffer);
    const files: Record<string, string> = {};
    const wantedExact = new Set([
      'xl/sharedstrings.xml',
      'xl/workbook.xml',
      'xl/_rels/workbook.xml.rels',
    ]);

    // 1. Locate End of Central Directory (PK\x05\x06) to handle exports using bit-3 streaming data descriptors
    let eocdOffset = -1;
    const minSearch = Math.max(0, bytes.length - 65558);
    for (let pos = bytes.length - 22; pos >= minSearch; pos--) {
      if (view.getUint32(pos, true) === 0x06054b50) {
        eocdOffset = pos;
        break;
      }
    }

    if (eocdOffset >= 0) {
      const cdOffset = view.getUint32(eocdOffset + 16, true);
      const cdSize = view.getUint32(eocdOffset + 12, true);
      const cdEnd = Math.min(bytes.length, cdOffset + cdSize);
      let ptr = cdOffset;

      while (ptr + 46 <= cdEnd && view.getUint32(ptr, true) === 0x02014b50) {
        const compression = view.getUint16(ptr + 10, true);
        const compressedSize = view.getUint32(ptr + 20, true);
        const nameLen = view.getUint16(ptr + 28, true);
        const extraLen = view.getUint16(ptr + 30, true);
        const commentLen = view.getUint16(ptr + 32, true);
        const localHeaderOffset = view.getUint32(ptr + 42, true);

        const rawName = new TextDecoder('utf-8').decode(bytes.subarray(ptr + 46, ptr + 46 + nameLen));
        const lowerName = rawName.toLowerCase();

        if (wantedExact.has(lowerName) || /^xl\/worksheets\/sheet[0-9]*\.xml$/.test(lowerName)) {
          const text = await readZipEntryText(bytes, view, localHeaderOffset, compression, compressedSize);
          if (text !== null) {
            files[lowerName] = text;
          }
        }
        ptr += 46 + nameLen + extraLen + commentLen;
      }
    } else {
      // Fallback: sequential local file header scan
      let offset = 0;
      while (offset + 30 <= bytes.length) {
        const sig = view.getUint32(offset, true);
        if (sig !== 0x04034b50) break;
        const compression = view.getUint16(offset + 8, true);
        const compressedSize = view.getUint32(offset + 18, true);
        const nameLen = view.getUint16(offset + 26, true);
        const extraLen = view.getUint16(offset + 28, true);
        const rawName = new TextDecoder('utf-8').decode(bytes.subarray(offset + 30, offset + 30 + nameLen));
        const lowerName = rawName.toLowerCase();

        if (wantedExact.has(lowerName) || /^xl\/worksheets\/sheet[0-9]*\.xml$/.test(lowerName)) {
          const text = await readZipEntryText(bytes, view, offset, compression, compressedSize);
          if (text !== null) {
            files[lowerName] = text;
          }
        }
        offset = offset + 30 + nameLen + extraLen + compressedSize;
      }
    }

    // Resolve first active worksheet path cleanly
    let sheetXml = files['xl/worksheets/sheet1.xml'];
    if (!sheetXml) {
      const sheetKey = Object.keys(files)
        .filter((k) => k.startsWith('xl/worksheets/'))
        .sort()[0];
      if (sheetKey) sheetXml = files[sheetKey];
    }
    if (!sheetXml) return null;

    const getByLocalName = (root: Document | Element, localName: string): Element[] => {
      const nsList = Array.from(root.getElementsByTagNameNS('*', localName));
      return nsList.length > 0 ? nsList : Array.from(root.getElementsByTagName(localName));
    };

    const parser = new DOMParser();
    const sharedStrings: string[] = [];
    if (files['xl/sharedstrings.xml']) {
      const ssDoc = parser.parseFromString(files['xl/sharedstrings.xml'], 'application/xml');
      getByLocalName(ssDoc, 'si').forEach((si) => {
        const texts = getByLocalName(si, 't').map((t) => t.textContent || '');
        sharedStrings.push(texts.join(''));
      });
    }

    const sheetDoc = parser.parseFromString(sheetXml, 'application/xml');
    const rowEls = getByLocalName(sheetDoc, 'row');
    const lines: string[] = [];

    const colLettersToIndex = (ref: string): number => {
      const letters = ref.replace(/[0-9]/g, '').toUpperCase();
      let idx = 0;
      for (let i = 0; i < letters.length; i++) {
        idx = idx * 26 + (letters.charCodeAt(i) - 64);
      }
      return Math.max(0, idx - 1);
    };

    rowEls.forEach((rowEl) => {
      const cellEls = getByLocalName(rowEl, 'c');
      const rowVals: string[] = [];
      cellEls.forEach((cEl) => {
        const ref = cEl.getAttribute('r') || '';
        const colIdx = ref ? colLettersToIndex(ref) : rowVals.length;
        const type = cEl.getAttribute('t');
        const vEl = getByLocalName(cEl, 'v')[0];
        const isEl = getByLocalName(cEl, 'is')[0];

        let val = '';
        if (type === 'inlineStr' && isEl) {
          val = getByLocalName(isEl, 't')
            .map((t) => t.textContent || '')
            .join('');
        } else if (type === 's' && vEl) {
          const ssIdx = parseInt(vEl.textContent || '', 10);
          val = sharedStrings[ssIdx] ?? vEl.textContent ?? '';
        } else if (type === 'b' && vEl) {
          val = vEl.textContent === '1' ? 'TRUE' : 'FALSE';
        } else if (type === 'e') {
          val = '';
        } else {
          val =
            vEl?.textContent ||
            (isEl
              ? getByLocalName(isEl, 't')
                  .map((t) => t.textContent || '')
                  .join('')
              : '');
        }

        while (rowVals.length < colIdx) rowVals.push('');
        rowVals[colIdx] = val.replace(/\r?\n/g, ' ').trim();
      });
      if (rowVals.some((v) => v.length > 0)) {
        lines.push(rowVals.join('\t'));
      }
    });

    return lines.length > 0 ? lines.join('\n') : null;
  } catch {
    return null;
  }
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
  const [replaceAllLocal, setReplaceAllLocal] = useState<boolean>(() =>
    storageService.isUsingLegacyLocalDemoData()
  );
  const [rawText, setRawText] = useState<string>('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [convertedCsvInfo, setConvertedCsvInfo] = useState<{
    sheetName: string;
    sheetCount: number;
    rowCount: number;
  } | null>(null);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [isLoadingMaster, setIsLoadingMaster] = useState<boolean>(false);
  const [priceTier, setPriceTier] = useState<DynamicsPriceTierOption>('auto');
  const [skipBlocked, setSkipBlocked] = useState<boolean>(true);
  const [syncProgress, setSyncProgress] = useState<{ completed: number; total: number } | null>(null);
  const [txError, setTxError] = useState<{
    message: string;
    rolledBack: boolean;
    cloudRolledBack?: boolean;
  } | null>(null);
  const [importResult, setImportResult] = useState<{
    added: number;
    updated: number;
    skipped: number;
    duplicatesMerged: number;
    cloudSynced: number;
    cloudAttempted: boolean;
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fast O(1) lookup maps for existing products (prevents freezing when importing 10,000+ items)
  const existingLookup = useMemo(() => {
    const skuMap = new Map<string, Product>();
    const nameMap = new Map<string, Product>();
    const barcodeSet = new Set<string>();

    const normalizeLooseSku = (sku: string): string => {
      const cleaned = sku.trim().toLowerCase();
      return /^\d+$/.test(cleaned) ? cleaned.replace(/^0+(?=\d)/, '') : cleaned;
    };

    if (!replaceAllLocal) {
      existingProducts.forEach((p) => {
        if (p.sku) {
          const skuLower = p.sku.trim().toLowerCase();
          if (skuLower) {
            skuMap.set(skuLower, p);
            const normSku = normalizeLooseSku(skuLower);
            if (normSku && !skuMap.has(normSku)) {
              skuMap.set(normSku, p);
            }
          }
        }
        if (p.name) {
          const nameLower = p.name.trim().toLowerCase();
          if (nameLower) {
            nameMap.set(nameLower, p);
            const collapsed = nameLower.replace(/\s+/g, ' ');
            if (collapsed && !nameMap.has(collapsed)) {
              nameMap.set(collapsed, p);
            }
          }
        }
        if (p.barcode) barcodeSet.add(p.barcode.trim().toLowerCase());
      });
    }

    return { skuMap, nameMap, barcodeSet };
  }, [existingProducts, replaceAllLocal]);

  // Parse raw text via flexible Dynamics 365 & standard CSV/Excel column mapper + validation
  const parseResult = useMemo(() => {
    return parseAndValidateImportText(rawText, {
      priceTier,
      skipBlocked,
      existingLookup,
      sanitizeBarcode: sanitizeBarcodeValue,
      normalizeCategory: normalizeCategoryName,
    });
  }, [rawText, priceTier, skipBlocked, existingLookup]);

  const parsedRecords = parseResult.records;

  // Check matching status with existing catalog in O(1) per record
  const previewStats = useMemo(() => {
    let existingMatches = 0;
    let newItems = 0;

    parsedRecords.forEach((rec) => {
      const skuLower = rec.sku ? rec.sku.trim().toLowerCase() : '';
      const skuNorm =
        skuLower && /^\d+$/.test(skuLower) ? skuLower.replace(/^0+(?=\d)/, '') : skuLower;
      const nameLower = rec.name.trim().toLowerCase();
      const nameCollapsed = nameLower.replace(/\s+/g, ' ');
      const exists =
        (rec.barcode && existingLookup.barcodeSet.has(rec.barcode.trim().toLowerCase())) ||
        (skuLower && existingLookup.skuMap.has(skuLower)) ||
        (skuNorm && existingLookup.skuMap.has(skuNorm)) ||
        existingLookup.nameMap.has(nameLower) ||
        existingLookup.nameMap.has(nameCollapsed);
      if (exists) existingMatches++;
      else newItems++;
    });

    return {
      total: parsedRecords.length,
      existingMatches,
      newItems,
    };
  }, [parsedRecords, existingLookup]);

  // Handle file reading (.csv, .txt, .tsv, .xls, .xlsx, .xlsm, .xlsb, .ods)
  // Excel workbooks are automatically converted into CSV in-browser before parsing.
  const handleFileUpload = async (file: File) => {
    if (!file) return;
    setFileName(file.name);
    setFileError(null);
    setTxError(null);
    setImportResult(null);
    setConvertedCsvInfo(null);

    try {
      const lowerName = file.name.toLowerCase();
      const buffer = await file.arrayBuffer();

      if (buffer.byteLength === 0) {
        setFileError('File kosong (0 byte). Pastikan file Excel/CSV tersimpan dengan benar.');
        return;
      }

      const firstBytes = new Uint8Array(buffer.slice(0, 4));
      const isZipContainer =
        firstBytes.length >= 4 &&
        firstBytes[0] === 0x50 &&
        firstBytes[1] === 0x4b &&
        firstBytes[2] === 0x03 &&
        firstBytes[3] === 0x04;

      // OLE2 Compound Binary (.xls 97-2003 BIFF)
      const isLegacyBinaryXls =
        firstBytes.length >= 4 &&
        firstBytes[0] === 0xd0 &&
        firstBytes[1] === 0xcf &&
        firstBytes[2] === 0x11 &&
        firstBytes[3] === 0xe0;

      const isExcelExtension = /\.(xlsx|xlsm|xlsb|xls|ods)$/i.test(lowerName);

      // Automatically convert OOXML (.xlsx/.xlsm), binary BIFF (.xls), .xlsb, and .ods to CSV via SheetJS
      if (isZipContainer || isLegacyBinaryXls || /\.(xlsx|xlsm|xlsb|ods)$/i.test(lowerName)) {
        const converted = await convertExcelBufferToCsv(buffer);
        if (converted && converted.csvText.trim()) {
          setRawText(converted.csvText);
          setConvertedCsvInfo({
            sheetName: converted.sheetName,
            sheetCount: converted.sheetCount,
            rowCount: converted.rowCount,
          });
          audioService.playScanBeep();
          return;
        }

        // Secondary fallback: namespace-aware XML extractor for ZIP-based .xlsx files
        if (isZipContainer || lowerName.endsWith('.xlsx')) {
          const extracted = await extractTextFromXlsxBuffer(buffer);
          if (extracted && extracted.trim()) {
            setRawText(extracted);
            setConvertedCsvInfo({
              sheetName: 'Sheet1',
              sheetCount: 1,
              rowCount: extracted.split('\n').length,
            });
            audioService.playScanBeep();
            return;
          }
        }

        setFileError(
          'File Excel tidak dapat dibaca atau tidak berisi baris data yang valid. Pastikan sheet berisi kolom Item Code / Description / Harga.'
        );
        return;
      }

      // Detect UTF-16LE / UTF-16BE BOM from Excel Unicode Text exports
      let encoding = 'utf-8';
      if (firstBytes.length >= 2 && firstBytes[0] === 0xff && firstBytes[1] === 0xfe) {
        encoding = 'utf-16le';
      } else if (firstBytes.length >= 2 && firstBytes[0] === 0xfe && firstBytes[1] === 0xff) {
        encoding = 'utf-16be';
      }

      const text = new TextDecoder(encoding).decode(buffer);

      // Check if it's an HTML/XML .xls export from Excel or Dynamics
      const htmlExtracted = extractTextFromHtmlOrXmlSpreadsheet(text);
      if (htmlExtracted) {
        setRawText(htmlExtracted);
        setConvertedCsvInfo(
          isExcelExtension
            ? {
                sheetName: 'Excel HTML/XML',
                sheetCount: 1,
                rowCount: htmlExtracted.split('\n').length,
              }
            : null
        );
        audioService.playScanBeep();
        return;
      }

      // Final Excel fallback for non-OLE2 .xls variants (SYLK, SpreadsheetML, etc.)
      if (isExcelExtension) {
        const fallbackConverted = await convertExcelBufferToCsv(buffer);
        if (fallbackConverted && fallbackConverted.csvText.trim()) {
          setRawText(fallbackConverted.csvText);
          setConvertedCsvInfo({
            sheetName: fallbackConverted.sheetName,
            sheetCount: fallbackConverted.sheetCount,
            rowCount: fallbackConverted.rowCount,
          });
          audioService.playScanBeep();
          return;
        }
      }

      if (text && text.trim()) {
        setRawText(text);
        audioService.playScanBeep();
      } else {
        setFileError('File kosong atau tidak berisi baris data yang dapat dibaca.');
      }
    } catch (err: any) {
      setFileError(err?.message || 'Gagal membaca file');
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  };

  // Load the bundled 10,112-item Amanmart master CSV directly
  const handleLoadBundledMasterCsv = async () => {
    setIsLoadingMaster(true);
    setFileError(null);
    setTxError(null);
    setImportResult(null);
    setConvertedCsvInfo(null);
    try {
      const resp = await fetch('/ITEMLISTMASTER_cleaned.csv');
      if (!resp.ok) throw new Error('File ITEMLISTMASTER_cleaned.csv tidak ditemukan');
      const text = await resp.text();
      setFileName('ITEMLISTMASTER_cleaned.csv (10.112 Item Master Amanmart)');
      setReplaceAllLocal(true);
      setRawText(text);
      audioService.playScanBeep();
    } catch (err: any) {
      setFileError(err?.message || 'Gagal memuat file master');
    } finally {
      setIsLoadingMaster(false);
    }
  };

  // Download standardized CSV generated from the uploaded Excel workbook
  const handleDownloadConvertedCsv = () => {
    if (parsedRecords.length === 0) return;
    const csvContent = toStandardAmanmartCsv(parsedRecords);
    const baseName =
      (fileName || 'amanmart_converted')
        .replace(/\.(xlsx|xls|xlsm|xlsb|ods|csv|txt|tsv)$/i, '')
        .trim() || 'amanmart_converted';
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `${baseName}_converted.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // Sample CSV generator matching exact "SKU,Item Name,Barcode,Price,Category,Stock" format
  const handleDownloadSampleCsv = () => {
    const csvContent =
      '\uFEFF' +
      [
        'SKU,Item Name,Barcode,Price,Category,Stock',
        '1000001,ADEM SARI CHINGKU HERBAL TEA CAN 320ML,8992772586023,8900.0,Beverages,36.0',
        '1000002,ADEM SARI CHINGKU SPARKLING LEMON 320ML,8992772586030,8900.0,Beverages,48.0',
        '1000003,ADEM SARI CHINGKU HERBAL LEMON PET 350ML,8992772585026,8900.0,Beverages,65.0',
        '1000004,ADEM SARI CHINGKU HERBAL LEMON CAN 320ML,8992772586016,8000.0,Beverages,58.0',
        '1000005,ADEM SARI DUS 5SX7GR,8992772123068,18500.0,Beverages,19.0',
        '1000010,INDUK AYAM BERAS PANDAN WANGI BAG 5KG,8990007870022,113500.0,Fresh,49.0',
        '1000014,BUNGA ILALANG BERAS PREMIUM BAG 5KG,8990007870176,74500.0,Grocery,0.0',
      ].join('\r\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', 'template_import_produk_amanmart.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // Sample Excel (.xls) generator with Text (@) column formatting matching "SKU,Item Name,Barcode,Price,Category,Stock"
  const handleDownloadSampleExcel = () => {
    const htmlExcel = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8" />
<style>
  td, th { font-family: Calibri, Arial, sans-serif; font-size: 11pt; border: 1px solid #cbd5e1; padding: 4px 8px; }
  th { background-color: #0f172a; color: #ffffff; font-weight: bold; }
  .text-cell { mso-number-format:"\\@"; }
  .num-cell { mso-number-format:"0"; }
</style>
</head>
<body>
<table>
  <thead>
    <tr>
      <th>SKU</th>
      <th>Item Name</th>
      <th>Barcode</th>
      <th>Price</th>
      <th>Category</th>
      <th>Stock</th>
    </tr>
  </thead>
  <tbody>
    <tr><td class="text-cell">1000001</td><td>ADEM SARI CHINGKU HERBAL TEA CAN 320ML</td><td class="text-cell">8992772586023</td><td class="num-cell">8900</td><td>Beverages</td><td class="num-cell">36</td></tr>
    <tr><td class="text-cell">1000002</td><td>ADEM SARI CHINGKU SPARKLING LEMON 320ML</td><td class="text-cell">8992772586030</td><td class="num-cell">8900</td><td>Beverages</td><td class="num-cell">48</td></tr>
    <tr><td class="text-cell">1000003</td><td>ADEM SARI CHINGKU HERBAL LEMON PET 350ML</td><td class="text-cell">8992772585026</td><td class="num-cell">8900</td><td>Beverages</td><td class="num-cell">65</td></tr>
    <tr><td class="text-cell">1000004</td><td>ADEM SARI CHINGKU HERBAL LEMON CAN 320ML</td><td class="text-cell">8992772586016</td><td class="num-cell">8000</td><td>Beverages</td><td class="num-cell">58</td></tr>
    <tr><td class="text-cell">1000005</td><td>ADEM SARI DUS 5SX7GR</td><td class="text-cell">8992772123068</td><td class="num-cell">18500</td><td>Beverages</td><td class="num-cell">19</td></tr>
    <tr><td class="text-cell">1000010</td><td>INDUK AYAM BERAS PANDAN WANGI BAG 5KG</td><td class="text-cell">8990007870022</td><td class="num-cell">113500</td><td>Fresh</td><td class="num-cell">49</td></tr>
    <tr><td class="text-cell">1000014</td><td>BUNGA ILALANG BERAS PREMIUM BAG 5KG</td><td class="text-cell">8990007870176</td><td class="num-cell">74500</td><td>Grocery</td><td class="num-cell">0</td></tr>
  </tbody>
</table>
</body>
</html>`;

    const blob = new Blob([htmlExcel], { type: 'application/vnd.ms-excel;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', 'template_import_produk_amanmart.xls');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleExecuteImport = async () => {
    if (parsedRecords.length === 0) return;
    setIsProcessing(true);
    setTxError(null);
    setImportResult(null);
    setSyncProgress(null);

    try {
      const rawResult = await onImportComplete(
        parsedRecords,
        targetStoreId,
        updateExisting,
        replaceAllLocal,
        (completed, total) => setSyncProgress({ completed, total })
      );

      if (rawResult && typeof rawResult === 'object' && 'ok' in rawResult) {
        if (!rawResult.ok) {
          setTxError({
            message: rawResult.error || 'Import transaksi gagal.',
            rolledBack: rawResult.rolledBack,
            cloudRolledBack: rawResult.cloudRolledBack,
          });
          setIsProcessing(false);
          setSyncProgress(null);
          audioService.playErrorTone();
          return;
        }

        setImportResult({
          added: rawResult.added,
          updated: rawResult.updated,
          skipped: rawResult.skipped,
          duplicatesMerged: rawResult.duplicatesMerged,
          cloudSynced: rawResult.cloudSynced,
          cloudAttempted: rawResult.cloudAttempted,
        });
      } else {
        setImportResult({
          added: previewStats.newItems,
          updated: updateExisting ? previewStats.existingMatches : 0,
          skipped: 0,
          duplicatesMerged: parseResult.stats.duplicatesMerged,
          cloudSynced: 0,
          cloudAttempted: false,
        });
      }

      audioService.playPrintCompleteChime();
      setSyncProgress(null);
      setTimeout(() => {
        setIsProcessing(false);
        onClose();
      }, 1500);
    } catch (err: any) {
      setTxError({
        message: err?.message || 'Import gagal dijalankan',
        rolledBack: false,
      });
      setIsProcessing(false);
      setSyncProgress(null);
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
                Import Products Catalog (SKU, Item Name, Barcode, Price, Category, Stock)
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Mendukung 10.000+ baris Excel / CSV &amp; Sinkronisasi Otomatis ke Database Supabase
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
          {/* Quick 1-Click Load 10,112 Master Items Banner */}
          <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="text-xs font-bold text-emerald-950 flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                File Master Excel Anda (10.112 Item) Siap Dimuat!
              </div>
              <p className="text-[11px] text-emerald-800 mt-0.5">
                Format <code className="bg-emerald-100 px-1 rounded font-mono">SKU,Item Name,Barcode,Price,Category,Stock</code> sudah terverifikasi bebas error &amp; siap menggantikan data lokal lama.
              </p>
            </div>
            <button
              type="button"
              onClick={handleLoadBundledMasterCsv}
              disabled={isLoadingMaster}
              className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-xs transition shrink-0 flex items-center gap-1.5"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              {isLoadingMaster ? 'Memuat 10.112 Item...' : 'Muat 10.112 Item Master'}
            </button>
          </div>

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
                Update Options &amp; Mitigasi Data Lokal
              </label>
              <div className="space-y-2">
                <label className="flex items-start gap-2 cursor-pointer text-xs font-semibold text-emerald-900 bg-emerald-50/80 p-2 rounded-lg border border-emerald-200">
                  <input
                    type="checkbox"
                    checked={replaceAllLocal}
                    onChange={(e) => setReplaceAllLocal(e.target.checked)}
                    className="w-4 h-4 mt-0.5 text-emerald-600 rounded border-emerald-300 focus:ring-emerald-500"
                  />
                  <span>
                    Hapus / Ganti seluruh data lokal lama dengan data baru ini (Mitigasi Data Lokal ke Supabase)
                  </span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-slate-700">
                  <input
                    type="checkbox"
                    checked={updateExisting}
                    onChange={(e) => setUpdateExisting(e.target.checked)}
                    className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
                  />
                  <span>Otomatis timpa &amp; update harga/detail jika Barcode/SKU sudah ada</span>
                </label>
                <div className="flex flex-wrap items-center gap-3 pt-0.5">
                  <button
                    type="button"
                    onClick={handleDownloadSampleCsv}
                    className="inline-flex items-center gap-1 text-[11px] font-bold text-blue-600 hover:text-blue-800 underline"
                  >
                    <Download className="w-3 h-3" />
                    Download Template CSV
                  </button>
                  <button
                    type="button"
                    onClick={handleDownloadSampleExcel}
                    className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 hover:text-emerald-900 underline"
                  >
                    <FileSpreadsheet className="w-3 h-3" />
                    Download Template Excel (.xls)
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
              <div className="space-y-3">
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
                    accept=".csv,.txt,.tsv,.xls,.xlsx,.xlsm,.xlsb,.ods"
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files && e.target.files[0]) {
                        handleFileUpload(e.target.files[0]);
                      }
                      e.target.value = '';
                    }}
                  />
                  <div className="w-12 h-12 rounded-2xl bg-blue-100 text-blue-600 mx-auto flex items-center justify-center mb-3">
                    <Upload className="w-6 h-6" />
                  </div>
                  <h3 className="text-sm font-bold text-slate-800">
                    {fileName ? fileName : 'Choose CSV / Excel file or drag & drop here'}
                  </h3>
                  <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
                    Mendukung export Excel Dynamics 365 (.xlsx, .xls, .xlsm, .ods) &amp; CSV — file Excel otomatis dikonversi menjadi CSV saat diunggah.
                  </p>
                  {fileName && !fileError && (
                    <div
                      className={`mt-3 inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold ${
                        parsedRecords.length > 0
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-amber-100 text-amber-900'
                      }`}
                    >
                      {parsedRecords.length > 0 ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                      ) : (
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                      )}
                      {parsedRecords.length > 0
                        ? `File loaded (${parsedRecords.length} valid rows${
                            convertedCsvInfo ? ` • Excel → CSV (${convertedCsvInfo.sheetName})` : ''
                          }${parseResult.stats.isDynamicsFormat ? ' • Dynamics 365 mapped' : ''})`
                        : 'File terbaca, namun 0 baris produk cocok (pastikan ada kolom Description / Item Name / SKU)'}
                    </div>
                  )}
                  {fileError && (
                    <div className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-red-100 text-red-800 text-xs font-bold">
                      <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                      <span>{fileError}</span>
                    </div>
                  )}
                </div>

                {fileName && !fileError && convertedCsvInfo && parsedRecords.length > 0 && (
                  <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 rounded-xl bg-emerald-50 border border-emerald-200">
                    <div className="flex items-center gap-2 text-xs text-emerald-900">
                      <FileSpreadsheet className="w-4 h-4 text-emerald-600 shrink-0" />
                      <span>
                        Otomatis dikonversi ke CSV standar Amanmart dari sheet{' '}
                        <span className="font-bold">{convertedCsvInfo.sheetName}</span>
                        {convertedCsvInfo.sheetCount > 1
                          ? ` (${convertedCsvInfo.sheetCount} sheet terdeteksi)`
                          : ''}
                        .
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={handleDownloadConvertedCsv}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-emerald-300 text-emerald-800 hover:bg-emerald-100 text-[11px] font-bold transition shadow-sm"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Download CSV Hasil Konversi
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Tab 2: Paste */}
            {activeTab === 'paste' && (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                  <span>Copy rows directly from Dynamics 365 Excel or Google Sheets (with headers) and paste below:</span>
                  <span className="font-mono text-[11px] text-slate-400">
                    Auto-maps Item Code, Barcode 0, Description, Inv On Hand, Harga Jual 0/1/2
                  </span>
                </div>
                <textarea
                  rows={6}
                  value={rawText}
                  onChange={(e) => {
                    setRawText(e.target.value);
                    setTxError(null);
                    setImportResult(null);
                    setConvertedCsvInfo(null);
                  }}
                  placeholder={`Item Code\tBarcode 0\tDescription\tInv On Hand\tCategory Code\tHarga Jual 0\n1001040\t089686010015\tINDOMIE AYAM BAWANG 69GR\t50\tINSTANT FOOD\t2900`}
                  className="w-full p-3 font-mono text-xs bg-slate-50 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-800 placeholder-slate-400"
                />
              </div>
            )}
          </div>

          {/* Dynamics 365 Auto-Mapped Controls & Column Strip */}
          {rawText.trim().length > 0 && parseResult.stats.isDynamicsFormat && (
            <div className="p-3.5 rounded-xl bg-blue-50/80 border border-blue-200 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-blue-600 shrink-0" />
                  <span className="text-xs font-bold text-blue-950">
                    Microsoft Dynamics 365 Format Detected
                  </span>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-800">
                    {parseResult.columnMap.matchedLabels.length} Columns Mapped
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-1.5 text-[11px] font-bold text-slate-700">
                    <span>Unit Price Tier:</span>
                    <select
                      value={priceTier}
                      onChange={(e) => setPriceTier(e.target.value as DynamicsPriceTierOption)}
                      className="px-2 py-1 rounded-lg border border-blue-200 bg-white text-[11px] font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="auto">Auto (Harga Jual 0 → 1 → 2)</option>
                      <option value="harga_jual_0">Harga Jual 0 (Retail PCS)</option>
                      <option value="harga_jual_1">Harga Jual 1 (Tier 1)</option>
                      <option value="harga_jual_2">Harga Jual 2 (Wholesale)</option>
                    </select>
                  </label>

                  {(parseResult.columnMap.blockedIdx >= 0 || parseResult.stats.blockedFound > 0) && (
                    <label className="flex items-center gap-1.5 cursor-pointer text-[11px] font-semibold text-slate-700">
                      <input
                        type="checkbox"
                        checked={skipBlocked}
                        onChange={(e) => setSkipBlocked(e.target.checked)}
                        className="w-3.5 h-3.5 text-blue-600 rounded border-slate-300"
                      />
                      <span>Skip Blocked ({parseResult.stats.blockedFound})</span>
                    </label>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {parseResult.columnMap.matchedLabels.map((m, idx) => (
                  <span
                    key={idx}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white border border-blue-200/80 text-[10px] text-slate-700 font-medium"
                  >
                    <span className="font-mono text-slate-500">{m.sourceHeader}</span>
                    <span className="text-blue-500">→</span>
                    <span className="font-bold text-blue-900">{m.targetField}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Data Integrity & Validation Notices */}
          {parseResult.warnings.length > 0 && (
            <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 space-y-1">
              <div className="flex items-center gap-1.5 text-xs font-bold">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                <span>Data Integrity Checks ({parseResult.warnings.length})</span>
              </div>
              <ul className="list-disc pl-5 text-[11px] text-amber-800 space-y-0.5">
                {parseResult.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
              {parseResult.stats.duplicateSamples.length > 0 && (
                <p className="text-[10px] font-mono text-amber-700 pl-5">
                  Duplikat digabung: {parseResult.stats.duplicateSamples.join(', ')}
                </p>
              )}
            </div>
          )}

          {/* Live Preview Table */}
          {parsedRecords.length > 0 && (
            <div className="space-y-3 pt-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                  Import Preview &amp; Verification
                </h4>
                <div className="flex flex-wrap items-center gap-2">
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
                  {parseResult.stats.duplicatesMerged > 0 && (
                    <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800">
                      Duplicates Merged: {parseResult.stats.duplicatesMerged}
                    </span>
                  )}
                </div>
              </div>

              <div className="border border-slate-200 rounded-xl overflow-hidden max-h-56 overflow-y-auto bg-white">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200 sticky top-0">
                    <tr>
                      <th className="py-2 px-3">Status</th>
                      <th className="py-2 px-3">Item Name &amp; SKU</th>
                      <th className="py-2 px-3 font-mono">Barcode (EAN-13)</th>
                      <th className="py-2 px-3 text-right">Unit Price</th>
                      <th className="py-2 px-3 text-right font-mono">Allocated Stock</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {parsedRecords.slice(0, 25).map((r, idx) => {
                      const isMatch =
                        (r.barcode && existingLookup.barcodeSet.has(r.barcode.toLowerCase())) ||
                        (r.sku && existingLookup.skuMap.has(r.sku.toLowerCase())) ||
                        existingLookup.nameMap.has(r.name.toLowerCase());

                      return (
                        <tr key={idx} className="hover:bg-slate-50/80">
                          <td className="py-2 px-3">
                            {isMatch ? (
                              <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-700">
                                {updateExisting ? 'Update' : 'Skip'}
                              </span>
                            ) : (
                              <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-700">
                                Create New
                              </span>
                            )}
                            {r.blocked && (
                              <span className="ml-1 inline-block px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-100 text-amber-800">
                                Blocked
                              </span>
                            )}
                          </td>
                          <td className="py-2 px-3 font-semibold text-slate-800">
                            <div>{r.name}</div>
                            <div className="text-[10px] text-slate-400 font-normal flex flex-wrap items-center gap-1.5">
                              {r.sku && <span className="font-mono text-slate-600">SKU: {r.sku}</span>}
                              {r.category && (
                                <span className="text-emerald-700 font-medium">• {r.category}</span>
                              )}
                              {r.brand && (
                                <span className="text-slate-500">• Vendor: {r.brand}</span>
                              )}
                            </div>
                          </td>
                          <td className="py-2 px-3 font-mono text-slate-700">
                            {r.barcode}
                          </td>
                          <td className="py-2 px-3 text-right font-bold text-slate-900">
                            <div>
                              Rp. {r.price.toLocaleString('id-ID')}
                              {r.unitLabel && (
                                <span className="text-[10px] font-normal text-slate-500 ml-1">/{r.unitLabel}</span>
                              )}
                            </div>
                            {r.bulkPrice && r.bulkPrice > 0 && (
                              <div className="text-[10px] font-normal text-slate-500">
                                {r.bulkLabel || 'CRT'}: Rp. {r.bulkPrice.toLocaleString('id-ID')}
                              </div>
                            )}
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
              {parsedRecords.length > 25 && (
                <p className="text-[11px] text-slate-500 text-center">
                  Showing first 25 of {parsedRecords.length} items. All items will be imported.
                </p>
              )}
            </div>
          )}

          {/* Transaction Error & Rollback Banner */}
          {txError && (
            <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-900 flex items-start gap-3">
              <RotateCcw className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-xs font-bold">
                  {txError.rolledBack
                    ? 'Transaksi Dibatalkan — Katalog Berhasil Di-Rollback'
                    : 'Import Gagal Dijalankan'}
                </p>
                <p className="text-xs text-red-800">{txError.message}</p>
                {txError.rolledBack && (
                  <p className="text-[11px] text-red-700 font-medium">
                    Data lokal &amp; status sebelumnya telah dipulihkan utuh tanpa perubahan parsial
                    {txError.cloudRolledBack === false
                      ? ' (periksa koneksi Supabase untuk sinkronisasi ulang).'
                      : '.'}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Success Banner */}
          {importResult && (
            <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 flex items-center gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
              <div>
                <p className="text-xs font-bold">Import Completed Successfully!</p>
                <p className="text-xs text-emerald-700">
                  Created {importResult.added} new products and updated {importResult.updated} existing products
                  {importResult.skipped > 0 ? ` (${importResult.skipped} skipped)` : ''}
                  {importResult.cloudAttempted ? ` • Supabase synced: ${importResult.cloudSynced} items` : ''}.
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
                  {syncProgress
                    ? `Syncing Supabase (${syncProgress.completed}/${syncProgress.total})...`
                    : 'Importing & Verifying...'}
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
