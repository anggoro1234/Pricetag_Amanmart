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
  Building2
} from 'lucide-react';
import { StoreLocation, ImportProductRecord, Product } from '../types';
import { audioService } from '../services/audioService';
import { sanitizeBarcodeValue, normalizeCategoryName } from '../services/storageService';

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
  // Remove "Rp", "IDR", currency symbols, quotes, spaces
  let clean = val
    .trim()
    .replace(/^=+/, '')
    .replace(/^['"]+|['"]+$/g, '')
    .replace(/[rR][pP]\.?|[iI][dD][rR]\.?|\$|€|\s+/g, '');

  if (!clean || clean === '-') return 0;

  // Check Indonesian / European decimal format e.g. "56.500,00" or "56.500" vs "56500.50"
  if (clean.includes('.') && clean.includes(',')) {
    if (clean.lastIndexOf(',') > clean.lastIndexOf('.')) {
      // Format: 56.500,00
      clean = clean.replace(/\./g, '').replace(',', '.');
    } else {
      // Format: 56,500.00
      clean = clean.replace(/,/g, '');
    }
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
    if (parts[1] && parts[1].length === 3 && parseInt(parts[0], 10) > 0 && parts[0].length <= 3) {
      // Could be thousands separator like 56,500 if price > 100
      // Wait: in Indonesia, prices are in thousands (e.g. 2900 to 500000), while decimal comma is ,00
      clean = clean.replace(/,/g, '');
    } else {
      clean = clean.replace(',', '.');
    }
  }

  const num = parseFloat(clean);
  return isNaN(num) || num < 0 ? 0 : Math.round(num);
};

// Function to parse stock safely (handles Indonesian decimal comma like "44,658", "0", or negative "-600,000")
const parseStock = (val: string | undefined, defaultStock: number = 50): number => {
  if (val === undefined || val === null) return defaultStock;
  let clean = val
    .trim()
    .replace(/^=+/, '')
    .replace(/^['"]+|['"]+$/g, '')
    .replace(/\s+/g, '');

  if (clean === '' || clean === '-') return defaultStock;

  // Handle Indonesian decimal comma e.g. "44,658" or "-600,000"
  if (clean.includes(',') && !clean.includes('.')) {
    clean = clean.replace(',', '.');
  } else if (clean.includes('.') && clean.includes(',')) {
    if (clean.lastIndexOf(',') > clean.lastIndexOf('.')) {
      clean = clean.replace(/\./g, '').replace(',', '.');
    } else {
      clean = clean.replace(/,/g, '');
    }
  }

  const num = parseFloat(clean);
  if (isNaN(num)) return defaultStock;
  return Math.max(0, Math.round(num));
};

// Count unquoted occurrences of a character in a line
const countUnquotedChar = (line: string, targetChar: string): number => {
  let count = 0;
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQuotes = !inQuotes;
    } else if (c === targetChar && !inQuotes) {
      count++;
    }
  }
  return count;
};

// Detect primary delimiter across the whole file so decimal commas (e.g. "44,658") never break ";" CSV files
const detectPrimaryDelimiter = (lines: string[]): string => {
  let tabScore = 0;
  let semiScore = 0;
  let commaScore = 0;

  const sampleLines = lines.slice(0, Math.min(10, lines.length));
  for (const rawLine of sampleLines) {
    // Unwrap full-line outer quotes if Excel wrapped the entire row
    const line = unwrapFullLineQuotes(rawLine);
    tabScore += countUnquotedChar(line, '\t');
    semiScore += countUnquotedChar(line, ';');
    commaScore += countUnquotedChar(line, ',');
  }

  if (tabScore > 0 && tabScore >= semiScore && tabScore >= commaScore) return '\t';
  if (semiScore > 0 && semiScore >= commaScore) return ';';
  return ',';
};

// Unwrap outer quotes if an entire CSV row was wrapped in quotes by Excel e.g. "ITEM;;56500;50007;FRESH;44"
const unwrapFullLineQuotes = (line: string): string => {
  const trimmed = line.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    const inner = trimmed.slice(1, -1);
    // If inner has semicolons or tabs and doesn't look like normal multi-quoted fields
    if (!inner.includes('","') && !inner.includes('";"') && (inner.includes(';') || inner.includes('\t'))) {
      return inner.replace(/""/g, '"');
    }
  }
  return trimmed;
};

