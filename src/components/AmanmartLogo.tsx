import React, { useState } from 'react';

interface AmanmartLogoProps {
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'hero';
  variant?: 'full' | 'icon-only' | 'badge';
  theme?: 'dark' | 'light';
  className?: string;
  showTagline?: boolean;
}

export const AmanmartLogo: React.FC<AmanmartLogoProps> = ({
  size = 'md',
  variant = 'full',
  theme = 'dark',
  className = '',
}) => {
  const [imgError, setImgError] = useState(false);

  // Height & responsive image sizing presets
  const sizeMap = {
    sm: {
      imgClass: 'h-7 sm:h-8 md:h-9 w-auto',
      badgeClass: 'px-2.5 py-1 rounded-xl',
    },
    md: {
      imgClass: 'h-9 sm:h-11 md:h-12 w-auto',
      badgeClass: 'px-3 sm:px-4 py-1.5 sm:py-2 rounded-xl',
    },
    lg: {
      imgClass: 'h-11 sm:h-14 md:h-16 w-auto',
      badgeClass: 'px-4 py-2 rounded-2xl',
    },
    xl: {
      imgClass: 'h-14 sm:h-16 md:h-20 w-auto',
      badgeClass: 'px-5 py-2.5 rounded-2xl',
    },
    hero: {
      imgClass: 'h-16 sm:h-20 md:h-24 w-auto',
      badgeClass: 'px-6 py-3 rounded-2xl',
    },
  };

  const currentSize = sizeMap[size] || sizeMap.md;

  // Official uploaded Amanmart image logo
  if (!imgError) {
    return (
      <div
        className={`inline-flex items-center justify-center select-none shrink-0 ${
          theme === 'dark'
            ? `bg-white shadow-sm border border-emerald-100/90 ${currentSize.badgeClass}`
            : ''
        } ${className}`}
      >
        <img
          src="/amanmart-logo.png"
          alt="Amanmart - Halal Terjangkau"
          onError={() => setImgError(true)}
          className={`${currentSize.imgClass} object-contain block`}
          draggable={false}
        />
      </div>
    );
  }

  // Fallback vector matching the official Amanmart logo (two-tone green + Halal Terjangkau)
  return (
    <div
      className={`inline-flex items-center gap-2 select-none shrink-0 ${
        theme === 'dark'
          ? `bg-white shadow-sm border border-emerald-100/90 ${currentSize.badgeClass}`
          : ''
      } ${className}`}
    >
      <div className="flex flex-col justify-center">
        <span className="text-lg sm:text-xl font-black tracking-tight leading-none lowercase">
          <span style={{ color: '#008c3b' }}>aman</span>
          <span style={{ color: '#83bd28' }}>mart</span>
        </span>
        <span
          className="text-[8px] sm:text-[9px] font-bold uppercase tracking-[0.22em] mt-0.5 leading-none text-center"
          style={{ color: '#333333' }}
        >
          HALAL TERJANGKAU
        </span>
      </div>
    </div>
  );
};

interface AmanmartBannerCardProps {
  onPrintReference?: () => void;
  onScanBarcode?: () => void;
  className?: string;
}

export const AmanmartBannerCard: React.FC<AmanmartBannerCardProps> = ({
  onPrintReference,
  onScanBarcode,
  className = '',
}) => {
  return (
    <div
      className={`relative overflow-hidden rounded-2xl shadow-lg border border-emerald-800/50 ${className}`}
      style={{
        background: 'linear-gradient(135deg, #0b3922 0%, #0f442a 50%, #124e30 100%)',
      }}
    >
      <div className="absolute -right-16 -bottom-16 w-80 h-80 rounded-full bg-emerald-500/10 blur-3xl pointer-events-none" />
      <div className="absolute left-1/3 -top-20 w-72 h-72 rounded-full bg-lime-400/5 blur-3xl pointer-events-none" />

      <div className="relative px-4 sm:px-6 py-5 sm:py-6 flex flex-col md:flex-row items-center justify-between gap-4 sm:gap-6">
        <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-5 text-center sm:text-left">
          <AmanmartLogo size="md" theme="dark" showTagline={true} />

          <div className="space-y-1">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-950/80 border border-emerald-600/40 text-emerald-300 text-[11px] font-bold">
              <span className="w-2 h-2 rounded-full bg-[#62cb32] animate-pulse" />
              Official Supermarket Tag &amp; Inventory System
            </div>
            <h2 className="text-white text-base sm:text-lg font-bold">
              Standard Indonesian Dual-Tier Shelf Label System
            </h2>
            <p className="text-emerald-200/80 text-xs max-w-xl">
              Precision thermal shelf pricing with bold unit/carton rates, EAN-13 barcodes, SKU tags, and multi-branch stock sync.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 sm:gap-3 shrink-0 flex-wrap justify-center">
          {onPrintReference && (
            <button
              onClick={onPrintReference}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs text-white bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-500 hover:to-green-500 shadow-md shadow-black/20 transition transform active:scale-95 border border-emerald-400/30"
            >
              Print Standard Tag Pair
            </button>
          )}

          {onScanBarcode && (
            <button
              onClick={onScanBarcode}
              className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl font-semibold text-xs text-emerald-100 bg-emerald-900/60 hover:bg-emerald-800/80 border border-emerald-600/40 transition active:scale-95"
            >
              Scan Barcode
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
