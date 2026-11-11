import React from 'react';
import { 
  ShieldCheck, 
  X, 
  CheckCircle, 
  Check,
  Ban
} from 'lucide-react';
import { User, StoreLocation } from '../types';
import { storageService } from '../services/storageService';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: User;
  onSelectUser: (user: User) => void;
  stores: StoreLocation[];
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  onSelectUser,
}) => {
  const availableUsers = storageService.getAvailableUsers();

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-2.5 sm:p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[92vh] sm:max-h-[90vh] overflow-hidden border border-slate-200 flex flex-col my-auto">
        {/* Header (Fixed / Shrink-0 so never cut off) */}
        <div className="px-4 sm:px-6 py-3.5 sm:py-4 border-b border-slate-200 bg-slate-900 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-blue-600/30 border border-blue-400 flex items-center justify-center text-blue-400 shrink-0">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm sm:text-base font-bold text-white truncate">
                Role-Based Access Control (RBAC)
              </h2>
              <p className="text-[11px] sm:text-xs text-slate-400 truncate">
                Switch user profile or verify permissions
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition shrink-0 ml-2"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Modal Body */}
        <div className="p-4 sm:p-5 space-y-4 overflow-y-auto flex-1">
          {/* Current User Card */}
          <div className="p-3 sm:p-3.5 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between gap-2">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-full bg-blue-600 text-white font-bold flex items-center justify-center text-sm shrink-0">
                {currentUser.name.charAt(0)}
              </div>
              <div className="min-w-0">
                <div className="font-bold text-sm text-slate-900 truncate">{currentUser.name}</div>
                <div className="text-xs text-slate-500 truncate">{currentUser.email}</div>
              </div>
            </div>
            <span
              className={`px-2.5 py-1 rounded-full text-[11px] font-black tracking-wide shrink-0 ${
                currentUser.role === 'ADMIN'
                  ? 'bg-purple-100 text-purple-700 border border-purple-200'
                  : currentUser.role === 'MANAGER'
                  ? 'bg-blue-100 text-blue-700 border border-blue-200'
                  : 'bg-emerald-100 text-emerald-700 border border-emerald-200'
              }`}
            >
              {currentUser.role}
            </span>
          </div>

          {/* Quick Role Switcher */}
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
              Select Authenticated Profile
            </label>
            <div className="space-y-2">
              {availableUsers.map((user) => {
                const isCurrent = user.id === currentUser.id;
                return (
                  <button
                    key={user.id}
                    onClick={() => {
                      onSelectUser(user);
                    }}
                    className={`w-full p-2.5 sm:p-3 rounded-xl border text-left flex items-center justify-between transition ${
                      isCurrent
                        ? 'border-blue-600 bg-blue-50/60 ring-2 ring-blue-500/20'
                        : 'border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <div className="min-w-0 pr-2">
                      <div className="text-xs font-bold text-slate-800 flex items-center gap-2 flex-wrap">
                        <span>{user.name}</span>
                        <span className="text-[10px] text-slate-400 font-normal">
                          ({user.role})
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500 truncate">{user.email}</div>
                    </div>
                    {isCurrent && (
                      <CheckCircle className="w-4 h-4 text-blue-600 shrink-0" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Permission Matrix */}
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
              Permissions for {currentUser.role}
            </label>
            <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 text-xs space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-700">Scan Barcodes &amp; Print Price Labels</span>
                <Check className="w-4 h-4 text-emerald-600 font-bold shrink-0" />
              </div>

              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-700">Bulk Batch Queue Management</span>
                <Check className="w-4 h-4 text-emerald-600 font-bold shrink-0" />
              </div>

              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-700">Inter-Store Stock Transfers</span>
                {currentUser.role === 'STAFF' ? (
                  <Ban className="w-4 h-4 text-red-400 shrink-0" />
                ) : (
                  <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                )}
              </div>

              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-700">Modify Retail Prices &amp; Discounts</span>
                {currentUser.role === 'ADMIN' ? (
                  <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                ) : (
                  <Ban className="w-4 h-4 text-red-400 shrink-0" />
                )}
              </div>

              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-700">Design &amp; Edit Thermal Templates</span>
                {currentUser.role === 'ADMIN' ? (
                  <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                ) : (
                  <Ban className="w-4 h-4 text-red-400 shrink-0" />
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Footer (Fixed / Shrink-0 so Done button is always accessible) */}
        <div className="px-4 sm:px-6 py-3 border-t border-slate-200 bg-slate-50 flex justify-end shrink-0">
          <button
            onClick={onClose}
            className="w-full sm:w-auto px-5 py-2 bg-slate-800 hover:bg-slate-900 text-white font-bold text-xs rounded-xl transition active:scale-95"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
