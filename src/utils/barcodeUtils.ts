export type DetectedBarcodeType = 'EAN13' | 'UPCA' | 'EAN8' | 'CODE128';
export type JsBarcodeFormat = 'EAN13' | 'UPC' | 'EAN8' | 'CODE128';
export type TsplBarcodeType = 'EAN13' | 'UPCA' | 'EAN8' | '128';

/**
 * Compute GS1 Mod-10 check digit (rightmost data digit has weight 3, alternating 3 and 1).
 * Works identically for EAN-13 (12 data digits), UPC-A (11 data digits), and EAN-8 (7 data digits).
 */
export const computeGs1CheckDigit = (dataDigits: string): string => {
  let sum = 0;
  for (let i = 0; i < dataDigits.length; i++) {
    const posFromRight = dataDigits.length - 1 - i;
    const digit = parseInt(dataDigits[i], 10) || 0;
    sum += posFromRight % 2 === 0 ? digit * 3 : digit;
  }
  return String((10 - (sum % 10)) % 10);
};

export const isValidEan13 = (code: string): boolean =>
  /^[0-9]{13}$/.test(code) && computeGs1CheckDigit(code.slice(0, 12)) === code[12];

export const isValidUpcA = (code: string): boolean =>
  /^[0-9]{12}$/.test(code) && computeGs1CheckDigit(code.slice(0, 11)) === code[11];

export const isValidEan8 = (code: string): boolean =>
  /^[0-9]{8}$/.test(code) && computeGs1CheckDigit(code.slice(0, 7)) === code[7];

/**
 * Repair 12-digit UPC-A barcodes (e.g. 089686010046, 089686010015, 711844110717) that were
 * previously saved as 13 digits (0896860100468, 0896860100154) when the legacy sanitizer
 * appended an extra EAN-13 check digit onto a valid 12-digit UPC-A.
 */
export const repairLegacyCorruptedUpcBarcode = (code: string): string => {
  if (
    /^(?:0[1-9]|711844)[0-9]{7,11}$/.test(code) &&
    code.length === 13 &&
    !/000[0-9]$/.test(code) &&
    isValidEan13(code) &&
    isValidUpcA(code.slice(0, 12))
  ) {
    return code.slice(0, 12);
  }
  return code;
};

/**
 * Clean raw barcode string without altering actual digits or leading zeros,
 * while automatically repairing 12-digit UPC-A codes previously corrupted to 13 digits.
 */
export const cleanRawBarcodeString = (rawBarcode?: string): string => {
  if (!rawBarcode) return '';
  let clean = rawBarcode
    .replace(/[\u0000-\u001F\u007F\u200B-\u200D\uFEFF]/g, '')
    .trim()
    .replace(/^=+/, '')
    .replace(/^['"]+|['"]+$/g, '')
    .replace(/\s+/g, '');

  // Strip Excel/Python float suffix ".0" on integer barcodes (e.g. "8992772586023.0")
  if (/^[0-9]+\.0+$/.test(clean)) {
    clean = clean.replace(/\.0+$/, '');
  }
  return repairLegacyCorruptedUpcBarcode(clean);
};

/**
 * Returns true when the input contains an actual usable numeric barcode (>= 5 digits,
 * not all zeros, not scientific notation precision loss, and not descriptive text).
 */
export const hasActualBarcode = (rawBarcode?: string): boolean => {
  const clean = cleanRawBarcodeString(rawBarcode);
  if (!clean || clean === '-' || /^0+$/.test(clean) || /^(nan|null|none|n\/a)$/i.test(clean)) {
    return false;
  }
  if (/^[0-9]+([.,][0-9]+)?e[+-]?[0-9]+$/i.test(clean)) {
    return false;
  }
  if (/[^0-9]/.test(clean) || clean.length < 5) {
    return false;
  }
  return true;
};

/**
 * Generate a valid 13-digit EAN-13 barcode (deterministic when seeded by SKU/name).
 */
export const generateValidEan13 = (seed?: string): string => {
  let digits9 = '';
  if (seed && seed.trim().length > 0) {
    const cleanNum = seed.replace(/[^0-9]/g, '');
    if (cleanNum.length >= 4 && cleanNum.length <= 9) {
      digits9 = cleanNum.padStart(9, '0');
    } else {
      let hash = 2166136261;
      for (let i = 0; i < seed.length; i++) {
        hash ^= seed.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
      }
      digits9 = (Math.abs(hash) % 900000000 + 100000000).toString().slice(0, 9);
    }
  } else {
    digits9 = Math.floor(100000000 + Math.random() * 900000000).toString();
  }

  const raw12 = ('899' + digits9).slice(0, 12);
  return raw12 + computeGs1CheckDigit(raw12);
};

/**
 * Preserve valid numeric barcodes from the Excel item list verbatim (including 12-digit UPC-A
 * like "089686010015" and custom 13/14-digit codes), only generating a deterministic EAN-13
 * fallback when the source cell is empty, zero, text, or corrupted.
 */
export const sanitizeBarcodeValue = (rawBarcode?: string, fallbackSeed?: string): string => {
  if (hasActualBarcode(rawBarcode)) {
    return cleanRawBarcodeString(rawBarcode);
  }
  return generateValidEan13(fallbackSeed);
};

export const detectBarcodeType = (barcode: string): DetectedBarcodeType => {
  const clean = cleanRawBarcodeString(barcode);
  if (isValidEan13(clean)) return 'EAN13';
  if (isValidUpcA(clean)) return 'UPCA';
  if (isValidEan8(clean)) return 'EAN8';
  return 'CODE128';
};

export const resolveJsBarcodeFormat = (barcode: string): JsBarcodeFormat => {
  const detected = detectBarcodeType(barcode);
  return detected === 'UPCA' ? 'UPC' : detected;
};

export const resolveTsplBarcodeType = (barcode: string): TsplBarcodeType => {
  const detected = detectBarcodeType(barcode);
  return detected === 'CODE128' ? '128' : detected;
};

export const normalizeLooseSku = (sku: string): string => {
  const cleaned = sku.trim().toLowerCase();
  return /^[0-9]+$/.test(cleaned) ? cleaned.replace(/^0+(?=[0-9])/, '') : cleaned;
};

export const normalizeBarcodeLookup = (barcode: string): string => {
  const cleaned = cleanRawBarcodeString(barcode).toLowerCase();
  if (/^[0-9]{6,}$/.test(cleaned)) {
    return cleaned.replace(/^0+(?=[0-9])/, '');
  }
  return cleaned;
};