// Clean Excel cell text wrapper such as ="8992688001017" or '8992688001017
const cleanCellValue = (val: string): string => {
  let s = val.trim();
  if (s.startsWith('="') && s.endsWith('"')) {
    s = s.slice(2, -1);
  }
  s = s.replace(/^"+|"+$/g, '').trim();
  return s;
};

// Helper to split CSV line safely handling quotes and consistent delimiter
const parseCsvLine = (rawLine: string, forcedDelim?: string): string[] => {
  const line = unwrapFullLineQuotes(rawLine);
  const result: string[] = [];
  let cur = '';
  let inQuotes = false;

  let delim = forcedDelim || ',';
  if (!forcedDelim) {
    const tabs = countUnquotedChar(line, '\t');
    const semis = countUnquotedChar(line, ';');
    const commas = countUnquotedChar(line, ',');
    if (tabs > 0 && tabs >= semis && tabs >= commas) delim = '\t';
    else if (semis > 0 && semis >= commas) delim = ';';
  }

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delim && !inQuotes) {
      result.push(cleanCellValue(cur));
      cur = '';
    } else {
      cur += char;
    }
  }
  result.push(cleanCellValue(cur));

  // Fallback recovery: if line was split by "," into <= 2 pieces, but the first piece contains 2+ ";"
  // (e.g. "BONELESS PAHA FZ/ KG;;56500;50007;FRESH;44,658")
  if (delim !== ';' && result.length <= 2 && (result[0]?.split(';').length ?? 0) >= 3) {
    return parseCsvLine(line, ';');
  }

  return result;
};

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

