import { Product, ProductStock, StoreLocation, LabelTemplateConfig, User } from '../types';

export const INITIAL_STORES: StoreLocation[] = [
  {
    id: 'store-krg',
    code: 'KRG',
    name: 'KRANGGAN',
    city: 'Bekasi',
    address: 'Jl. Raya Kranggan No. 1, Kranggan',
    isPrimary: true,
  },
  {
    id: 'store-xml',
    code: 'XML',
    name: 'KALIMALANG',
    city: 'Jakarta Timur',
    address: 'Jl. Raya Kalimalang No. 12, Kalimalang',
  },
  {
    id: 'store-klp',
    code: 'KLP',
    name: 'PDK KELAPA',
    city: 'Jakarta Timur',
    address: 'Jl. Raya Pondok Kelapa No. 8',
  },
  {
    id: 'store-plt',
    code: 'PLT',
    name: 'PLUIT',
    city: 'Jakarta Utara',
    address: 'Jl. Pluit Selatan Raya No. 15, Pluit',
  },
  {
    id: 'store-mkr',
    code: 'MKR',
    name: 'MEKAR JAYA',
    city: 'Depok',
    address: 'Jl. Mekar Jaya Raya No. 22',
  },
  {
    id: 'store-cpm',
    code: 'CPM',
    name: 'CIPAMART',
    city: 'Jakarta Selatan',
    address: 'Jl. Cipamart Utama No. 5',
  },
  {
    id: 'store-snm',
    code: 'SNM',
    name: 'SINIMART',
    city: 'Jakarta Barat',
    address: 'Jl. Sinimart Raya No. 18',
  },
  {
    id: 'store-iqm',
    code: 'IQM',
    name: 'IQROMART',
    city: 'Jakarta Timur',
    address: 'Jl. Iqromart Mandiri No. 9',
  },
];

// Helper to generate consistent stock distribution across all 8 branches
const createBranchStocks = (
  baseQty: number,
  minThresh: number = 20,
  overrides?: Record<string, { quantity?: number; minThreshold?: number }>
): Record<string, ProductStock> => {
  const multipliers: Record<string, number> = {
    'store-krg': 1.0, // KRANGGAN (Main)
    'store-xml': 0.85, // KALIMALANG
    'store-klp': 0.7, // PDK KELAPA
    'store-plt': 1.1, // PLUIT
    'store-mkr': 0.55, // MEKAR JAYA
    'store-cpm': 0.65, // CIPAMART
    'store-snm': 0.75, // SINIMART
    'store-iqm': 0.45, // IQROMART
  };

  const stocks: Record<string, ProductStock> = {};
  INITIAL_STORES.forEach((store) => {
    const mult = multipliers[store.id] ?? 0.7;
    const calcQty = Math.max(0, Math.round(baseQty * mult));
    const override = overrides?.[store.id];

    stocks[store.id] = {
      storeId: store.id,
      quantity: override?.quantity !== undefined ? override.quantity : calcQty,
      minThreshold: override?.minThreshold !== undefined ? override.minThreshold : minThresh,
      lastUpdated: '2026-09-20T07:15:00Z',
    };
  });
  return stocks;
};

