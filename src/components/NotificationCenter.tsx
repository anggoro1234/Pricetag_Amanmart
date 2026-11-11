import React from 'react';
import { 
  Bell, 
  AlertTriangle, 
  Check, 
  Trash2, 
  Printer, 
  Volume2, 
  ExternalLink,
  ShieldAlert,
  X
} from 'lucide-react';
import { LowStockAlert, Product } from '../types';
import { audioService } from '../services/audioService';

interface NotificationCenterProps {
  isOpen: boolean;
  onClose: () => void;
  alerts: LowStockAlert[];
  onMarkAsRead: (id: string) => void;
  onMarkAllAsRead: () => void;
  onClearAlerts: () => void;
  onQuickPrintFromAlert: (productSku: string) => void;
}

export const NotificationCenter: React.FC<NotificationCenterProps> = ({
  isOpen,
  onClose,
  alerts,
  onMarkAsRead,
  onMarkAllAsRead,
  onClearAlerts,
  onQuickPrintFromAlert,
}) => {
  if (!isOpen) return null;

  const unreadCount = alerts.filter((a) => !a.isRead).length;

  const requestBrowserPermission = async () => {
    if ('Notification' in window) {
      const perm = await Notification.requestPermission();
      if (perm === 'granted') {
        new Notification('Aman Label Alerts Enabled', {
          body: 'You will now receive instant push alerts for critical inventory depletion.',
          icon: '/icon-192.svg',
        });
        audioService.playPrintCompleteChime();
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-xs">
      <div className="bg-white w-full max-w-md h-full shadow-2xl flex flex-col border-l border-slate-200 animate-in slide-in-from-right duration-200">
        {/* Header */}
        <div className="p-4 border-b border-slate-200 bg-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-red-500/20 text-red-400 flex items-center justify-center border border-red-500/30">
              <Bell className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-white">Push Alert Center</h3>
                {unreadCount > 0 && (
                  <span className="bg-red-500 text-white text-[10px] font-black px-1.5 py-0.2 rounded-full">
                    {unreadCount} New
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-400">
                Real-time automated low-stock triggers
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Action Toolbar */}
        <div className="p-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between text-xs">
          <button
            onClick={requestBrowserPermission}
            className="text-blue-600 hover:text-blue-700 font-semibold flex items-center gap-1"
          >
            <ShieldAlert className="w-3.5 h-3.5" />
            Enable Browser Push
          </button>

          <div className="flex items-center gap-2">
            {unreadCount > 0 && (
              <button
                onClick={onMarkAllAsRead}
                className="text-slate-600 hover:text-slate-900 font-medium"
              >
                Mark all read
              </button>
            )}
            {alerts.length > 0 && (
              <button
                onClick={onClearAlerts}
                className="text-red-600 hover:text-red-700 font-medium"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Alerts List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {alerts.length === 0 ? (
            <div className="py-16 text-center text-slate-400 text-xs">
              <Bell className="w-8 h-8 mx-auto text-slate-300 mb-2" />
              No stock alerts at this time. All items are above safe inventory thresholds.
            </div>
          ) : (
            alerts.map((alert) => (
              <div
                key={alert.id}
                className={`p-3.5 rounded-xl border transition ${
                  alert.isRead
                    ? 'bg-slate-50/70 border-slate-200 opacity-75'
                    : 'bg-red-50/80 border-red-200 shadow-xs'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2">
                    <AlertTriangle
                      className={`w-4 h-4 mt-0.5 flex-shrink-0 ${
                        alert.isRead ? 'text-slate-400' : 'text-red-600'
                      }`}
                    />
                    <div>
                      <h4 className="text-xs font-bold text-slate-900 leading-tight">
                        {alert.productName}
                      </h4>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        {alert.storeName}
                      </div>
                    </div>
                  </div>

                  {!alert.isRead && (
                    <span className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0 mt-1" />
                  )}
                </div>

                <div className="mt-2 text-xs flex items-center justify-between text-slate-700 bg-white/70 p-2 rounded-lg border border-slate-200/50">
                  <span className="font-mono text-[11px]">
                    Stock: <strong>{alert.currentStock}</strong> (Min: {alert.minThreshold})
                  </span>
                  <span className="text-[10px] text-slate-400 font-mono">
                    {new Date(alert.timestamp).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>

                <div className="mt-2.5 flex items-center justify-between pt-2 border-t border-slate-200/60">
                  <button
                    onClick={() => onQuickPrintFromAlert(alert.sku)}
                    className="flex items-center gap-1 text-[11px] font-bold text-blue-600 hover:text-blue-700"
                  >
                    <Printer className="w-3 h-3" />
                    Print Restock Label
                  </button>

                  {!alert.isRead && (
                    <button
                      onClick={() => onMarkAsRead(alert.id)}
                      className="text-[10px] text-slate-500 hover:text-slate-800 flex items-center gap-1 font-medium"
                    >
                      <Check className="w-3 h-3" /> Mark read
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
