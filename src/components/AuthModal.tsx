import React, { useState } from 'react';
import { 
  ShieldCheck, 
  User as UserIcon, 
  Key, 
  Lock, 
  X, 
  CheckCircle, 
  Building2,
  Check,
  Ban
} from 'lucide-react';
import { User, UserRole, StoreLocation } from '../types';
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
  stores,
}) => {
  const availableUsers = storageService.getAvailableUsers();

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden border border-slate-200 flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-600/30 border border-blue-400 flex items-center justify-center text-blue-400">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">
                Role-Based Access Control (RBAC)
              </h2>
              <p className="text-xs text-slate-400">
                Switch user profile or verify permissions
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Current User Card */}
        <div className="p-6 space-y-5">
          <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-full bg-blue-600 text-white font-bold flex items-center justify-center text-sm">
                {currentUser.name.charAt(0)}
              </div>
              <div>
                <div className="font-bold text-sm text-slate-900">{currentUser.name}</div>
                <div className="text-xs text-slate-500">{currentUser.email}</div>
              </div>
            </div>
            <span
              className={`px-2.5 py-1 rounded-full text-xs font-black tracking-wide ${
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
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
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
                    className={`w-full p-3 rounded-xl border text-left flex items-center justify-between transition ${
                      isCurrent
                        ? 'border-blue-600 bg-blue-50/60 ring-2 ring-blue-500/20'
                        : 'border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <div>
                      <div className="text-xs font-bold text-slate-800 flex items-center gap-2">
                        {user.name}
                        <span className="text-[10px] text-slate-400 font-normal">
                          ({user.role})
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500">{user.email}</div>
                    </div>
                    {isCurrent && (
                      <CheckCircle className="w-4 h-4 text-blue-600 flex-shrink-0" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Permission Matrix */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
              Permissions for {currentUser.role}
            </label>
            <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 text-xs space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-slate-700">Scan Barcodes &amp; Print Price Labels</span>
                <Check className="w-4 h-4 text-emerald-600 font-bold" />
              </div>

              <div className="flex items-center justify-between">
                <span className="text-slate-700">Bulk Batch Queue Management</span>
                <Check className="w-4 h-4 text-emerald-600 font-bold" />
              </div>

              <div className="flex items-center justify-between">
                <span className="text-slate-700">Inter-Store Stock Transfers</span>
                {currentUser.role === 'STAFF' ? (
                  <Ban className="w-4 h-4 text-red-400" />
                ) : (
                  <Check className="w-4 h-4 text-emerald-600" />
                )}
              </div>

              <div className="flex items-center justify-between">
                <span className="text-slate-700">Modify Retail Prices &amp; Discounts</span>
                {currentUser.role === 'ADMIN' ? (
                  <Check className="w-4 h-4 text-emerald-600" />
                ) : (
                  <Ban className="w-4 h-4 text-red-400" />
                )}
              </div>

              <div className="flex items-center justify-between">
                <span className="text-slate-700">Design &amp; Edit Thermal Templates</span>
                {currentUser.role === 'ADMIN' ? (
                  <Check className="w-4 h-4 text-emerald-600" />
                ) : (
                  <Ban className="w-4 h-4 text-red-400" />
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-200 bg-slate-50 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 bg-slate-800 hover:bg-slate-900 text-white font-bold text-xs rounded-xl"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