export const INITIAL_PRODUCTS: Product[] = [
  {
    id: 'prod-1',
    sku: '1001040',
    barcode: '089686010015',
    barcodeType: 'EAN13',
    name: 'INDOMIE AYAM BAWANG BAG 69GR',
    category: 'Instant Food',
    brand: 'Indomie',
    department: 'Grocery / Noodles',
    currency: 'Rp.',
    pricing: {
      unitLabel: 'PCS',
      unitQuantity: 1,
      unitPrice: 2900,
      bulkLabel: 'CRT',
      bulkQuantity: 40,
      bulkPrice: 113500,
    },
    stocks: createBranchStocks(140, 30, {
      'store-xml': { quantity: 18, minThreshold: 25 }, // Low stock in Kalimalang!
      'store-iqm': { quantity: 8, minThreshold: 15 }, // Low stock in Iqromart!
    }),
    dateEffective: new Date().toLocaleDateString('en-GB'),
    supplier: 'PT Indofood CBP Sukses Makmur',
    locationBin: 'A-04-02',
  },
  {
    id: 'prod-2',
    sku: '1001041',
    barcode: '089686010046',
    barcodeType: 'EAN13',
    name: 'INDOMIE AYAM SPESIAL BAG 75GR',
    category: 'Instant Food',
    brand: 'Indomie',
    department: 'Grocery / Noodles',
    currency: 'Rp.',
    pricing: {
      unitLabel: 'PCS',
      unitQuantity: 1,
      unitPrice: 2900,
      bulkLabel: 'CRT',
      bulkQuantity: 40,
      bulkPrice: 113500,
    },
    stocks: createBranchStocks(110, 25, {
      'store-klp': { quantity: 12, minThreshold: 20 }, // Low stock in Pdk Kelapa!
      'store-mkr': { quantity: 9, minThreshold: 15 }, // Low stock in Mekar Jaya!
    }),
    dateEffective: new Date().toLocaleDateString('en-GB'),
    supplier: 'PT Indofood CBP Sukses Makmur',
    locationBin: 'A-04-03',
  },
  {
    id: 'prod-3',
    sku: '1001042',
    barcode: '089686010053',
    barcodeType: 'EAN13',
    name: 'INDOMIE GORENG SPESIAL 85GR',
    category: 'Instant Food',
    brand: 'Indomie',
    department: 'Grocery / Noodles',
    currency: 'Rp.',
    pricing: {
      unitLabel: 'PCS',
      unitQuantity: 1,
      unitPrice: 3100,
      bulkLabel: 'CRT',
      bulkQuantity: 40,
      bulkPrice: 121000,
    },
    promotionalDiscount: {
      isActive: true,
      originalPrice: 3500,
      discountPercent: 11,
      promoLabel: 'WEEKEND SPECIAL',
      validUntil: '22/09/2026',
    },
    stocks: createBranchStocks(280, 50, {
      'store-cpm': { quantity: 24, minThreshold: 30 }, // Low stock in Cipamart!
    }),
    dateEffective: new Date().toLocaleDateString('en-GB'),
    supplier: 'PT Indofood CBP Sukses Makmur',
    locationBin: 'A-04-01',
  },
  {
    id: 'prod-4',
    sku: '1002011',
    barcode: '8992761011124',
    barcodeType: 'EAN13',
    name: 'ULTRA MILK UHT FULL CREAM 1000ML',
    category: 'Dairy & Milk',
    brand: 'Ultra Milk',
    department: 'Beverages / Dairy',
    currency: 'Rp.',
    pricing: {
      unitLabel: 'PCS',
      unitQuantity: 1,
      unitPrice: 21500,
      bulkLabel: 'CRT',
      bulkQuantity: 12,
      bulkPrice: 252000,
    },
    stocks: createBranchStocks(55, 20, {
      'store-xml': { quantity: 8, minThreshold: 15 }, // Low stock in Kalimalang!
    }),
    dateEffective: new Date().toLocaleDateString('en-GB'),
    supplier: 'PT Ultrajaya Milk Industry Tbk',
    locationBin: 'C-01-04',
  },
  {
    id: 'prod-5',
    sku: '1002012',
    barcode: '8992761011131',
    barcodeType: 'EAN13',
    name: 'ULTRA MILK UHT CHOCOLATE 1000ML',
    category: 'Dairy & Milk',
    brand: 'Ultra Milk',
    department: 'Beverages / Dairy',
    currency: 'Rp.',
    pricing: {
      unitLabel: 'PCS',
      unitQuantity: 1,
      unitPrice: 21500,
      bulkLabel: 'CRT',
      bulkQuantity: 12,
      bulkPrice: 252000,
    },
    stocks: createBranchStocks(60, 20, {
      'store-snm': { quantity: 10, minThreshold: 15 },
    }),
    dateEffective: new Date().toLocaleDateString('en-GB'),
    supplier: 'PT Ultrajaya Milk Industry Tbk',
    locationBin: 'C-01-05',
  },
  {
    id: 'prod-6',
    sku: '1003055',
    barcode: '8998866200234',
    barcodeType: 'EAN13',
    name: 'AQUA AIR MINERAL BOTOL 600ML',
    category: 'Beverages',
    brand: 'Aqua',
    department: 'Beverages / Water',
    currency: 'Rp.',
    pricing: {
      unitLabel: 'BTL',
      unitQuantity: 1,
      unitPrice: 3500,
      bulkLabel: 'CRT',
      bulkQuantity: 24,
      bulkPrice: 78000,
    },
    stocks: createBranchStocks(190, 40, {
      'store-klp': { quantity: 15, minThreshold: 30 },
    }),
    dateEffective: new Date().toLocaleDateString('en-GB'),
    supplier: 'PT Tirta Investama Danone',
    locationBin: 'B-02-01',
  },
  {
    id: 'prod-7',
    sku: '1004112',
    barcode: '8991001100221',
    barcodeType: 'EAN13',
    name: 'CHITATO SAPI PANGGANG 68GR',
    category: 'Snacks',
    brand: 'Chitato',
    department: 'Snacks / Chips',
    currency: 'Rp.',
    pricing: {
      unitLabel: 'PCS',
      unitQuantity: 1,
      unitPrice: 11200,
      bulkLabel: 'CRT',
      bulkQuantity: 30,
      bulkPrice: 320000,
    },
    stocks: createBranchStocks(75, 20, {
      'store-mkr': { quantity: 7, minThreshold: 15 },
    }),
    dateEffective: new Date().toLocaleDateString('en-GB'),
    supplier: 'PT Indofood Fritolay Makmur',
    locationBin: 'D-03-02',
  },
  {
    id: 'prod-8',
    sku: '1005204',
    barcode: '8999999052041',
    barcodeType: 'EAN13',
    name: 'LIFEBUOY TOTAL 10 BODY WASH 450ML',
    category: 'Personal Care',
    brand: 'Lifebuoy',
    department: 'Toiletries / Soap',
    currency: 'Rp.',
    pricing: {
      unitLabel: 'POUCH',
      unitQuantity: 1,
      unitPrice: 28900,
      bulkLabel: 'CRT',
      bulkQuantity: 12,
      bulkPrice: 335000,
    },
    promotionalDiscount: {
      isActive: true,
      originalPrice: 34500,
      discountPercent: 16,
      promoLabel: 'PROMO HEMAT',
      validUntil: '25/09/2026',
    },
    stocks: createBranchStocks(50, 15, {
      'store-iqm': { quantity: 5, minThreshold: 10 },
    }),
    dateEffective: new Date().toLocaleDateString('en-GB'),
    supplier: 'PT Unilever Indonesia Tbk',
    locationBin: 'E-01-03',
  },
  {
    id: 'prod-9',
    sku: '1006010',
    barcode: '8991002105010',
    barcodeType: 'EAN13',
    name: 'ABC KECAP MANIS BOTOL 275ML',
    category: 'Sauce & Condiments',
    brand: 'ABC',
    department: 'Grocery / Condiments',
    currency: 'Rp.',
    pricing: {
      unitLabel: 'BTL',
      unitQuantity: 1,
      unitPrice: 17500,
      bulkLabel: 'CRT',
      bulkQuantity: 24,
      bulkPrice: 408000,
    },
    stocks: createBranchStocks(85, 20, {
      'store-krg': { quantity: 90, minThreshold: 20 },
    }),
    dateEffective: new Date().toLocaleDateString('en-GB'),
    supplier: 'PT Heinz ABC Indonesia',
    locationBin: 'A-02-01',
  },
  {
    id: 'prod-10',
    sku: '1006011',
    barcode: '089686060348',
    barcodeType: 'EAN13',
    name: 'INDOFOOD SAUS SAMBAL PEDAS 335ML',
    category: 'Sauce & Condiments',
    brand: 'Indofood',
    department: 'Grocery / Condiments',
    currency: 'Rp.',
    pricing: {
      unitLabel: 'BTL',
      unitQuantity: 1,
      unitPrice: 14900,
      bulkLabel: 'CRT',
      bulkQuantity: 24,
      bulkPrice: 345600,
    },
    stocks: createBranchStocks(65, 15, {
      'store-krg': { quantity: 70, minThreshold: 15 },
    }),
    dateEffective: new Date().toLocaleDateString('en-GB'),
    supplier: 'PT Indofood CBP Sukses Makmur',
    locationBin: 'A-02-02',
  },
];

