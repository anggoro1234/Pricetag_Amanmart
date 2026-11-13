import { ImportProductRecord, Product } from '../types';

export type DynamicsPriceTierOption = 'auto' | 'harga_jual_0' | 'harga_jual_1' | 'harga_jual_2';

export interface ExistingProductLookup {
  skuMap: Map<string, Product>;
  nameMap: Map<string, Product>;
  barcodeSet: Set<string>;
}

export interface ImportParseOptions {
  priceTier?: DynamicsPriceTierOption;
  skipBlocked?: boolean;
  existingLookup?: ExistingProductLookup;
  sanitizeBarcode: (rawBarcode?: string, fallbackSeed?: string) => string;
  normalizeCategory: (raw?: string) => string;
}

export interface ResolvedColumnMap {
  isHeader: boolean;
  isDynamicsFormat: boolean;
  detectedDelimiter: string;
  skuIdx: number;
  nameIdx: number;
  barcodeIdx: number;
  priceIdx: number;
  bulkPriceIdx: number;
  hargaJual0Idx: number;
  hargaJual1Idx: number;
  hargaJual2Idx: number;
  unitCostIdx: number;
  categoryIdx: number;
  subCategoryIdx: number;
  departmentIdx: number;
  stockIdx: number;
  blockedIdx: number;
  satuanKecilIdx: number;
  satuanSedangIdx: number;
  satuanBesarIdx: number;
  salesUomIdx: number;
  isiSedangIdx: number;
  isiBesarIdx: number;
  vendorIdx: number;
  lastModifiedIdx: number;
  matchedLabels: { sourceHeader: string; targetField: string }[];
}

export interface ImportValidationStats {
  totalDataRows: number;
  validCount: number;
  isDynamicsFormat: boolean;
  detectedDelimiter: string;
  skippedMissingName: number;
  skippedBlocked: number;
  blockedFound: number;
  duplicatesMerged: number;
  zeroPriceCount: number;
  invalidPriceCells: number;
  negativeStockClamped: number;
  repairedBarcodes: number;
  duplicateSamples: string[];
  skippedSamples: string[];
}

export interface ImportParseResult {
  records: ImportProductRecord[];
  columnMap: ResolvedColumnMap;
  stats: ImportValidationStats;
  warnings: string[];
}

export interface ParsedNumberResult {
  value: number;
  isValid: boolean;
  isNegative: boolean;
  hasValue: boolean;
}

