import React from 'react';
import { 
  Printer, 
  Barcode as BarcodeIcon, 
  Layers, 
  Bell, 
  Building2, 
  WifiOff, 
  Cloud, 
  LayoutTemplate
} from 'lucide-react';
import { StoreLocation, User, ThermalPrinterSettings } from '../types';
import { AmanmartLogo } from './AmanmartLogo';

interface NavbarProps {
  stores: StoreLocation[];
  activeStore: StoreLocation;
  onSelectStore: (storeId: string) => void;
  currentUser: User;
  isOnline: boolean;
  isSimulatedOffline: boolean;
  onToggleOffline: () => void;
  batchQueueCount: number;
  unreadAlertsCount: number;
  onOpenScanner: () => void;
  onOpenBatchPrint: () => void;
  onOpenPrinterSettings: () => void;
  onOpenTemplateEditor: () => void;
  onOpenNotifications: () => void;
  onOpenAuth: () => void;
  onOpenDeployGuide: () => void;
  printerSettings: ThermalPrinterSettings;
}

export const Navbar: React.FC<NavbarProps> = ({
  stores,
  activeStore,
  onSelectStore,
  currentUser,
  isOnline,
  isSimulatedOffline,
  onToggleOffline,
  batchQueueCount,
  unreadAlertsCount,
  onOpenScanner,
  onOpenBatchPrint,
  onOpenPrinterSettings,
  onOpenTemplateEditor,
  onOpenNotifications,
  onOpenAuth,
  onOpenDeployGuide,
}) => {
  return (
    <header className="bg-[#0b3520] text-white border-b border-emerald-800/40 sticky top-0 z-40 shadow-md">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 min-h-16 py-2 flex items-center justify-between gap-2 sm:gap-3">
        {/* Brand & Title with Official Amanmart Logo */}
        <div className="flex items-center gap-2.5 sm:gap-4 shrink-0">
          <AmanmartLogo
            size="sm"
            theme="dark"
            showTagline={true}
            className="cursor-pointer hover:opacity-95 transition"
          />

          <div className="hidden xl:flex items-center gap-2 pl-3 border-l border-emerald-800/60">
            <span className="bg-emerald-500/20 text-emerald-300 text-[10px] font-extrabold px-2.5 py-0.5 rounded-full border border-emerald-500/30 uppercase tracking-wide whitespace-nowrap">
              Shelf Label POS &amp; Sync
            </span>
          </div>
        </div>

        {/* Store Location Selector (Desktop) */}
        <div className="hidden lg:flex items-center gap-2 bg-emerald-950/70 px-3 py-1.5 rounded-xl border border-emerald-800/60 shadow-inner shrink-0">
          <Building2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <select
            value={activeStore.id}
            onChange={(e) => onSelectStore(e.target.value)}
            className="bg-transparent text-xs font-bold text-emerald-100 focus:outline-none cursor-pointer"
          >
            {stores.map((s) => (
              <option key={s.id} value={s.id} className="bg-[#0b3520] text-white">
                {s.name} ({s.code})
              </option>
            ))}
          </select>
        </div>

        {/* Action Controls Group */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {/* Offline / Online Sync Toggle */}
          <button
            onClick={onToggleOffline}
            className={`flex items-center gap-1.5 px-2 sm:px-2.5 py-1.5 rounded-xl text-xs font-bold transition border ${
              isOnline
                ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/25'
                : 'bg-amber-500/20 text-amber-300 border-amber-500/40 hover:bg-amber-500/30'
            }`}
            title={
              isSimulatedOffline
                ? 'Currently in simulated offline mode. Click to restore online sync.'
                : 'Online and synced with cloud. Click to simulate offline mode.'
            }
          >
            {isOnline ? (
              <>
                <span className="w-2 h-2 rounded-full bg-[#62cb32] animate-pulse shrink-0" />
                <span className="hidden md:inline whitespace-nowrap">Online Sync</span>
              </>
            ) : (
              <>
                <WifiOff className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span className="hidden md:inline whitespace-nowrap">Offline</span>
              </>
            )}
          </button>

          {/* Barcode Scanner Button */}
          <button
            onClick={onOpenScanner}
            className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold shadow-xs transition active:scale-95"
            title="Open Camera / Hardware Scanner"
          >
            <BarcodeIcon className="w-4 h-4 shrink-0" />
            <span className="hidden sm:inline whitespace-nowrap">Scan Barcode</span>
          </button>

          {/* Batch Print Queue Button */}
          <button
            onClick={onOpenBatchPrint}
            className="relative p-2 rounded-xl bg-emerald-950/60 hover:bg-emerald-900/80 text-emerald-200 transition border border-emerald-800/60"
            title="Open Bulk Batch Print Queue"
          >
            <Layers className="w-4 h-4" />
            {batchQueueCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white font-black text-[10px] w-5 h-5 rounded-full flex items-center justify-center shadow-xs">
                {batchQueueCount}
              </span>
            )}
          </button>

          {/* Thermal Printer Settings */}
          <button
            onClick={onOpenPrinterSettings}
            className="p-2 rounded-xl bg-emerald-950/60 hover:bg-emerald-900/80 text-emerald-200 transition border border-emerald-800/60"
            title="Configure Thermal Printer (Bluetooth/Serial/TSPL)"
          >
            <Printer className="w-4 h-4" />
          </button>

          {/* Template Designer */}
          <button
            onClick={onOpenTemplateEditor}
            className="hidden sm:flex p-2 rounded-xl bg-emerald-950/60 hover:bg-emerald-900/80 text-emerald-200 transition border border-emerald-800/60"
            title="Custom Template Studio"
          >
            <LayoutTemplate className="w-4 h-4" />
          </button>

          {/* Notification Center */}
          <button
            onClick={onOpenNotifications}
            className="relative p-2 rounded-xl bg-emerald-950/60 hover:bg-emerald-900/80 text-emerald-200 transition border border-emerald-800/60"
            title="Low-Stock Alerts & Notifications"
          >
            <Bell className="w-4 h-4" />
            {unreadAlertsCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white font-bold text-[10px] w-4 h-4 rounded-full flex items-center justify-center animate-bounce">
                {unreadAlertsCount}
              </span>
            )}
          </button>

          {/* Cloud Deploy Guide */}
          <button
            onClick={onOpenDeployGuide}
            className="hidden sm:flex p-2 rounded-xl bg-emerald-950/60 hover:bg-emerald-900/80 text-emerald-200 transition border border-emerald-800/60"
            title="Cloud Deployment (AWS, Vercel, PWA)"
          >
            <Cloud className="w-4 h-4" />
          </button>

          {/* User Profile / RBAC Switcher */}
          <button
            onClick={onOpenAuth}
            className="flex items-center gap-2 pl-1.5 pr-2 sm:pl-2 sm:pr-2.5 py-1 rounded-xl bg-emerald-950/70 hover:bg-emerald-900/80 border border-emerald-800/60 text-left transition"
            title="Switch User Role & Permissions"
          >
            <div className="w-7 h-7 rounded-lg bg-emerald-700 text-white font-bold text-xs flex items-center justify-center shrink-0">
              {currentUser.name.charAt(0)}
            </div>
            <div className="hidden xl:block">
              <div className="text-[11px] font-bold text-emerald-100 leading-tight whitespace-nowrap">
                {currentUser.name}
              </div>
              <div className="text-[9px] text-emerald-300 font-mono">
                {currentUser.role}
              </div>
            </div>
          </button>
        </div>
      </div>

      {/* Mobile & Tablet Branch Selector Sub-bar (< lg) */}
      <div className="lg:hidden border-t border-emerald-800/40 bg-emerald-950/50 px-3 sm:px-6 py-1.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <Building2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          <span className="text-[11px] text-emerald-300 font-semibold shrink-0">Branch:</span>
          <select
            value={activeStore.id}
            onChange={(e) => onSelectStore(e.target.value)}
            className="bg-emerald-900/70 border border-emerald-700/60 rounded-lg px-2 py-1 text-xs font-bold text-white focus:outline-none flex-1 max-w-xs truncate"
          >
            {stores.map((s) => (
              <option key={s.id} value={s.id} className="bg-[#0b3520] text-white">
                {s.name} ({s.code}) - {s.city}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-1.5 sm:hidden shrink-0">
          <button
            onClick={onOpenTemplateEditor}
            className="px-2 py-1 rounded-lg bg-emerald-900/70 text-emerald-200 text-[11px] font-semibold border border-emerald-700/60 flex items-center gap-1"
          >
            <LayoutTemplate className="w-3 h-3" />
            Template
          </button>
        </div>
      </div>
    </header>
  );
};
