import React from 'react';

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
  showTagline = true,
}) => {
  // Height & scale presets
  const sizeMap = {
    sm: { height: 28, textClass: 'text-lg', taglineClass: 'text-[8px]', iconSize: 28, gap: 'gap-2' },
    md: { height: 40, textClass: 'text-2xl', taglineClass: 'text-[10px]', iconSize: 40, gap: 'gap-3' },
    lg: { height: 56, textClass: 'text-4xl', taglineClass: 'text-xs', iconSize: 56, gap: 'gap-4' },
    xl: { height: 72, textClass: 'text-5xl', taglineClass: 'text-sm', iconSize: 72, gap: 'gap-5' },
    hero: { height: 96, textClass: 'text-6xl sm:text-7xl', taglineClass: 'text-sm sm:text-base', iconSize: 96, gap: 'gap-5 sm:gap-6' },
  };

  const currentSize = sizeMap[size] || sizeMap.md;

  // Colors
  const limeColor = '#62cb32'; // Signature Amanmart lime-green
  const limeHover = '#55be2b';
  const taglineColor = theme === 'dark' ? '#FFFFFF' : '#14532d'; // White on dark, deep forest green on light

  // Icon SVG
  const CartIcon = (
    <svg
      viewBox="0 0 100 80"
      className="shrink-0 transition-transform duration-200 group-hover:scale-105"
      style={{
        width: currentSize.iconSize,
        height: (currentSize.iconSize * 80) / 100,
      }}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Top horizontal slat & cart handle */}
      <path
        d="M 6 12 L 56 12 C 62 12 66 16 67 22 L 78 22 C 81 22 83 20 83 17 C 83 14 81 12 78 12 L 67 12 C 64 7 59 4 53 4 L 6 4 C 2.5 4 0 6.5 0 10 C 0 13.5 2.5 16 6 16 Z"
        fill={limeColor}
      />
      {/* Middle horizontal slat / wing */}
      <path
        d="M 12 28 L 52 28 C 55.5 28 58 25.5 58 22 C 58 18.5 55.5 16 52 16 L 12 16 C 8.5 16 6 18.5 6 22 C 6 25.5 8.5 28 12 28 Z"
        fill={limeColor}
      />
      {/* Bottom basket curve */}
      <path
        d="M 17 44 L 60 44 C 66 44 71 39 72 33 L 73 25 C 73 22 71 20 68 20 C 65 20 63 22 63 25 L 62 31 C 61 34 58 36 55 36 L 17 36 C 13.5 36 11 38.5 11 42 C 11 43.1 11.4 44 12.5 44 Z"
        fill={limeColor}
      />
      {/* Wheels */}
      <circle cx="28" cy="58" r="8" fill={limeColor} />
      <circle cx="56" cy="58" r="8" fill={limeColor} />
    </svg>
  );

  if (variant === 'icon-only') {
    return <div className={`inline-flex items-center justify-center ${className}`}>{CartIcon}</div>;
  }

  return (
    <div className={`inline-flex items-center ${currentSize.gap} select-none ${className}`}>
      {CartIcon}

      <div className="flex flex-col justify-center">
        {/* amanmart text */}
        <span
          className={`${currentSize.textClass} font-black tracking-tight leading-none lowercase`}
          style={{
            color: limeColor,
            fontFamily:
              "'Nunito', 'Comfortaa', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
            textShadow: theme === 'dark' ? '0 2px 10px rgba(0,0,0,0.35)' : 'none',
          }}
        >
          amanmart
        </span>

        {/* HALAL TERJANGKAU */}
        {showTagline && (
          <span
            className={`${currentSize.taglineClass} font-extrabold uppercase tracking-[0.24em] mt-0.5 sm:mt-1 leading-none text-center`}
            style={{
              color: taglineColor,
              opacity: theme === 'dark' ? 0.95 : 0.85,
              textShadow: theme === 'dark' ? '0 1px 4px rgba(0,0,0,0.4)' : 'none',
            }}
          >
            HALAL TERJANGKAU
          </span>
        )}
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
      {/* Background organic wave / watermark accents */}
      <div className="absolute -right-16 -bottom-16 w-80 h-80 rounded-full bg-emerald-500/10 blur-3xl pointer-events-none" />
      <div className="absolute left-1/3 -top-20 w-72 h-72 rounded-full bg-lime-400/5 blur-3xl pointer-events-none" />

      {/* Subtle paper / woven texture overlay */}
      <div 
        className="absolute inset-0 opacity-10 pointer-events-none" 
        style={{
          backgroundImage: 'radial-gradient(circle at 1px 1px, #ffffff 1px, transparent 0)',
          backgroundSize: '16px 16px',
        }}
      />

      <div className="relative px-6 py-6 sm:py-7 flex flex-col md:flex-row items-center justify-between gap-6">
        {/* Logo and Identity */}
        <div className="flex flex-col sm:flex-row items-center gap-5 text-center sm:text-left">
          <div className="p-3.5 sm:p-4 rounded-2xl bg-black/20 backdrop-blur-xs border border-emerald-700/40 shadow-inner flex items-center justify-center">
            <AmanmartLogo size="lg" theme="dark" showTagline={true} />
          </div>

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

        {/* Action Controls */}
        <div className="flex items-center gap-3 shrink-0 flex-wrap justify-center">
          {onPrintReference && (
            <button
              onClick={onPrintReference}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs text-white bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-500 hover:to-green-500 shadow-md shadow-black/20 hover:shadow-emerald-900/30 transition transform active:scale-95 border border-emerald-400/30"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="6 9 6 2 18 2 18 9" />
                <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
                <rect x="6" y="14" width="12" height="8" />
              </svg>
              Print Standard Tag Pair
            </button>
          )}

          {onScanBarcode && (
            <button
              onClick={onScanBarcode}
              className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl font-semibold text-xs text-emerald-100 bg-emerald-900/60 hover:bg-emerald-800/80 border border-emerald-600/40 transition active:scale-95"
            >
              <svg className="w-4 h-4 text-[#62cb32]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 5v14M8 5v14M12 5v14M17 5v14M21 5v14" />
              </svg>
              Scan Barcode
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
