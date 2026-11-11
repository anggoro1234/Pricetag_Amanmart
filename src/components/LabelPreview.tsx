import React, { useEffect, useRef, useState } from 'react';
import JsBarcode from 'jsbarcode';
import { Product, LabelTemplateConfig, StoreLocation } from '../types';

// Format current live date as DD/MM/YYYY (e.g. 09/11/2026)
const formatLivePrintDate = (date: Date = new Date()): string => {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
};

interface LabelPreviewProps {
  product: Product;
  template: LabelTemplateConfig;
  store?: StoreLocation;
  scale?: number; // Visual preview scaling factor (default 1)
  className?: string;
  isPrintMode?: boolean;
}

export const LabelPreview: React.FC<LabelPreviewProps> = ({
  product,
  template,
  store,
  scale = 1,
  className = '',
  isPrintMode = false,
}) => {
  const barcodeRef = useRef<SVGSVGElement | null>(null);
  const [livePrintDate, setLivePrintDate] = useState<string>(() => formatLivePrintDate());

  // Keep print date synced live with current system clock
  useEffect(() => {
    setLivePrintDate(formatLivePrintDate());
    const timer = setInterval(() => {
      setLivePrintDate(formatLivePrintDate());
    }, 30000);
    return () => clearInterval(timer);
  }, []);

  // Generate crisp dynamic barcode with JsBarcode
  useEffect(() => {
    if (!barcodeRef.current) return;
    try {
      // Determine barcode format: EAN-13 requires 12 or 13 numeric chars
      const cleanBarcode = product.barcode.replace(/[^0-9]/g, '');
      const format = cleanBarcode.length === 12 || cleanBarcode.length === 13 ? 'EAN13' : 'CODE128';

      JsBarcode(barcodeRef.current, product.barcode, {
        format: format,
        width: 1.5 * scale,
        height: (template.barcodeHeightMm || 13) * 2.35 * scale,
        displayValue: true,
        font: 'monospace',
        fontSize: 11.5 * scale,
        textMargin: 1.5 * scale,
        margin: 1 * scale,
        background: '#ffffff',
        lineColor: '#000000',
      });
    } catch {
      // Fallback to Code 128 if EAN checksum fails
      try {
        if (barcodeRef.current) {
          JsBarcode(barcodeRef.current, product.barcode, {
            format: 'CODE128',
            width: 1.35 * scale,
            height: (template.barcodeHeightMm || 13) * 2.35 * scale,
            displayValue: true,
            fontSize: 11 * scale,
            textMargin: 1.5 * scale,
            margin: 1 * scale,
          });
        }
      } catch {
        // Silent fallback
      }
    }
  }, [product.barcode, template.barcodeHeightMm, scale]);

  // Dimensions in mm converted to pixel preview for screen fidelity
  // 1 mm ≈ 3.78 px at standard 96 DPI screen
  const mmToPx = 3.78 * scale;
  const widthPx = template.widthMm * mmToPx;
  const heightPx = template.heightMm * mmToPx;

  // Format currency
  const formatMoney = (amount: number) => {
    return `${product.currency} ${amount.toLocaleString('id-ID')}`;
  };

  // 1. Supermarket Shelf Tag (Wider & Larger to fit physical retail price tag rail holder)
  if (template.type === 'supermarket_shelf') {
    return (
      <div
        className={`label-item relative bg-white border border-slate-300 shadow-sm overflow-hidden select-none font-sans text-slate-800 ${className}`}
        style={{
          width: isPrintMode ? `${template.widthMm}mm` : `${widthPx}px`,
          height: isPrintMode ? `${template.heightMm}mm` : `${heightPx}px`,
          padding: `${4 * scale}px ${6 * scale}px`,
          boxSizing: 'border-box',
        }}
      >
        {/* Top: Product Name in clean dark blue uppercase */}
        <div
          className="font-extrabold text-slate-800 tracking-tight leading-tight uppercase truncate"
          style={{ fontSize: `${12.5 * scale}px`, marginBottom: `${2.5 * scale}px` }}
          title={product.name}
        >
          {product.name}
        </div>

        {/* Middle-Right: Bold Red Multi-Tier Price */}
        <div className="flex flex-col items-end justify-center my-0.5">
          {/* Unit Price */}
          <div className="flex items-baseline gap-1 leading-none">
            <span
              className="font-extrabold tracking-tight"
              style={{
                color: template.primaryPriceColor || '#dc2626',
                fontSize: `${19.5 * scale}px`,
              }}
            >
              {formatMoney(product.pricing.unitPrice)}
            </span>
            <span
              className="font-semibold text-slate-600 uppercase"
              style={{ fontSize: `${11 * scale}px` }}
            >
              / {product.pricing.unitLabel} / {product.pricing.unitQuantity}
            </span>
          </div>

          {/* Bulk/Carton Price */}
          {template.showBulkPrice && product.pricing.bulkPrice && product.pricing.bulkLabel && (
            <div className="flex items-baseline gap-1 leading-none mt-1">
              <span
                className="font-bold tracking-tight"
                style={{
                  color: template.primaryPriceColor || '#dc2626',
                  fontSize: `${14.5 * scale}px`,
                }}
              >
                {formatMoney(product.pricing.bulkPrice)}
              </span>
              <span
                className="font-semibold text-slate-600 uppercase"
                style={{ fontSize: `${10 * scale}px` }}
              >
                / {product.pricing.bulkLabel} / {product.pricing.bulkQuantity || 1}
              </span>
            </div>
          )}
        </div>

        {/* Bottom: Barcode on left + SKU & Effective Date on right */}
        <div className="absolute bottom-1.5 left-2 right-2 flex items-end justify-between">
          <div className="flex-shrink-0">
            <svg ref={barcodeRef} className="block -ml-1" />
          </div>

          <div
            className="flex flex-col items-end justify-end text-slate-600 font-mono text-right pb-1 leading-tight"
            style={{ fontSize: `${10 * scale}px` }}
          >
            {template.showSku && (
              <span className="font-bold tracking-wide text-slate-800">{product.sku}</span>
            )}
            {template.showDate && (
              <span
                className="text-slate-600 font-semibold mt-0.5"
                style={{ fontSize: `${9 * scale}px` }}
              >
                {livePrintDate}
              </span>
            )}
          </div>
        </div>
      </div>
    );
  }

  // 2. Promotional & Clearance Tag (Yellow / Red Banner)
  if (template.type === 'promo_clearance_shelf') {
    const promo = product.promotionalDiscount;
    return (
      <div
        className={`label-item relative bg-white border-2 border-red-500 shadow-sm overflow-hidden select-none font-sans text-slate-800 ${className}`}
        style={{
          width: isPrintMode ? `${template.widthMm}mm` : `${widthPx}px`,
          height: isPrintMode ? `${template.heightMm}mm` : `${heightPx}px`,
          padding: `${2 * scale}px ${4 * scale}px`,
          boxSizing: 'border-box',
        }}
      >
        {/* Yellow Promo Ribbon */}
        <div className="bg-amber-400 text-slate-900 font-black tracking-wider uppercase text-center py-0.5 text-[9px] -mx-1 -mt-1 mb-1">
          ★ {promo?.promoLabel || 'SPECIAL PROMOTION'} ★
        </div>

        <div className="flex justify-between items-start">
          <div className="font-bold text-slate-800 text-[10px] uppercase truncate max-w-[70%]">
            {product.name}
          </div>
          {promo && (
            <span className="bg-red-600 text-white font-extrabold text-[9px] px-1 rounded">
              -{promo.discountPercent}%
            </span>
          )}
        </div>

        <div className="flex justify-between items-center my-1">
          <div>
            {promo && (
              <div className="text-[9px] text-slate-400 line-through">
                {formatMoney(promo.originalPrice)}
              </div>
            )}
            <div className="text-[18px] font-black text-red-600 leading-none">
              {formatMoney(product.pricing.unitPrice)}
            </div>
          </div>

          <div className="text-right text-[8px] text-slate-500">
            <div>PER {product.pricing.unitLabel}</div>
            {template.showBulkPrice && product.pricing.bulkPrice && (
              <div className="font-semibold text-slate-700">
                {formatMoney(product.pricing.bulkPrice)}/{product.pricing.bulkLabel}
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-between items-end mt-1">
          <svg ref={barcodeRef} className="block -ml-1" />
          <div className="text-right font-mono text-[8px] text-slate-500">
            <div>SKU: {product.sku}</div>
            <div>{livePrintDate}</div>
          </div>
        </div>
      </div>
    );
  }

  // 3. Compact Tag (40mm x 20mm) for Jewelry, Small Gadgets, Cables
  if (template.type === 'compact_tag_40x20') {
    return (
      <div
        className={`label-item relative bg-white border border-slate-300 shadow-sm overflow-hidden select-none font-sans text-slate-900 ${className}`}
        style={{
          width: isPrintMode ? `${template.widthMm}mm` : `${widthPx}px`,
          height: isPrintMode ? `${template.heightMm}mm` : `${heightPx}px`,
          padding: `${2 * scale}px ${3 * scale}px`,
          boxSizing: 'border-box',
        }}
      >
        <div className="font-bold text-[9px] uppercase truncate">{product.name}</div>
        <div className="flex justify-between items-center my-0.5">
          <span className="font-black text-[13px] text-slate-900">
            {formatMoney(product.pricing.unitPrice)}
          </span>
          <span className="font-mono text-[8px] text-slate-500">#{product.sku}</span>
        </div>
        <div className="flex justify-center -mt-1">
          <svg ref={barcodeRef} className="block" />
        </div>
      </div>
    );
  }

  // 4. Warehouse Box / Bin Label (100mm x 70mm)
  if (template.type === 'warehouse_box_100x70') {
    return (
      <div
        className={`label-item relative bg-white border-2 border-slate-800 shadow-sm overflow-hidden select-none font-sans text-slate-900 ${className}`}
        style={{
          width: isPrintMode ? `${template.widthMm}mm` : `${widthPx}px`,
          height: isPrintMode ? `${template.heightMm}mm` : `${heightPx}px`,
          padding: `${8 * scale}px`,
          boxSizing: 'border-box',
        }}
      >
        <div className="flex justify-between items-center border-b-2 border-slate-800 pb-1 mb-2">
          <span className="font-black text-sm uppercase tracking-wider">
            {store?.name || 'CENTRAL WAREHOUSE LOGISTICS'}
          </span>
          <span className="bg-slate-900 text-white font-bold text-xs px-2 py-0.5 rounded">
            BIN: {product.locationBin || 'A-01-01'}
          </span>
        </div>

        <div className="text-base font-black uppercase mb-1">{product.name}</div>
        <div className="text-xs text-slate-600 mb-2">
          DEPT: {product.department} | BRAND: {product.brand}
        </div>

        <div className="grid grid-cols-2 gap-2 border-y border-slate-300 py-2 my-2">
          <div>
            <div className="text-[10px] text-slate-500 font-bold uppercase">Unit Price</div>
            <div className="text-lg font-black text-slate-900">
              {formatMoney(product.pricing.unitPrice)} / {product.pricing.unitLabel}
            </div>
          </div>
          <div>
            <div className="text-[10px] text-slate-500 font-bold uppercase">Carton Master Price</div>
            <div className="text-lg font-black text-slate-900">
              {product.pricing.bulkPrice ? formatMoney(product.pricing.bulkPrice) : 'N/A'}
              <span className="text-xs font-normal text-slate-500">
                {' '}
                ({product.pricing.bulkQuantity || 1} {product.pricing.unitLabel})
              </span>
            </div>
          </div>
        </div>

        <div className="flex justify-between items-end pt-2">
          <svg ref={barcodeRef} className="block" />
          <div className="text-right font-mono text-xs">
            <div className="font-bold">SKU: {product.sku}</div>
            <div className="text-slate-500">DATE: {livePrintDate}</div>
          </div>
        </div>
      </div>
    );
  }

  // 5. Standard Retail Label (50mm x 30mm)
  return (
    <div
      className={`label-item relative bg-white border border-slate-300 shadow-sm overflow-hidden select-none font-sans text-slate-900 ${className}`}
      style={{
        width: isPrintMode ? `${template.widthMm}mm` : `${widthPx}px`,
        height: isPrintMode ? `${template.heightMm}mm` : `${heightPx}px`,
        padding: `${3 * scale}px ${4 * scale}px`,
        boxSizing: 'border-box',
      }}
    >
      {template.showStoreName && (
        <div className="text-[8px] font-bold text-slate-500 uppercase tracking-wider text-center border-b border-slate-200 pb-0.5 mb-1">
          {store?.name || 'AMAN RETAIL STORE'}
        </div>
      )}

      <div className="font-bold text-[10px] text-slate-800 uppercase truncate leading-tight">
        {product.name}
      </div>

      <div className="flex justify-between items-baseline mt-1">
        <span className="font-black text-[15px] text-slate-900 leading-none">
          {formatMoney(product.pricing.unitPrice)}
        </span>
        <span className="text-[9px] text-slate-500 font-medium uppercase">
          / {product.pricing.unitLabel}
        </span>
      </div>

      <div className="flex justify-between items-end mt-1">
        <svg ref={barcodeRef} className="block -ml-1" />
        <div className="text-right font-mono text-[8px] text-slate-500 pb-0.5">
          {template.showSku && <div>{product.sku}</div>}
          {template.showDate && <div>{livePrintDate}</div>}
        </div>
      </div>
    </div>
  );
};