export const INITIAL_TEMPLATES: LabelTemplateConfig[] = [
  {
    id: 'tmpl-supermarket',
    name: 'Supermarket Shelf Tag (Indonesian Retail - Attached Example)',
    type: 'supermarket_shelf',
    widthMm: 72,
    heightMm: 35,
    showStoreName: false,
    showBulkPrice: false,
    showSku: true,
    showDate: true,
    showDepartment: false,
    fontFamily: 'sans',
    primaryPriceColor: '#e11d48', // Red bold like example
    barcodeHeightMm: 13,
    dpi: 203,
  },
  {
    id: 'tmpl-standard-50x30',
    name: 'Standard Thermal Label (50mm x 30mm)',
    type: 'standard_label_50x30',
    widthMm: 50,
    heightMm: 30,
    showStoreName: true,
    showBulkPrice: false,
    showSku: true,
    showDate: true,
    showDepartment: true,
    fontFamily: 'sans',
    primaryPriceColor: '#0f172a',
    barcodeHeightMm: 10,
    dpi: 203,
  },
  {
    id: 'tmpl-promo',
    name: 'Clearance & Promo Shelf Talker (Yellow/Red Highlight)',
    type: 'promo_clearance_shelf',
    widthMm: 75,
    heightMm: 35,
    showStoreName: true,
    showBulkPrice: true,
    showSku: true,
    showDate: true,
    showDepartment: true,
    fontFamily: 'sans',
    primaryPriceColor: '#dc2626',
    barcodeHeightMm: 10,
    dpi: 203,
  },
  {
    id: 'tmpl-compact-40x20',
    name: 'Compact Item / Jewelry Tag (40mm x 20mm)',
    type: 'compact_tag_40x20',
    widthMm: 40,
    heightMm: 20,
    showStoreName: false,
    showBulkPrice: false,
    showSku: true,
    showDate: false,
    showDepartment: false,
    fontFamily: 'sans',
    primaryPriceColor: '#0f172a',
    barcodeHeightMm: 8,
    dpi: 203,
  },
  {
    id: 'tmpl-box-100x70',
    name: 'Warehouse Carton & Bin Tag (100mm x 70mm)',
    type: 'warehouse_box_100x70',
    widthMm: 100,
    heightMm: 70,
    showStoreName: true,
    showBulkPrice: true,
    showSku: true,
    showDate: true,
    showDepartment: true,
    fontFamily: 'sans',
    primaryPriceColor: '#0f172a',
    barcodeHeightMm: 24,
    dpi: 203,
  },
];

export const INITIAL_USERS: User[] = [
  {
    id: 'usr-admin',
    name: 'Alex Tanuwijaya',
    email: 'alex.admin@amanstore.com',
    role: 'ADMIN',
    storeId: 'store-krg',
  },
  {
    id: 'usr-manager',
    name: 'Dewi Lestari',
    email: 'dewi.manager@amanstore.com',
    role: 'MANAGER',
    storeId: 'store-xml',
  },
  {
    id: 'usr-staff',
    name: 'Budi Santoso',
    email: 'budi.floor@amanstore.com',
    role: 'STAFF',
    storeId: 'store-krg',
  },
];
