export type UserRole = 'ADMIN' | 'MANAGER' | 'STAFF';

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  storeId: string;
  avatar?: string;
}

export interface StoreLocation {
  id: string;
  code: string;
  name: string;
  city: string;
  address: string;
  isPrimary?: boolean;
}

export interface MultiTierPrice {
  unitLabel: string; // e.g. "PCS", "BTL", "KGM"
  unitQuantity: number; // e.g. 1
  unitPrice: number; // e.g. 2900

  bulkLabel?: string; // e.g. "CRT", "BOX", "PAK"
  bulkQuantity?: number; // e.g. 40
  bulkPrice?: number; // e.g. 113500
}

export interface ProductStock {
  storeId: string;
  quantity: number;
  minThreshold: number;
  lastUpdated: string;
}

export interface ImportProductRecord {
  name: string;
  barcode: string;
  price: number;
  sku?: string;
  category?: string;
  brand?: string;
  unitLabel?: string;
  bulkPrice?: number;
  bulkQuantity?: number;
  bulkLabel?: string;
  stock?: number;
  minThreshold?: number;
}

export interface Product {
  id: string;
  sku: string; // e.g. "1001040"
  barcode: string; // e.g. "089686010015"
  barcodeType: 'EAN13' | 'CODE128' | 'UPCA' | 'QR';
  name: string; // e.g. "INDOMIE AYAM BAWANG BAG 69GR"
  category: string;
  brand: string;
  department: string;
  currency: string; // e.g. "Rp.", "$", "€"
  pricing: MultiTierPrice;
  promotionalDiscount?: {
    isActive: boolean;
    originalPrice: number;
    discountPercent: number;
    promoLabel: string;
    validUntil: string;
  };
  stocks: Record<string, ProductStock>; // storeId -> ProductStock
  dateEffective: string; // e.g. "13/09/2026"
  supplier?: string;
  locationBin?: string;
}

export type TemplateType = 
  | 'supermarket_shelf' // Exact match for user's Indonesian Indomaret/Alfamart retail tag
  | 'standard_label_50x30'
  | 'compact_tag_40x20'
  | 'promo_clearance_shelf'
  | 'warehouse_box_100x70';

export interface LabelTemplateConfig {
  id: string;
  name: string;
  type: TemplateType;
  widthMm: number; // e.g. 60 or 50
  heightMm: number; // e.g. 30 or 25
  showStoreName: boolean;
  showBulkPrice: boolean;
  showSku: boolean;
  showDate: boolean;
  showDepartment: boolean;
  fontFamily: 'sans' | 'mono' | 'serif';
  primaryPriceColor: string; // red, black, blue
  barcodeHeightMm: number;
  dpi: 203 | 300;
}

export interface PrintQueueItem {
  id: string;
  product: Product;
  quantity: number;
  templateId: string;
  storeId: string;
}

export interface ThermalPrinterSettings {
  connectionType: 'browser_print' | 'bluetooth' | 'serial' | 'network';
  printerLanguage: 'ESC_POS' | 'TSPL' | 'ZPL';
  paperWidthMm: number; // 58, 80, or custom
  labelWidthMm: number;
  labelHeightMm: number;
  dpi: 203 | 300;
  darkness: number; // 1-15
  autoCut: boolean;
  feedLines: number;
  bluetoothDeviceName?: string;
}

export interface StockTransfer {
  id: string;
  fromStoreId: string;
  toStoreId: string;
  productId: string;
  productName: string;
  sku: string;
  quantity: number;
  status: 'PENDING' | 'IN_TRANSIT' | 'COMPLETED' | 'CANCELLED';
  initiatedBy: string;
  timestamp: string;
}

export interface StockAdjustment {
  id: string;
  storeId: string;
  productId: string;
  productName: string;
  sku: string;
  previousQty: number;
  newQty: number;
  delta: number;
  reason: 'RECEIVED_SHIPMENT' | 'SALE' | 'AUDIT_CORRECTION' | 'DAMAGED' | 'EXPIRED';
  performedBy: string;
  timestamp: string;
}

export interface LowStockAlert {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  barcode: string;
  storeId: string;
  storeName: string;
  currentStock: number;
  minThreshold: number;
  timestamp: string;
  isRead: boolean;
}

export interface SyncQueueItem {
  id: string;
  type: 'STOCK_ADJUSTMENT' | 'STOCK_TRANSFER' | 'PRODUCT_UPDATE' | 'PRINT_LOG';
  payload: any;
  timestamp: number;
  status: 'QUEUED' | 'SYNCING' | 'SYNCED' | 'FAILED';
}