// Native browser .xlsx (ZIP + XML) reader using DecompressionStream
const extractTextFromXlsxBuffer = async (buffer: ArrayBuffer): Promise<string | null> => {
  try {
    const bytes = new Uint8Array(buffer);
    // Check ZIP magic header PK\x03\x04
    if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) return null;

    const view = new DataView(buffer);
    const files: Record<string, string> = {};
    let offset = 0;

    while (offset + 30 <= bytes.length) {
      const sig = view.getUint32(offset, true);
      if (sig !== 0x04034b50) break;

      const compression = view.getUint16(offset + 8, true);
      const compressedSize = view.getUint32(offset + 18, true);
      const fileNameLen = view.getUint16(offset + 26, true);
      const extraLen = view.getUint16(offset + 28, true);

      const fileName = new TextDecoder().decode(bytes.subarray(offset + 30, offset + 30 + fileNameLen));
      const dataStart = offset + 30 + fileNameLen + extraLen;
      const compressedData = bytes.subarray(dataStart, dataStart + compressedSize);

      if (
        fileName === 'xl/sharedStrings.xml' ||
        fileName.startsWith('xl/worksheets/sheet1.xml')
      ) {
        if (compression === 0) {
          files[fileName] = new TextDecoder().decode(compressedData);
        } else if (compression === 8 && typeof DecompressionStream !== 'undefined') {
          const ds = new DecompressionStream('deflate-raw');
          const writer = ds.writable.getWriter();
          writer.write(compressedData);
          writer.close();
          const resp = new Response(ds.readable);
          files[fileName] = await resp.text();
        }
      }

      offset = dataStart + compressedSize;
    }

    const sheetXml = files['xl/worksheets/sheet1.xml'];
    if (!sheetXml) return null;

    const parser = new DOMParser();
    const sharedStrings: string[] = [];
    if (files['xl/sharedStrings.xml']) {
      const ssDoc = parser.parseFromString(files['xl/sharedStrings.xml'], 'application/xml');
      Array.from(ssDoc.getElementsByTagName('si')).forEach((si) => {
        const texts = Array.from(si.getElementsByTagName('t')).map((t) => t.textContent || '');
        sharedStrings.push(texts.join(''));
      });
    }

    const sheetDoc = parser.parseFromString(sheetXml, 'application/xml');
    const rowEls = Array.from(sheetDoc.getElementsByTagName('row'));
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
      const cellEls = Array.from(rowEl.getElementsByTagName('c'));
      const rowVals: string[] = [];
      cellEls.forEach((cEl) => {
        const ref = cEl.getAttribute('r') || '';
        const colIdx = ref ? colLettersToIndex(ref) : rowVals.length;
        const type = cEl.getAttribute('t');
        const vEl = cEl.getElementsByTagName('v')[0];
        const isEl = cEl.getElementsByTagName('is')[0];
        let val = vEl?.textContent || isEl?.textContent || '';
        if (type === 's') {
          const ssIdx = parseInt(val, 10);
          val = sharedStrings[ssIdx] ?? val;
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
  const [rawText, setRawText] = useState<string>('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [importResult, setImportResult] = useState<{ added: number; updated: number } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fast O(1) lookup maps for existing products (prevents freezing when importing 10,000+ items)
  const existingLookup = useMemo(() => {
    const skuMap = new Map<string, Product>();
    const nameMap = new Map<string, Product>();
    const barcodeSet = new Set<string>();

    existingProducts.forEach((p) => {
      if (p.sku) skuMap.set(p.sku.toLowerCase(), p);
      if (p.name) nameMap.set(p.name.toLowerCase(), p);
      if (p.barcode) barcodeSet.add(p.barcode.toLowerCase());
    });

    return { skuMap, nameMap, barcodeSet };
  }, [existingProducts]);

  // Parse raw text into structured records
  const parsedRecords = useMemo((): ImportProductRecord[] => {
    if (!rawText.trim()) return [];

    // Strip UTF-8 BOM if present
    const cleanRaw = rawText.replace(/^\uFEFF/, '');

    let lines = cleanRaw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    if (lines.length === 0) return [];

    // Check if first line is Excel "sep=;" or "sep=," directive
    let forcedDelim: string | undefined;
    if (/^sep=.$/i.test(lines[0])) {
      forcedDelim = lines[0].slice(4, 5);
      lines = lines.slice(1);
    }

    if (lines.length === 0) return [];

    const primaryDelim = forcedDelim || detectPrimaryDelimiter(lines);

    // Analyze first line for potential header
    const firstRow = parseCsvLine(lines[0], primaryDelim);
    const lowerFirstRow = firstRow.map((c) => c.toLowerCase().trim());

    const isHeader = lowerFirstRow.some(
      (h) =>
        h.includes('item') ||
        h.includes('nama') ||
        h.includes('product') ||
        h.includes('barang') ||
        h.includes('deskripsi') ||
        h.includes('barcode') ||
        h.includes('harga') ||
        h.includes('price') ||
        h.includes('sku')
    );

    let nameIdx = 0;
    let barcodeIdx = 1;
    let priceIdx = 2;
    let skuIdx = 3;
    let categoryIdx = 4;
    let stockIdx = 5;
    let bulkPriceIdx = -1;

    let dataLines = lines;

    if (isHeader) {
      dataLines = lines.slice(1);
      // Reset optional indices before mapping header columns
      skuIdx = -1;
      categoryIdx = -1;
      stockIdx = -1;

      lowerFirstRow.forEach((col, idx) => {
        if (
          col.includes('item') ||
          col.includes('nama') ||
          col.includes('product') ||
          col.includes('barang') ||
          col.includes('deskripsi') ||
          col.includes('description')
        ) {
          nameIdx = idx;
        } else if (col.includes('barcode') || col.includes('ean') || col.includes('upc') || col.includes('kode')) {
          barcodeIdx = idx;
        } else if (
          (col.includes('harga') || col.includes('price') || col.includes('unit_price') || col.includes('rp')) &&
          !col.includes('bulk') &&
          !col.includes('crt') &&
          !col.includes('karton')
        ) {
          priceIdx = idx;
        } else if (col.includes('sku') || col.includes('plu')) {
          skuIdx = idx;
        } else if (col.includes('category') || col.includes('kategori') || col.includes('dept')) {
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
      let cols = parseCsvLine(line, primaryDelim);
      if (cols.length === 0 || !cols.some((c) => c.length > 0)) return;

      // Extra safety: if cols[0] still has embedded semicolons (e.g. from a doubly-quoted cell in Excel), split it
      if ((cols[nameIdx]?.split(';').length ?? 0) >= 3) {
        const reconstructed = cols.join(',');
        cols = parseCsvLine(reconstructed, ';');
      }

      let rawName = (cols[nameIdx] || '').trim();
      let rawBarcode = (cols[barcodeIdx] || '').trim();
      let rawPrice = (cols[priceIdx] || '').trim();
      let rawSku = skuIdx >= 0 && cols[skuIdx] ? cols[skuIdx].trim() : undefined;
      let rawCategory = categoryIdx >= 0 && cols[categoryIdx] ? cols[categoryIdx].trim() : undefined;
      let rawStock = stockIdx >= 0 && cols[stockIdx] !== undefined ? cols[stockIdx].trim() : undefined;

      // If rawName still contains ";" segments, clean and extract them so description is never corrupted
      if (rawName.includes(';')) {
        const semiParts = rawName.split(';').map((s) => s.trim());
        rawName = semiParts[0] || '';
        if (semiParts[1] && !rawBarcode) rawBarcode = semiParts[1];
        if (semiParts[2] && !rawPrice) rawPrice = semiParts[2];
        if (semiParts[3] && !rawSku) rawSku = semiParts[3];
        if (semiParts[4] && !rawCategory) rawCategory = semiParts[4];
        if (semiParts[5] !== undefined && !rawStock) rawStock = semiParts[5];
      }

      const name = rawName
        .replace(/^['";]+|['";]+$/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toUpperCase();

      if (!name) return;

      const sku = rawSku ? rawSku.replace(/^['"]+|['"]+$/g, '').trim() : undefined;
      const price = parsePrice(rawPrice);
      const category = normalizeCategoryName(rawCategory);
      const stock = parseStock(rawStock, 50);

      // O(1) lookup if an existing product in catalog already has a valid barcode for this SKU / Name
      const existingMatch =
        (sku ? existingLookup.skuMap.get(sku.toLowerCase()) : undefined) ||
        existingLookup.nameMap.get(name.toLowerCase());

      let finalBarcode = '';
      const cleanedInputBc = rawBarcode
        .replace(/^=+/, '')
        .replace(/^['"]+|['"]+$/g, '')
        .replace(/\s+/g, '');

      const isInputCorruptedOrEmpty =
        !cleanedInputBc ||
        cleanedInputBc === '-' ||
        cleanedInputBc === '0' ||
        cleanedInputBc.length < 5 ||
        /e\+/i.test(cleanedInputBc) ||
        (/^[0-9]{11,14}$/.test(cleanedInputBc) && /0{6,}$/.test(cleanedInputBc));

      if (isInputCorruptedOrEmpty && existingMatch && existingMatch.barcode.length >= 8) {
        finalBarcode = existingMatch.barcode;
      } else {
        finalBarcode = sanitizeBarcodeValue(rawBarcode, sku || name);
      }

      records.push({
        name,
        barcode: finalBarcode,
        price,
        sku,
        category,
        stock,
        bulkPrice: bulkPriceIdx >= 0 && cols[bulkPriceIdx] ? parsePrice(cols[bulkPriceIdx]) : undefined,
      });
    });

    return records;
  }, [rawText, existingLookup]);

  // Check matching status with existing catalog in O(1) per record
  const previewStats = useMemo(() => {
    let existingMatches = 0;
    let newItems = 0;

    parsedRecords.forEach((rec) => {
      const exists =
        (rec.barcode && existingLookup.barcodeSet.has(rec.barcode.toLowerCase())) ||
        (rec.sku && existingLookup.skuMap.has(rec.sku.toLowerCase())) ||
        existingLookup.nameMap.has(rec.name.toLowerCase());
      if (exists) existingMatches++;
      else newItems++;
    });

    return {
      total: parsedRecords.length,
      existingMatches,
      newItems,
    };
  }, [parsedRecords, existingLookup]);

  // Handle file reading (.csv, .txt, .tsv, .xls, .xlsx)
  const handleFileUpload = async (file: File) => {
    if (!file) return;
    setFileName(file.name);
    setFileError(null);

    try {
      const lowerName = file.name.toLowerCase();

      // Check if binary .xlsx file
      const buffer = await file.arrayBuffer();
      const firstBytes = new Uint8Array(buffer.slice(0, 4));
      const isZipXlsx =
        firstBytes.length >= 4 &&
        firstBytes[0] === 0x50 &&
        firstBytes[1] === 0x4b &&
        firstBytes[2] === 0x03 &&
        firstBytes[3] === 0x04;

      if (isZipXlsx || lowerName.endsWith('.xlsx')) {
        const extracted = await extractTextFromXlsxBuffer(buffer);
        if (extracted) {
          setRawText(extracted);
          audioService.playScanBeep();
          return;
        } else {
          setFileError(
            'File .xlsx tidak dapat dibaca secara langsung. Silakan simpan sebagai CSV (Comma/Semicolon delimited) atau Copy-Paste baris dari Excel.'
          );
          return;
        }
      }

      // Decode as UTF-8 text (or fallback to Windows-1252 if needed)
      const text = new TextDecoder('utf-8').decode(buffer);

      // Check if it's an HTML/XML .xls file from Excel
      const htmlExtracted = extractTextFromHtmlOrXmlSpreadsheet(text);
      if (htmlExtracted) {
        setRawText(htmlExtracted);
        audioService.playScanBeep();
        return;
      }

      if (text) {
        setRawText(text);
        audioService.playScanBeep();
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

  // Sample CSV generator (Excel-safe: uses ";" delimiter + ="barcode" so Excel doesn't turn barcodes into 8.99E+12!)
  const handleDownloadSampleCsv = () => {
    const csvContent =
      '\uFEFF' +
      [
        'Item Name;Barcode;Price;SKU;Category;Stock',
        'INDOMIE SOTO MIE 70GR;="089686010022";2900;1001043;Instant Food;60',
        'TEH BOTOL SOSRO 450ML;="8992688001017";7500;1003056;Beverages;45',
        'POKKY CHOCOLATE 47GR;="8993077110123";9800;1004115;Snacks;35',
        'SABUN LIFEBUOY LEMON 85GR;="8999999052058";4500;1005205;Personal Care;80',
        'MINYAK GORENG SANIA 2L;="8992775211024";34500;1006001;Grocery;30',
        'ROTI TAWAR SARI ROTI;="8998888123456";16000;1007010;Bakery;25',
        'BONELESS PAHA FZ/ KG;;56500;50007;Fresh;44',
      ].join('\r\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', 'template_import_produk_amanmart.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Sample Excel (.xls) generator with Text (@) column formatting so barcodes never become 8.99E+12 in Excel
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
      <th>Item Name</th>
      <th>Barcode</th>
      <th>Price</th>
      <th>SKU</th>
      <th>Category</th>
      <th>Stock</th>
    </tr>
  </thead>
  <tbody>
    <tr><td>INDOMIE SOTO MIE 70GR</td><td class="text-cell">8996860100229</td><td class="num-cell">2900</td><td class="text-cell">1001043</td><td>Instant Food</td><td class="num-cell">60</td></tr>
    <tr><td>TEH BOTOL SOSRO 450ML</td><td class="text-cell">8992688001017</td><td class="num-cell">7500</td><td class="text-cell">1003056</td><td>Beverages</td><td class="num-cell">45</td></tr>
    <tr><td>POKKY CHOCOLATE 47GR</td><td class="text-cell">8993077110123</td><td class="num-cell">9800</td><td class="text-cell">1004115</td><td>Snacks</td><td class="num-cell">35</td></tr>
    <tr><td>SABUN LIFEBUOY LEMON 85GR</td><td class="text-cell">8999999052058</td><td class="num-cell">4500</td><td class="text-cell">1005205</td><td>Personal Care</td><td class="num-cell">80</td></tr>
    <tr><td>MINYAK GORENG SANIA 2L</td><td class="text-cell">8992775211024</td><td class="num-cell">34500</td><td class="text-cell">1006001</td><td>Grocery</td><td class="num-cell">30</td></tr>
    <tr><td>ROTI TAWAR SARI ROTI</td><td class="text-cell">8998888123456</td><td class="num-cell">16000</td><td class="text-cell">1007010</td><td>Bakery</td><td class="num-cell">25</td></tr>
    <tr><td>BONELESS PAHA FZ/ KG</td><td class="text-cell">8990000500079</td><td class="num-cell">56500</td><td class="text-cell">50007</td><td>Fresh</td><td class="num-cell">44</td></tr>
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
                Update Options &amp; Templates
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
                <div className="flex flex-wrap items-center gap-3 pt-0.5">
                  <button
                    type="button"
                    onClick={handleDownloadSampleCsv}
                    className="inline-flex items-center gap-1 text-[11px] font-bold text-blue-600 hover:text-blue-800 underline"
                  >
                    <Download className="w-3 h-3" />
                    Download Template CSV (Anti E+12)
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
                  accept=".csv,.txt,.tsv,.xls,.xlsx"
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
                  {fileName ? fileName : 'Choose CSV / Excel file or drag & drop here'}
                </h3>
                <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
                  Supports semicolon (;), comma (,), tab CSV, and Excel (.xls/.xlsx) files with Item Name, Barcode, Price, SKU, Category, and Stock columns.
                </p>
                {fileName && !fileError && (
                  <div className="mt-3 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 text-xs font-bold">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                    File loaded ({parsedRecords.length} valid rows found)
                  </div>
                )}
                {fileError && (
                  <div className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-red-100 text-red-800 text-xs font-bold">
                    <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                    <span>{fileError}</span>
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
                    Format: Item Name ; Barcode ; Price ; SKU ; Category ; Stock
                  </span>
                </div>
                <textarea
                  rows={6}
                  value={rawText}
                  onChange={(e) => setRawText(e.target.value)}
                  placeholder={`INDOMIE AYAM BAWANG 69GR; 089686010015; 2900; 1001040; Instant Food; 50\nBONELESS PAHA FZ/ KG;; 56500; 50007; Fresh; 44\nULTRA MILK FULL CREAM 1000ML; 8992761011124; 21500; 1002010; Beverages; 40`}
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
                          </td>
                          <td className="py-2 px-3 font-semibold text-slate-800">
                            <div>{r.name}</div>
                            <div className="text-[10px] text-slate-400 font-normal flex items-center gap-1.5">
                              {r.sku && <span className="font-mono text-slate-600">SKU: {r.sku}</span>}
                              {r.category && (
                                <span className="text-emerald-700 font-medium">• {r.category}</span>
                              )}
                            </div>
                          </td>
                          <td className="py-2 px-3 font-mono text-slate-700">
                            {r.barcode}
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
              {parsedRecords.length > 25 && (
                <p className="text-[11px] text-slate-500 text-center">
                  Showing first 25 of {parsedRecords.length} items. All items will be imported.
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