const normalizeHeader = (raw: string): string =>
  (raw || '')
    .replace(/^\uFEFF/, '')
    .trim()
    .replace(/^["']+|["']+$/g, '')
    .replace(/[\s\u00A0]+/g, ' ')
    .toLowerCase();

const compactHeader = (norm: string): string =>
  norm.replace(/[^a-z0-9]/g, '');

// Unwrap outer quotes if an entire CSV row was wrapped in quotes by Excel e.g. "ITEM;;56500;50007;FRESH;44"
export const unwrapFullLineQuotes = (line: string): string => {
  const trimmed = line.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    const inner = trimmed.slice(1, -1);
    if (!inner.includes('","') && !inner.includes('";"') && (inner.includes(';') || inner.includes('\t'))) {
      return inner.replace(/""/g, '"');
    }
  }
  return trimmed;
};

// Clean Excel cell text wrapper such as ="8992688001017" or '8992688001017
export const cleanCellValue = (val: string): string => {
  let s = (val || '').trim();
  if (s.startsWith('="') && s.endsWith('"')) {
    s = s.slice(2, -1);
  }
  s = s.replace(/^"+|"+$/g, '').trim();
  return s;
};

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

export const detectPrimaryDelimiter = (lines: string[]): string => {
  let tabScore = 0;
  let semiScore = 0;
  let commaScore = 0;

  const sampleLines = lines.slice(0, Math.min(12, lines.length));
  for (const rawLine of sampleLines) {
    const line = unwrapFullLineQuotes(rawLine);
    tabScore += countUnquotedChar(line, '\t');
    semiScore += countUnquotedChar(line, ';');
    commaScore += countUnquotedChar(line, ',');
  }

  if (tabScore > 0 && tabScore >= semiScore && tabScore >= commaScore) return '\t';
  if (semiScore > 0 && semiScore >= commaScore) return ';';
  return ',';
};

export const parseCsvLine = (rawLine: string, forcedDelim?: string): string[] => {
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

  if (delim !== ';' && result.length <= 2 && (result[0]?.split(';').length ?? 0) >= 3) {
    return parseCsvLine(line, ';');
  }

  return result;
};

// Split raw CSV/TSV text into logical rows, preserving quoted multiline cells when unclosed quotes span lines
const splitLogicalCsvRows = (raw: string): string[] => {
  const physicalLines = raw.split(/\r?\n/);
  const rows: string[] = [];
  let buffer = '';
  let openQuotes = false;

  for (const physLine of physicalLines) {
    if (!openQuotes) {
      buffer = physLine;
    } else {
      buffer += ' ' + physLine;
    }

    for (let i = 0; i < physLine.length; i++) {
      if (physLine[i] === '"') {
        if (physLine[i + 1] === '"') {
          i++;
        } else {
          openQuotes = !openQuotes;
        }
      }
    }

    if (!openQuotes) {
      const trimmed = buffer.trim();
      if (trimmed.length > 0) rows.push(trimmed);
      buffer = '';
    }
  }

  if (buffer.trim().length > 0) {
    rows.push(buffer.trim());
  }

  return rows;
};

// Parse currency/number strings across Indonesian, US, Dynamics 365, and Excel formats
export const parseFlexiblePrice = (val?: string): ParsedNumberResult => {
  if (val === undefined || val === null) {
    return { value: 0, isValid: true, isNegative: false, hasValue: false };
  }

  let raw = val
    .trim()
    .replace(/^=+/, '')
    .replace(/^['"]+|['"]+$/g, '')
    .replace(/[\s\u00A0]+/g, '');

  if (!raw || raw === '-' || raw.toLowerCase() === 'null' || raw.toLowerCase() === 'nan') {
    return { value: 0, isValid: true, isNegative: false, hasValue: false };
  }

  // Handle accounting parentheses like (12.500)
  let isAccountingNegative = false;
  if (raw.startsWith('(') && raw.endsWith(')')) {
    isAccountingNegative = true;
    raw = raw.slice(1, -1);
  }

  // Strip currency markers and trailing IDR ",-" suffix
  let clean = raw
    .replace(/(?:rp\.?|idr|\$|€)/gi, '')
    .replace(/,-$/g, '')
    .replace(/^[^\d\-+.,]+/, '');

  if (!clean || clean === '-') {
    return { value: 0, isValid: false, isNegative: false, hasValue: true };
  }

  // Check scientific notation first e.g. 1.5E+4 or 1,5e+4
  if (/^[+-]?[0-9]+([.,][0-9]+)?e[+-]?[0-9]+$/i.test(clean)) {
    const sci = Number(clean.replace(',', '.'));
    if (isNaN(sci) || !isFinite(sci)) {
      return { value: 0, isValid: false, isNegative: false, hasValue: true };
    }
    const isNegative = isAccountingNegative || sci < 0;
    return {
      value: isNegative ? 0 : Math.round(sci),
      isValid: true,
      isNegative,
      hasValue: true,
    };
  }

  // Reject alphabetic garbage remaining in price cell
  if (/[a-zA-Z]/.test(clean)) {
    return { value: 0, isValid: false, isNegative: false, hasValue: true };
  }

  const isNegative = isAccountingNegative || clean.startsWith('-');
  clean = clean.replace(/^[+-]+/, '');

  if (clean.includes('.') && clean.includes(',')) {
    if (clean.lastIndexOf(',') > clean.lastIndexOf('.')) {
      clean = clean.replace(/\./g, '').replace(',', '.');
    } else {
      clean = clean.replace(/,/g, '');
    }
  } else if (clean.includes('.') && clean.indexOf('.') !== clean.lastIndexOf('.')) {
    clean = clean.replace(/\./g, '');
  } else if (clean.includes(',') && clean.indexOf(',') !== clean.lastIndexOf(',')) {
    clean = clean.replace(/,/g, '');
  } else if (clean.includes('.')) {
    const parts = clean.split('.');
    if (parts[1] && parts[1].length === 3 && parts[0].length <= 3) {
      clean = clean.replace(/\./g, '');
    }
  } else if (clean.includes(',')) {
    const parts = clean.split(',');
    if (parts[1] && parts[1].length === 3 && parseInt(parts[0], 10) > 0 && parts[0].length <= 3) {
      clean = clean.replace(/,/g, '');
    } else {
      clean = clean.replace(',', '.');
    }
  }

  const num = parseFloat(clean);
  if (isNaN(num) || !isFinite(num)) {
    return { value: 0, isValid: false, isNegative: false, hasValue: true };
  }
  if (isNegative || num < 0) {
    return { value: 0, isValid: true, isNegative: true, hasValue: true };
  }

  return { value: Math.round(num), isValid: true, isNegative: false, hasValue: true };
};

// Parse stock safely (handles Indonesian comma decimals like "44,658", negative "-600,000", "1.250,50", "1,250.00")
export const parseFlexibleStock = (val?: string, defaultStock: number = 0): ParsedNumberResult => {
  if (val === undefined || val === null) {
    return { value: defaultStock, isValid: true, isNegative: false, hasValue: false };
  }

  let clean = val
    .trim()
    .replace(/^=+/, '')
    .replace(/^['"]+|['"]+$/g, '')
    .replace(/[\s\u00A0]+/g, '');

  if (clean === '' || clean === '-' || clean.toLowerCase() === 'null' || clean.toLowerCase() === 'nan') {
    return { value: defaultStock, isValid: true, isNegative: false, hasValue: false };
  }

  if (clean.startsWith('(') && clean.endsWith(')')) {
    clean = '-' + clean.slice(1, -1);
  }

  if (/^[+-]?[0-9]+([.,][0-9]+)?e[+-]?[0-9]+$/i.test(clean)) {
    const sci = Number(clean.replace(',', '.'));
    if (isNaN(sci) || !isFinite(sci)) {
      return { value: defaultStock, isValid: false, isNegative: false, hasValue: true };
    }
    const isNegative = sci < 0;
    return {
      value: isNegative ? 0 : Math.round(sci),
      isValid: true,
      isNegative,
      hasValue: true,
    };
  }

  if (/[a-zA-Z]/.test(clean)) {
    return { value: defaultStock, isValid: false, isNegative: false, hasValue: true };
  }

  const isNegative = clean.startsWith('-');

  if (clean.includes(',') && clean.includes('.')) {
    if (clean.lastIndexOf(',') > clean.lastIndexOf('.')) {
      clean = clean.replace(/\./g, '').replace(',', '.');
    } else {
      clean = clean.replace(/,/g, '');
    }
  } else if (clean.includes('.') && clean.indexOf('.') !== clean.lastIndexOf('.')) {
    clean = clean.replace(/\./g, '');
  } else if (clean.includes(',') && clean.indexOf(',') !== clean.lastIndexOf(',')) {
    clean = clean.replace(/,/g, '');
  } else if (clean.includes(',') && !clean.includes('.')) {
    clean = clean.replace(',', '.');
  }

  const num = parseFloat(clean);
  if (isNaN(num) || !isFinite(num)) {
    return { value: defaultStock, isValid: false, isNegative: false, hasValue: true };
  }

  if (isNegative || num < 0) {
    return { value: 0, isValid: true, isNegative: true, hasValue: true };
  }

  return { value: Math.round(num), isValid: true, isNegative: false, hasValue: true };
};

export const parsePositivePackQty = (val?: string): number | undefined => {
  const parsed = parseFlexibleStock(val, 0);
  if (!parsed.hasValue || !parsed.isValid || parsed.value <= 0) return undefined;
  return parsed.value;
};

export const parseBlockedFlag = (val?: string): boolean => {
  if (!val) return false;
  const clean = val.trim().replace(/^['"]+|['"]+$/g, '').toLowerCase();
  if (!clean) return false;
  return !['0', 'false', 'no', 'n', 'none', 'tidak', 'aktif', 'active', '-'].includes(clean);
};

// Normalize Dynamics 365 dates (YYYY-MM-DD, DD/MM/YYYY, MM/DD/YYYY, timestamps, Excel serial dates) -> DD/MM/YYYY
export const parseDynamicsDate = (val?: string): string | undefined => {
  if (!val) return undefined;
  const clean = val.trim().replace(/^['"]+|['"]+$/g, '');
  if (!clean || clean === '-' || clean === '0') return undefined;

  // Excel serial date number (approx years 1970-2099)
  if (/^[0-9]{5}(\.[0-9]+)?$/.test(clean)) {
    const serial = parseFloat(clean);
    if (serial > 25569 && serial < 73050) {
      const utcMs = Math.round((serial - 25569) * 86400 * 1000);
      const d = new Date(utcMs);
      if (!isNaN(d.getTime())) {
        const dd = String(d.getUTCDate()).padStart(2, '0');
        const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
        const yyyy = d.getUTCFullYear();
        return `${dd}/${mm}/${yyyy}`;
      }
    }
  }

  // ISO format YYYY-MM-DD or YYYY/MM/DD (with optional time)
  const isoMatch = clean.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (isoMatch) {
    const yyyy = isoMatch[1];
    const mm = isoMatch[2].padStart(2, '0');
    const dd = isoMatch[3].padStart(2, '0');
    return `${dd}/${mm}/${yyyy}`;
  }

  // Slash or dash D/M/Y or M/D/Y (with optional time)
  const dmyMatch = clean.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
  if (dmyMatch) {
    const p1 = parseInt(dmyMatch[1], 10);
    const p2 = parseInt(dmyMatch[2], 10);
    const yr = dmyMatch[3].length === 2 ? `20${dmyMatch[3]}` : dmyMatch[3];
    // If second segment > 12, source is MM/DD/YYYY (US Dynamics default)
    if (p2 > 12 && p1 <= 12) {
      return `${String(p2).padStart(2, '0')}/${String(p1).padStart(2, '0')}/${yr}`;
    }
    return `${String(p1).padStart(2, '0')}/${String(p2).padStart(2, '0')}/${yr}`;
  }

  // Month name format e.g. "13-Nov-2026" or "13 Nov 26"
  const monthNames: Record<string, string> = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', mei: '05',
    jun: '06', jul: '07', aug: '08', ags: '08', agu: '08', sep: '09',
    oct: '10', okt: '10', nov: '11', dec: '12', des: '12',
  };
  const namedMatch = clean.match(/^(\d{1,2})[\s-/]([a-zA-Z]{3})[\s-/](\d{2,4})/);
  if (namedMatch) {
    const mon = monthNames[namedMatch[2].toLowerCase()];
    if (mon) {
      const dd = namedMatch[1].padStart(2, '0');
      const yr = namedMatch[3].length === 2 ? `20${namedMatch[3]}` : namedMatch[3];
      return `${dd}/${mon}/${yr}`;
    }
  }

  return undefined;
};

// Priority-ordered exact + safe fallback header resolver so Dynamics 365 & standard columns never collide
export const resolveImportColumnMap = (
  firstRow: string[],
  detectedDelimiter: string
): ResolvedColumnMap => {
  const normalized = firstRow.map(normalizeHeader);
  const compacted = normalized.map(compactHeader);

  const exactMatch = (aliases: string[]): number => {
    const compactAliases = new Set(aliases.map((a) => a.replace(/[^a-z0-9]/g, '')));
    for (let i = 0; i < compacted.length; i++) {
      if (compactAliases.has(compacted[i])) return i;
    }
    return -1;
  };

  // Dynamics 365 & standard explicit matches
  let skuIdx = exactMatch([
    'itemcode',
    'itemno',
    'itemnumber',
    'sku',
    'plu',
    'kodebarang',
    'kodeitem',
    'no',
  ]);
  let barcodeIdx = exactMatch([
    'barcode0',
    'barcode',
    'ean',
    'ean13',
    'upc',
    'gtin',
    'kodebarcode',
    'barcodeno',
  ]);
  let nameIdx = exactMatch([
    'description',
    'itemname',
    'namabarang',
    'namaitem',
    'namaproduk',
    'productname',
    'deskripsi',
    'nama',
    'description2',
  ]);
  let stockIdx = exactMatch([
    'invonhand',
    'inventoryonhand',
    'inventory',
    'stock',
    'stok',
    'qtyonhand',
    'onhand',
    'qty',
    'quantity',
    'jumlah',
    'saldostok',
  ]);

  const hargaJual0Idx = exactMatch(['hargajual0', 'harga0']);
  const hargaJual1Idx = exactMatch(['hargajual1', 'harga1']);
  const hargaJual2Idx = exactMatch(['hargajual2', 'harga2']);
  const unitCostIdx = exactMatch(['unitcost', 'lastdirectcost', 'cost']);

  let priceIdx = exactMatch([
    'price',
    'unitprice',
    'unitpricelcy',
    'salesprice',
    'sellingprice',
    'harga',
    'hargasatuan',
    'hargajual',
    'hargajualpcs',
    'hrgjual',
    'retailprice',
    'rp',
  ]);
  let bulkPriceIdx = exactMatch([
    'bulkprice',
    'hargagrosir',
    'hargacrt',
    'hargakarton',
    'hargadus',
  ]);

  let categoryIdx = exactMatch([
    'categorycode',
    'itemcategorycode',
    'itemcategory',
    'category',
    'kategori',
    'kategoribarang',
  ]);
  const subCategoryIdx = exactMatch([
    'subkategoricode',
    'subcategorycode',
    'subkategori',
    'subcategory',
  ]);
  const departmentIdx = exactMatch(['departmentcode', 'department', 'deptcode', 'dept', 'departemen']);

  const blockedIdx = exactMatch(['blocked', 'isblocked', 'statusblocked']);
  const satuanKecilIdx = exactMatch([
    'satuankecil',
    'unitofmeasure',
    'unitofmeasurecode',
    'baseunitofmeasure',
    'uom',
    'unitlabel',
  ]);
  const satuanSedangIdx = exactMatch(['satuansedang']);
  const satuanBesarIdx = exactMatch(['satuanbesar', 'bulklabel']);
  const salesUomIdx = exactMatch(['salesunitofmeasure', 'salesuom']);
  const isiSedangIdx = exactMatch(['isikemasansedang']);
  const isiBesarIdx = exactMatch(['isikemasanbesar']);
  const vendorIdx = exactMatch(['vendorno', 'vendor', 'supplier', 'brand', 'merk']);
  const lastModifiedIdx = exactMatch(['lastdatemodified', 'modifieddate', 'dateeffective', 'lastmodified']);

  // Safe fuzzy fallback only for slots still unassigned (preventing cross-column collisions)
  normalized.forEach((col, idx) => {
    const comp = compacted[idx];
    if (!comp) return;

    if (
      skuIdx < 0 &&
      (comp.includes('sku') || comp.includes('plu') || col === 'item code' || col.startsWith('item no'))
    ) {
      skuIdx = idx;
      return;
    }

    if (
      barcodeIdx < 0 &&
      (comp.includes('barcode') || comp.includes('ean') || comp.includes('upc') || comp.includes('gtin')) &&
      !comp.includes('type')
    ) {
      barcodeIdx = idx;
      return;
    }

    if (
      nameIdx < 0 &&
      (comp.includes('description') ||
        comp.includes('itemname') ||
        col.includes('nama') ||
        col.includes('deskripsi') ||
        (col.includes('product') && !col.includes('posting') && !col.includes('group'))) &&
      !comp.includes('itemcode')
    ) {
      nameIdx = idx;
      return;
    }

    if (
      stockIdx < 0 &&
      (comp.includes('invonhand') ||
        ((col.includes('stock') || col.includes('stok') || col.includes('qty') || col.includes('jumlah')) &&
          !comp.includes('stockkeeping') &&
          !comp.includes('exists') &&
          !comp.includes('posting')))
    ) {
      stockIdx = idx;
      return;
    }

    if (
      categoryIdx < 0 &&
      (col.includes('category') || col.includes('kategori')) &&
      !col.includes('sub')
    ) {
      categoryIdx = idx;
      return;
    }

    if (
      priceIdx < 0 &&
      (col.includes('harga') || col.includes('price')) &&
      !col.includes('cost') &&
      !col.includes('margin') &&
      !col.includes('bulk') &&
      !col.includes('crt') &&
      !col.includes('karton') &&
      !comp.includes('hargajual1') &&
      !comp.includes('hargajual2')
    ) {
      priceIdx = idx;
      return;
    }

    if (
      bulkPriceIdx < 0 &&
      (col.includes('bulk') || col.includes('crt') || col.includes('karton') || col.includes('grosir'))
    ) {
      bulkPriceIdx = idx;
    }
  });

  const recognizedCount = [
    skuIdx,
    nameIdx,
    barcodeIdx,
    priceIdx,
    hargaJual0Idx,
    hargaJual1Idx,
    hargaJual2Idx,
    stockIdx,
    categoryIdx,
    departmentIdx,
    blockedIdx,
  ].filter((i) => i >= 0).length;

  const isHeader = recognizedCount >= 2 || nameIdx >= 0 || hargaJual0Idx >= 0 || skuIdx >= 0;

  const isDynamicsFormat =
    isHeader &&
    (hargaJual0Idx >= 0 ||
      blockedIdx >= 0 ||
      satuanKecilIdx >= 0 ||
      lastModifiedIdx >= 0 ||
      (skuIdx >= 0 && nameIdx >= 0 && (stockIdx >= 0 || barcodeIdx >= 0) && compacted.includes('invonhand')));

  if (!isHeader) {
    // Check headerless formats cleanly
    if (
      firstRow.length >= 4 &&
      /^[0-9]{4,8}$/.test((firstRow[0] || '').trim()) &&
      /[a-zA-Z]{2,}/.test((firstRow[1] || '').trim())
    ) {
      skuIdx = 0;
      nameIdx = 1;
      barcodeIdx = 2;
      priceIdx = 3;
      categoryIdx = 4;
      stockIdx = 5;
    } else {
      nameIdx = 0;
      barcodeIdx = 1;
      priceIdx = 2;
      skuIdx = 3;
      categoryIdx = 4;
      stockIdx = 5;
    }
  }

  // Fallback price column if Dynamics only has Harga Jual 0/1/2
  if (priceIdx < 0) {
    if (hargaJual0Idx >= 0) priceIdx = hargaJual0Idx;
    else if (hargaJual1Idx >= 0) priceIdx = hargaJual1Idx;
    else if (hargaJual2Idx >= 0) priceIdx = hargaJual2Idx;
  }

  const matchedLabels: { sourceHeader: string; targetField: string }[] = [];
  if (isHeader) {
    const pushMap = (idx: number, targetField: string) => {
      if (idx >= 0 && firstRow[idx]) {
        matchedLabels.push({ sourceHeader: firstRow[idx].trim(), targetField });
      }
    };
    pushMap(skuIdx, 'SKU');
    pushMap(nameIdx, 'Item Name');
    pushMap(barcodeIdx, 'Barcode');
    if (hargaJual0Idx >= 0 || hargaJual1Idx >= 0 || hargaJual2Idx >= 0) {
      const tiers = [
        hargaJual0Idx >= 0 ? firstRow[hargaJual0Idx].trim() : null,
        hargaJual1Idx >= 0 ? firstRow[hargaJual1Idx].trim() : null,
        hargaJual2Idx >= 0 ? firstRow[hargaJual2Idx].trim() : null,
      ]
        .filter(Boolean)
        .join(' / ');
      matchedLabels.push({ sourceHeader: tiers, targetField: 'Price' });
    } else {
      pushMap(priceIdx, 'Price');
    }
    pushMap(stockIdx, 'Stock');
    pushMap(categoryIdx >= 0 ? categoryIdx : departmentIdx, 'Category');
    pushMap(vendorIdx, 'Brand / Supplier');
    pushMap(lastModifiedIdx, 'Date Effective');
  }

  return {
    isHeader,
    isDynamicsFormat,
    detectedDelimiter,
    skuIdx,
    nameIdx,
    barcodeIdx,
    priceIdx,
    bulkPriceIdx,
    hargaJual0Idx,
    hargaJual1Idx,
    hargaJual2Idx,
    unitCostIdx,
    categoryIdx,
    subCategoryIdx,
    departmentIdx,
    stockIdx,
    blockedIdx,
    satuanKecilIdx,
    satuanSedangIdx,
    satuanBesarIdx,
    salesUomIdx,
    isiSedangIdx,
    isiBesarIdx,
    vendorIdx,
    lastModifiedIdx,
    matchedLabels,
  };
};

export const parseAndValidateImportText = (
  rawText: string,
  options: ImportParseOptions
): ImportParseResult => {
  const emptyColMap: ResolvedColumnMap = {
    isHeader: false,
    isDynamicsFormat: false,
    detectedDelimiter: ',',
    skuIdx: 0,
    nameIdx: 1,
    barcodeIdx: 2,
    priceIdx: 3,
    bulkPriceIdx: -1,
    hargaJual0Idx: -1,
    hargaJual1Idx: -1,
    hargaJual2Idx: -1,
    unitCostIdx: -1,
    categoryIdx: 4,
    subCategoryIdx: -1,
    departmentIdx: -1,
    stockIdx: 5,
    blockedIdx: -1,
    satuanKecilIdx: -1,
    satuanSedangIdx: -1,
    satuanBesarIdx: -1,
    salesUomIdx: -1,
    isiSedangIdx: -1,
    isiBesarIdx: -1,
    vendorIdx: -1,
    lastModifiedIdx: -1,
    matchedLabels: [],
  };

  const emptyStats: ImportValidationStats = {
    totalDataRows: 0,
    validCount: 0,
    isDynamicsFormat: false,
    detectedDelimiter: ',',
    skippedMissingName: 0,
    skippedBlocked: 0,
    blockedFound: 0,
    duplicatesMerged: 0,
    zeroPriceCount: 0,
    invalidPriceCells: 0,
    negativeStockClamped: 0,
    repairedBarcodes: 0,
    duplicateSamples: [],
    skippedSamples: [],
  };

  if (!rawText || !rawText.trim()) {
    return { records: [], columnMap: emptyColMap, stats: emptyStats, warnings: [] };
  }

  const cleanRaw = rawText.replace(/^\uFEFF/, '');
  let lines = splitLogicalCsvRows(cleanRaw);
  if (lines.length === 0) {
    return { records: [], columnMap: emptyColMap, stats: emptyStats, warnings: [] };
  }

  let forcedDelim: string | undefined;
  if (/^sep=.$/i.test(lines[0])) {
    forcedDelim = lines[0].slice(4, 5);
    lines = lines.slice(1);
  }
  if (lines.length === 0) {
    return { records: [], columnMap: emptyColMap, stats: emptyStats, warnings: [] };
  }

  const primaryDelim = forcedDelim || detectPrimaryDelimiter(lines);

  // Scan up to the first 15 non-empty lines to find the strongest header row
  // (handles Dynamics 365 / Excel exports that place a title banner or blank/filter row above column headers)
  let headerRowIdx = 0;
  let colMap = resolveImportColumnMap(parseCsvLine(lines[0], primaryDelim), primaryDelim);
  let bestScore = colMap.isHeader ? colMap.matchedLabels.length : 0;

  const scanLimit = Math.min(15, lines.length);
  for (let i = 1; i < scanLimit; i++) {
    const candidateRow = parseCsvLine(lines[i], primaryDelim);
    if (candidateRow.length < 2) continue;
    const candidateMap = resolveImportColumnMap(candidateRow, primaryDelim);
    const candidateScore = candidateMap.isHeader ? candidateMap.matchedLabels.length : 0;
    if (candidateMap.isHeader && candidateScore > bestScore && candidateScore >= 2) {
      bestScore = candidateScore;
      headerRowIdx = i;
      colMap = candidateMap;
    }
  }

  const dataLines = colMap.isHeader ? lines.slice(headerRowIdx + 1) : lines;

  const priceTier = options.priceTier || 'auto';
  const skipBlocked = options.skipBlocked ?? true;
  const existingLookup = options.existingLookup;

  const dedupedRecords: ImportProductRecord[] = [];
  const keyToRecordIdx = new Map<string, number>();

  let skippedMissingName = 0;
  let skippedBlocked = 0;
  let blockedFound = 0;
  let duplicatesMerged = 0;
  let invalidPriceCells = 0;
  let negativeStockClamped = 0;
  let repairedBarcodes = 0;
  const duplicateSamples: string[] = [];
  const skippedSamples: string[] = [];

  const getCol = (cols: string[], idx: number): string =>
    idx >= 0 && idx < cols.length ? (cols[idx] || '').trim() : '';

  dataLines.forEach((line, rowIdx) => {
    let cols = parseCsvLine(line, primaryDelim);
    if (cols.length === 0 || !cols.some((c) => c.length > 0)) return;

    if (colMap.nameIdx >= 0 && (cols[colMap.nameIdx]?.split(';').length ?? 0) >= 3) {
      const reconstructed = cols.join(',');
      cols = parseCsvLine(reconstructed, ';');
    }

    let rawName = getCol(cols, colMap.nameIdx);
    let rawBarcode = getCol(cols, colMap.barcodeIdx);
    let rawPrice = getCol(cols, colMap.priceIdx);
    let rawSku = getCol(cols, colMap.skuIdx) || undefined;
    let rawCategory = getCol(cols, colMap.categoryIdx) || undefined;
    const rawSubCategory = getCol(cols, colMap.subCategoryIdx) || undefined;
    const rawDept = getCol(cols, colMap.departmentIdx) || undefined;
    let rawStock = colMap.stockIdx >= 0 ? getCol(cols, colMap.stockIdx) : undefined;

    // Fallback recovery for legacy semicolon strings packed inside name cell
    if (!colMap.isDynamicsFormat && rawName.includes(';')) {
      const semiParts = rawName.split(';').map((s) => s.trim());
      rawName = semiParts[0] || '';
      if (semiParts[1] && !rawBarcode) rawBarcode = semiParts[1];
      if (semiParts[2] && !rawPrice) rawPrice = semiParts[2];
      if (semiParts[3] && !rawSku) rawSku = semiParts[3];
      if (semiParts[4] && !rawCategory) rawCategory = semiParts[4];
      if (semiParts[5] !== undefined && !rawStock) rawStock = semiParts[5];
    }

    const cleanRawSku = rawSku ? rawSku.replace(/^['"]+|['"]+$/g, '').trim() : undefined;
    // Normalize float suffix ".0" produced by Excel numeric cells for integer SKUs (e.g. "1000001.0" -> "1000001")
    const sku =
      cleanRawSku && /^[0-9]+\.0+$/.test(cleanRawSku)
        ? cleanRawSku.replace(/\.0+$/, '')
        : cleanRawSku;
    let name = rawName
      .replace(/^['";]+|['";]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toUpperCase();

    if (!name && sku) {
      name = `ITEM SKU ${sku}`;
    }

    if (!name) {
      skippedMissingName++;
      if (skippedSamples.length < 5) {
        skippedSamples.push(`Row ${rowIdx + (colMap.isHeader ? 2 : 1)}: missing Item Name & SKU`);
      }
      return;
    }

    const blockedRaw = getCol(cols, colMap.blockedIdx);
    const isBlocked = parseBlockedFlag(blockedRaw);
    if (isBlocked) {
      blockedFound++;
      if (skipBlocked) {
        skippedBlocked++;
        if (skippedSamples.length < 5) {
          skippedSamples.push(`Row ${rowIdx + (colMap.isHeader ? 2 : 1)}: "${name}" skipped (Blocked=${blockedRaw})`);
        }
        return;
      }
    }

    // Resolve price across Dynamics 365 Harga Jual 0 / 1 / 2 or standard Price column
    const parsed0 = parseFlexiblePrice(colMap.hargaJual0Idx >= 0 ? getCol(cols, colMap.hargaJual0Idx) : rawPrice);
    const parsed1 = colMap.hargaJual1Idx >= 0 ? parseFlexiblePrice(getCol(cols, colMap.hargaJual1Idx)) : undefined;
    const parsed2 = colMap.hargaJual2Idx >= 0 ? parseFlexiblePrice(getCol(cols, colMap.hargaJual2Idx)) : undefined;
    const genericParsed = parseFlexiblePrice(rawPrice);

    let price = genericParsed.value;
    let chosenPriceValid = genericParsed.isValid;
    let priceProvided = genericParsed.hasValue;

    if (colMap.hargaJual0Idx >= 0 || colMap.hargaJual1Idx >= 0 || colMap.hargaJual2Idx >= 0) {
      if (priceTier === 'harga_jual_1' && parsed1) {
        price = parsed1.value;
        chosenPriceValid = parsed1.isValid;
        priceProvided = parsed1.hasValue;
      } else if (priceTier === 'harga_jual_2' && parsed2) {
        price = parsed2.value;
        chosenPriceValid = parsed2.isValid;
        priceProvided = parsed2.hasValue;
      } else if (priceTier === 'harga_jual_0') {
        price = parsed0.value;
        chosenPriceValid = parsed0.isValid;
        priceProvided = parsed0.hasValue;
      } else {
        // 'auto': prefer Harga Jual 0 (retail PCS), gracefully fall back to Harga Jual 1 / 2 when 0 is unset
        if (parsed0.value > 0) {
          price = parsed0.value;
          chosenPriceValid = parsed0.isValid;
          priceProvided = parsed0.hasValue;
        } else if (parsed1 && parsed1.value > 0) {
          price = parsed1.value;
          chosenPriceValid = parsed1.isValid;
          priceProvided = parsed1.hasValue;
        } else if (parsed2 && parsed2.value > 0) {
          price = parsed2.value;
          chosenPriceValid = parsed2.isValid;
          priceProvided = parsed2.hasValue;
        } else {
          price = parsed0.value;
          chosenPriceValid = parsed0.isValid;
          priceProvided = Boolean(parsed0.hasValue || parsed1?.hasValue || parsed2?.hasValue);
        }
      }
    }

    if (!chosenPriceValid) {
      invalidPriceCells++;
    }

    // Resolve Bulk Price: explicit Bulk column first, otherwise highest higher Dynamics selling tier (> retail price)
    let bulkPrice: number | undefined;
    if (colMap.bulkPriceIdx >= 0) {
      const bp = parseFlexiblePrice(getCol(cols, colMap.bulkPriceIdx));
      if (bp.value > 0) bulkPrice = bp.value;
    } else if (colMap.hargaJual2Idx >= 0 || colMap.hargaJual1Idx >= 0) {
      const tier2Val = parsed2?.value ?? 0;
      const tier1Val = parsed1?.value ?? 0;
      if (tier2Val > price) bulkPrice = tier2Val;
      else if (tier1Val > price) bulkPrice = tier1Val;
    }

    const stockParsed = parseFlexibleStock(rawStock, colMap.isDynamicsFormat ? 0 : 50);
    if (stockParsed.isNegative) {
      negativeStockClamped++;
    }
    const stock = stockParsed.value;

    const categorySource = rawCategory || rawDept || rawSubCategory;
    const category = options.normalizeCategory(categorySource);
    const deptParts = [rawDept, rawSubCategory].filter((v): v is string => Boolean(v && v.trim()));
    const department =
      deptParts.length > 0 ? deptParts.join(' / ').toUpperCase() : `${category} / General`;

    const existingMatch =
      (sku && existingLookup ? existingLookup.skuMap.get(sku.toLowerCase()) : undefined) ||
      (existingLookup ? existingLookup.nameMap.get(name.toLowerCase()) : undefined);

    const cleanedInputBc = rawBarcode
      .replace(/^=+/, '')
      .replace(/^['"]+|['"]+$/g, '')
      .replace(/\s+/g, '');

    const isInputCorruptedOrEmpty =
      !cleanedInputBc ||
      cleanedInputBc === '-' ||
      /^0+$/.test(cleanedInputBc) ||
      cleanedInputBc.length < 5 ||
      /[a-df-zA-DF-Z]/.test(cleanedInputBc) ||
      /e\+/i.test(cleanedInputBc) ||
      (/^[0-9]{11,14}$/.test(cleanedInputBc) && /0{6,}$/.test(cleanedInputBc));

    let finalBarcode = '';
    if (isInputCorruptedOrEmpty) {
      repairedBarcodes++;
      if (existingMatch && existingMatch.barcode.length >= 8) {
        finalBarcode = existingMatch.barcode;
      } else {
        finalBarcode = options.sanitizeBarcode(rawBarcode, sku || name);
      }
    } else {
      finalBarcode = options.sanitizeBarcode(rawBarcode, sku || name);
    }

    const unitLabelRaw = getCol(cols, colMap.satuanKecilIdx) || getCol(cols, colMap.salesUomIdx);
    const bulkLabelRaw = getCol(cols, colMap.satuanBesarIdx) || getCol(cols, colMap.satuanSedangIdx);
    const bulkQuantity =
      parsePositivePackQty(getCol(cols, colMap.isiBesarIdx)) ??
      parsePositivePackQty(getCol(cols, colMap.isiSedangIdx));
    const vendorNo = getCol(cols, colMap.vendorIdx) || undefined;
    const dateEffective = parseDynamicsDate(getCol(cols, colMap.lastModifiedIdx));
    const unitCostParsed =
      colMap.unitCostIdx >= 0 ? parseFlexiblePrice(getCol(cols, colMap.unitCostIdx)) : undefined;

    const candidate: ImportProductRecord = {
      name,
      barcode: finalBarcode,
      price,
      priceProvided,
      sku,
      category,
      department,
      brand: vendorNo,
      supplier: vendorNo,
      unitLabel: unitLabelRaw ? unitLabelRaw.toUpperCase() : undefined,
      bulkLabel: bulkLabelRaw ? bulkLabelRaw.toUpperCase() : undefined,
      bulkQuantity,
      bulkPrice,
      stock,
      dateEffective,
      blocked: isBlocked || undefined,
      unitCost: unitCostParsed && unitCostParsed.value > 0 ? unitCostParsed.value : undefined,
      priceTier0: parsed0.hasValue ? parsed0.value : undefined,
      priceTier1: parsed1?.hasValue ? parsed1.value : undefined,
      priceTier2: parsed2?.hasValue ? parsed2.value : undefined,
    };

    // Deduplicate within the imported file so batch upserts never encounter duplicate keys
    const dedupeKey = sku
      ? `sku:${sku.toLowerCase()}`
      : !isInputCorruptedOrEmpty && finalBarcode
        ? `bc:${finalBarcode.toLowerCase()}`
        : `name:${name.toLowerCase()}`;

    const prevIdx = keyToRecordIdx.get(dedupeKey);
    if (prevIdx !== undefined) {
      const prev = dedupedRecords[prevIdx];
      duplicatesMerged++;
      if (duplicateSamples.length < 5) {
        duplicateSamples.push(sku ? `${sku} (${name.slice(0, 28)})` : name.slice(0, 36));
      }
      dedupedRecords[prevIdx] = {
        ...prev,
        ...candidate,
        price: candidate.priceProvided === false && prev.price > 0 ? prev.price : candidate.price,
        priceProvided: candidate.priceProvided || prev.priceProvided,
        // Preserve non-empty optional attributes if latest duplicate left them blank
        barcode:
          isInputCorruptedOrEmpty && prev.barcode && prev.barcode.length >= 8
            ? prev.barcode
            : candidate.barcode,
        category: candidate.category || prev.category,
        department: candidate.department || prev.department,
        brand: candidate.brand || prev.brand,
        supplier: candidate.supplier || prev.supplier,
        unitLabel: candidate.unitLabel || prev.unitLabel,
        bulkLabel: candidate.bulkLabel || prev.bulkLabel,
        bulkQuantity: candidate.bulkQuantity ?? prev.bulkQuantity,
        bulkPrice: candidate.bulkPrice ?? prev.bulkPrice,
        dateEffective: candidate.dateEffective || prev.dateEffective,
      };
    } else {
      keyToRecordIdx.set(dedupeKey, dedupedRecords.length);
      dedupedRecords.push(candidate);
    }
  });

  const zeroPriceCount = dedupedRecords.filter((r) => !r.price || r.price <= 0).length;

  const warnings: string[] = [];
  if (skippedBlocked > 0) {
    warnings.push(`${skippedBlocked} item berstatus Blocked di Dynamics 365 dilewati otomatis.`);
  }
  if (duplicatesMerged > 0) {
    warnings.push(
      `${duplicatesMerged} baris duplikat dalam file digabungkan (data terbaru dipertahankan) untuk mencegah konflik database.`
    );
  }
  if (skippedMissingName > 0) {
    warnings.push(`${skippedMissingName} baris kosong / tanpa Nama Item & SKU dilewati.`);
  }
  if (invalidPriceCells > 0) {
    warnings.push(`${invalidPriceCells} sel harga berisi karakter tidak valid (diatur aman ke Rp 0).`);
  }
  if (zeroPriceCount > 0) {
    warnings.push(`${zeroPriceCount} produk memiliki harga Rp 0 — periksa kembali kolom Harga Jual.`);
  }
  if (negativeStockClamped > 0) {
    warnings.push(`${negativeStockClamped} nilai stok negatif disesuaikan aman menjadi 0.`);
  }

  return {
    records: dedupedRecords,
    columnMap: colMap,
    stats: {
      totalDataRows: dataLines.length,
      validCount: dedupedRecords.length,
      isDynamicsFormat: colMap.isDynamicsFormat,
      detectedDelimiter: primaryDelim,
      skippedMissingName,
      skippedBlocked,
      blockedFound,
      duplicatesMerged,
      zeroPriceCount,
      invalidPriceCells,
      negativeStockClamped,
      repairedBarcodes,
      duplicateSamples,
      skippedSamples,
    },
    warnings,
  };
};
