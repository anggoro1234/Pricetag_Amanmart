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

// Empty by default: product catalog is managed directly via Supabase Cloud & Excel/CSV Import
export const INITIAL_PRODUCTS: Product[] = [];

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
