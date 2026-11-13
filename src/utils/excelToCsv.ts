import { ImportProductRecord } from '../types';

export interface ExcelCsvConversionResult {
  csvText: string;
  sheetName: string;
  sheetCount: number;
  rowCount: number;
}

const escapeCsvCell = (val: string): string => {
  const s = (val ?? '').replace(/\r?\n/g, ' ');
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
};

const colLettersToIndex = (letters: string): number => {
  let idx = 0;
  for (let i = 0; i < letters.length; i++) {
    idx = idx * 26 + (letters.charCodeAt(i) - 64);
  }
  return Math.max(0, idx - 1);
};

const formatCellLossless = (cell: any, XLSX: any): string => {
  if (!cell || cell.t === 'z' || cell.t === 'e') return '';

  if (cell.t === 'b') {
    return cell.v ? 'TRUE' : 'FALSE';
  }

  if (cell.t === 'd' && cell.v instanceof Date && !isNaN(cell.v.getTime())) {
    const dd = String(cell.v.getUTCDate()).padStart(2, '0');
    const mm = String(cell.v.getUTCMonth() + 1).padStart(2, '0');
    const yyyy = cell.v.getUTCFullYear();
    return `${dd}/${mm}/${yyyy}`;
  }

  if (cell.t === 'n' && typeof cell.v === 'number') {
    // Check Excel date format codes (skipping generic numeric/currency strings)
    const fmt = cell.z ? String(cell.z) : '';
    if (
      fmt &&
      fmt !== 'General' &&
      !fmt.includes('#') &&
      typeof XLSX?.SSF?.is_date === 'function' &&
      typeof XLSX?.SSF?.parse_date_code === 'function' &&
      XLSX.SSF.is_date(fmt)
    ) {
      const parsed = XLSX.SSF.parse_date_code(cell.v);
      if (parsed && parsed.y >= 1900 && parsed.m >= 1 && parsed.d >= 1) {
        return `${String(parsed.d).padStart(2, '0')}/${String(parsed.m).padStart(2, '0')}/${parsed.y}`;
      }
    }

    if (!isFinite(cell.v)) return '';
    // Preserve full 13-digit EAN/barcode digits & exact prices/stocks instead of Excel narrow E+12 display text
    if (Math.abs(cell.v) < 1e20) {
      return String(cell.v);
    }
    return String(cell.w ?? cell.v);
  }

  const text = cell.v !== undefined && cell.v !== null ? String(cell.v) : String(cell.w ?? '');
  return text.replace(/\r?\n/g, ' ').trim();
};

const HEADER_SCORE_TOKENS = [
  'item code',
  'item no',
  'sku',
  'plu',
  'barcode',
  'description',
  'item name',
  'nama barang',
  'inv on hand',
  'inventory',
  'stock',
  'stok',
  'qty',
  'harga jual',
  'unit price',
  'price',
  'harga',
  'category',
  'kategori',
  'department',
  'vendor',
  'blocked',
  'satuan',
];

const scoreSheetRows = (rows: string[][]): number => {
  if (rows.length === 0) return -1;
  let bestHeaderScore = 0;
  const checkRows = rows.slice(0, Math.min(20, rows.length));

  for (const row of checkRows) {
    let rowScore = 0;
    const joined = row.map((c) => c.toLowerCase().trim()).join(' | ');
    for (const token of HEADER_SCORE_TOKENS) {
      if (joined.includes(token)) rowScore += 10;
    }
    if (rowScore > bestHeaderScore) bestHeaderScore = rowScore;
  }

  return bestHeaderScore * 1000 + rows.length;
};

const extractSparseSheetRows = (ws: any, XLSX: any): string[][] => {
  if (!ws || typeof ws !== 'object') return [];

  const rowMap = new Map<number, Map<number, string>>();
  let maxColInSheet = 0;

  for (const key of Object.keys(ws)) {
    if (key.startsWith('!')) continue;
    const match = /^([A-Z]+)(\d+)$/.exec(key);
    if (!match) continue;

    const colIdx = colLettersToIndex(match[1]);
    const rowNum = parseInt(match[2], 10);
    const val = formatCellLossless(ws[key], XLSX);
    if (val === '') continue;

    let colMap = rowMap.get(rowNum);
    if (!colMap) {
      colMap = new Map<number, string>();
      rowMap.set(rowNum, colMap);
    }
    colMap.set(colIdx, val);
    if (colIdx > maxColInSheet) maxColInSheet = colIdx;
  }

  if (rowMap.size === 0) return [];

  const sortedRowNums = Array.from(rowMap.keys()).sort((a, b) => a - b);
  const clampedMaxCol = Math.min(maxColInSheet, 120);
  const matrix: string[][] = [];

  for (const rNum of sortedRowNums) {
    const colMap = rowMap.get(rNum)!;
    let lastNonEmptyCol = 0;
    colMap.forEach((_, cIdx) => {
      if (cIdx <= clampedMaxCol && cIdx > lastNonEmptyCol) {
        lastNonEmptyCol = cIdx;
      }
    });

    const rowArr = new Array<string>(lastNonEmptyCol + 1).fill('');
    colMap.forEach((v, cIdx) => {
      if (cIdx <= lastNonEmptyCol) rowArr[cIdx] = v;
    });
    if (rowArr.some((v) => v.length > 0)) {
      matrix.push(rowArr);
    }
  }

  return matrix;
};

// Automatically convert any Excel workbook (.xlsx, .xlsm, .xls BIFF/XML, .xlsb, .ods) to clean RFC-4180 CSV text
export const convertExcelBufferToCsv = async (
  buffer: ArrayBuffer
): Promise<ExcelCsvConversionResult | null> => {
  try {
    const mod: any = await import('xlsx');
    const XLSX = mod?.read ? mod : mod?.default;
    if (!XLSX?.read) return null;

    const workbook = XLSX.read(new Uint8Array(buffer), {
      type: 'array',
      cellNF: true,
      cellText: false,
      cellDates: false,
    });

    if (!workbook || !Array.isArray(workbook.SheetNames) || workbook.SheetNames.length === 0) {
      return null;
    }

    let bestSheetName = '';
    let bestRows: string[][] = [];
    let bestScore = -1;

    for (const sheetName of workbook.SheetNames) {
      const ws = workbook.Sheets[sheetName];
      const rows = extractSparseSheetRows(ws, XLSX);
      const score = scoreSheetRows(rows);
      if (score > bestScore) {
        bestScore = score;
        bestSheetName = sheetName;
        bestRows = rows;
      }
    }

    if (bestRows.length === 0) return null;

    const csvText = bestRows.map((row) => row.map(escapeCsvCell).join(',')).join('\n');
    return {
      csvText,
      sheetName: bestSheetName,
      sheetCount: workbook.SheetNames.length,
      rowCount: bestRows.length,
    };
  } catch {
    return null;
  }
};

// Convert parsed catalog records into standard Amanmart CSV format (SKU,Item Name,Barcode,Price,Category,Stock)
export const toStandardAmanmartCsv = (records: ImportProductRecord[]): string => {
  const header = 'SKU,Item Name,Barcode,Price,Category,Stock';
  const lines = records.map((r) =>
    [
      escapeCsvCell(r.sku || ''),
      escapeCsvCell(r.name || ''),
      escapeCsvCell(r.barcode || ''),
      String(Math.max(0, Math.round(r.price || 0))),
      escapeCsvCell(r.category || 'Grocery'),
      String(Math.max(0, Math.round(r.stock ?? 0))),
    ].join(',')
  );
  return '\uFEFF' + [header, ...lines].join('\r\n');
};
