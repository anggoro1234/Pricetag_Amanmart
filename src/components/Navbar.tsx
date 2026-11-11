import React from 'react';
import { 
  Printer, 
  Barcode as BarcodeIcon, 
  Layers, 
  Bell, 
  Building2, 
  Wifi, 
  WifiOff, 
  Settings, 
  Cloud, 
  ShieldCheck,
  LayoutTemplate,
  HelpCircle
} from 'lucide-react';
import { StoreLocation, User, ThermalPrinterSettings, LabelTemplateConfig } from '../types';
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
  printerSettings,
}) => {
  return (
    <header className="bg-[#0b3520] text-white border-b border-emerald-800/40 sticky top-0 z-40 shadow-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
        {/* Brand & Title with Official Amanmart Logo */}
        <div className="flex items-center gap-3 sm:gap-4">
          <AmanmartLogo size="sm" theme="dark" showTagline={true} className="cursor-pointer hover:opacity-95 transition" />
          
          <div className="hidden xl:flex items-center gap-2 pl-3 border-l border-emerald-800/60">
            <span className="bg-emerald-500/20 text-emerald-300 text-[10px] font-extrabold px-2 py-0.5 rounded-full border border-emerald-500/30 uppercase tracking-wide">
              Shelf Label POS &amp; Sync
            </span>
          </div>
        </div>

        {/* Store Location Selector */}
        <div className="hidden lg:flex items-center gap-2 bg-emerald-950/70 px-3 py-1.5 rounded-xl border border-emerald-800/60 shadow-inner">
          <Building2 className="w-4 h-4 text-emerald-400" />
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
        <div className="flex items-center gap-2 sm:gap-2.5">
          {/* Offline / Online Sync Toggle */}
          <button
            onClick={onToggleOffline}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-bold transition border ${
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
                <span className="w-2 h-2 rounded-full bg-[#62cb32] animate-pulse" />
                <span className="hidden sm:inline">Online Sync</span>
              </>
            ) : (
              <>
                <WifiOff className="w-3.5 h-3.5 text-amber-400" />
                <span className="hidden sm:inline">Offline Mode</span>
              </>
            )}
          </button>

          {/* Barcode Scanner Button */}
          <button
            onClick={onOpenScanner}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold shadow-xs transition active:scale-95"
            title="Open Camera / Hardware Scanner"
          >
            <BarcodeIcon className="w-4 h-4" />
            <span className="hidden sm:inline">Scan Barcode</span>
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
            className="hidden md:flex p-2 rounded-xl bg-emerald-950/60 hover:bg-emerald-900/80 text-emerald-200 transition border border-emerald-800/60"
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
            className="p-2 rounded-xl bg-emerald-950/60 hover:bg-emerald-900/80 text-emerald-200 transition border border-emerald-800/60"
            title="Cloud Deployment (AWS, Vercel, PWA)"
          >
            <Cloud className="w-4 h-4" />
          </button>

          {/* User Profile / RBAC Switcher */}
          <button
            onClick={onOpenAuth}
            className="flex items-center gap-2 pl-2 pr-2.5 py-1 rounded-xl bg-emerald-950/70 hover:bg-emerald-900/80 border border-emerald-800/60 text-left transition"
            title="Switch User Role & Permissions"
          >
            <div className="w-7 h-7 rounded-lg bg-emerald-700 text-white font-bold text-xs flex items-center justify-center">
              {currentUser.name.charAt(0)}
            </div>
            <div className="hidden xl:block">
              <div className="text-[11px] font-bold text-emerald-100 leading-tight">
                {currentUser.name}
              </div>
              <div className="text-[9px] text-emerald-300 font-mono">
                {currentUser.role}
              </div>
            </div>
          </button>
        </div>
      </div>
    </header>
  );
};
