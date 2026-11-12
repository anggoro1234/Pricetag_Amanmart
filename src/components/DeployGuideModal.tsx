import React, { useState, useEffect } from 'react';
import { 
  Cloud, 
  Copy, 
  Check, 
  X, 
  Smartphone,
  Server,
  Zap,
  Database,
  RefreshCw,
  UploadCloud,
  DownloadCloud,
  CheckCircle2,
  AlertTriangle,
  KeyRound
} from 'lucide-react';
import { supabaseService, SUPABASE_SQL_SCHEMA } from '../services/supabaseService';
import { storageService } from '../services/storageService';

interface DeployGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const DeployGuideModal: React.FC<DeployGuideModalProps> = ({ isOpen, onClose }) => {
  const [activePlatform, setActivePlatform] = useState<'supabase' | 'vercel' | 'aws' | 'pwa_mobile'>('supabase');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Supabase Config Form State
  const [supabaseUrl, setSupabaseUrl] = useState<string>('');
  const [supabaseAnonKey, setSupabaseAnonKey] = useState<string>('');
  const [connectionStatus, setConnectionStatus] = useState<{
    tested: boolean;
    ok: boolean;
    message: string;
    rowCount?: number;
  } | null>(null);
  const [isTesting, setIsTesting] = useState<boolean>(false);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [syncProgress, setSyncProgress] = useState<{ synced: number; total: number } | null>(null);
  const [showSqlSchema, setShowSqlSchema] = useState<boolean>(false);

  useEffect(() => {
    if (isOpen) {
      const cfg = supabaseService.getConfig();
      setSupabaseUrl(cfg.url || '');
      setSupabaseAnonKey(cfg.anonKey || '');
      if (cfg.url && cfg.anonKey) {
        setIsTesting(true);
        supabaseService
          .testConnection(cfg.url, cfg.anonKey)
          .then((res) => {
            setConnectionStatus({
              tested: true,
              ok: res.ok,
              message: res.message,
              rowCount: res.totalRemoteCount,
            });
          })
          .catch(() => {})
          .finally(() => setIsTesting(false));
      }
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const copyCode = (key: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleSaveAndTestSupabase = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsTesting(true);
    setConnectionStatus(null);
    try {
      supabaseService.saveConfig({
        url: supabaseUrl.trim(),
        anonKey: supabaseAnonKey.trim(),
        enabled: Boolean(supabaseUrl.trim() && supabaseAnonKey.trim()),
      });
      const res = await supabaseService.testConnection();
      setConnectionStatus({
        tested: true,
        ok: res.ok,
        message: res.message,
        rowCount: res.totalRemoteCount,
      });
    } catch (err: any) {
      setConnectionStatus({
        tested: true,
        ok: false,
        message: err?.message || 'Gagal menguji koneksi Supabase.',
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handlePushAllToSupabase = async () => {
    setIsSyncing(true);
    setSyncProgress({ synced: 0, total: storageService.getProducts().length });
    try {
      const res = await storageService.syncAllToSupabase((synced, total) => {
        setSyncProgress({ synced, total });
      });
      setConnectionStatus({
        tested: true,
        ok: res.ok,
        message: res.ok
          ? `Berhasil menyinkronkan ${res.synced.toLocaleString('id-ID')} item produk ke database Supabase!`
          : res.error || 'Gagal menyinkronkan data ke Supabase.',
        rowCount: res.synced,
      });
    } finally {
      setIsSyncing(false);
      setTimeout(() => setSyncProgress(null), 2500);
    }
  };

  const handlePullFromSupabase = async () => {
    setIsSyncing(true);
    try {
      const res = await storageService.pullAllFromSupabase();
      setConnectionStatus({
        tested: true,
        ok: res.ok,
        message: res.ok
          ? `Berhasil menarik ${res.count.toLocaleString('id-ID')} item produk dari database Supabase!`
          : res.error || 'Gagal menarik data dari Supabase.',
        rowCount: res.count,
      });
    } finally {
      setIsSyncing(false);
    }
  };

  const localProductCount = storageService.getProducts().length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-3 sm:p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl overflow-hidden border border-slate-200 flex flex-col max-h-[92vh] my-auto">
        {/* Header */}
        <div className="px-4 sm:px-6 py-4 border-b border-slate-200 bg-slate-900 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-400 flex items-center justify-center text-emerald-400 shrink-0">
              <Database className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm sm:text-base font-bold text-white truncate">
                Supabase External Database &amp; Cloud Deployment
              </h2>
              <p className="text-[11px] sm:text-xs text-slate-400 truncate">
                Integrasi Database Supabase (10.000+ Item), IndexedDB Engine, Vercel &amp; AWS
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Platform Selector Tabs */}
        <div className="flex overflow-x-auto border-b border-slate-200 bg-slate-50 px-3 sm:px-4 pt-2 gap-1.5 text-xs shrink-0">
          <button
            onClick={() => setActivePlatform('supabase')}
            className={`flex items-center gap-1.5 px-3.5 py-2 font-bold border-b-2 transition whitespace-nowrap shrink-0 ${
              activePlatform === 'supabase'
                ? 'border-emerald-600 text-emerald-700 bg-white rounded-t-lg'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            <Database className="w-3.5 h-3.5" />
            Database Supabase (10.000+ Item)
          </button>
          <button
            onClick={() => setActivePlatform('vercel')}
            className={`flex items-center gap-1.5 px-3.5 py-2 font-bold border-b-2 transition whitespace-nowrap shrink-0 ${
              activePlatform === 'vercel'
                ? 'border-black text-black bg-white rounded-t-lg'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            <Zap className="w-3.5 h-3.5" />
            Vercel (1-Click)
          </button>
          <button
            onClick={() => setActivePlatform('aws')}
            className={`flex items-center gap-1.5 px-3.5 py-2 font-bold border-b-2 transition whitespace-nowrap shrink-0 ${
              activePlatform === 'aws'
                ? 'border-orange-500 text-orange-600 bg-white rounded-t-lg'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            <Server className="w-3.5 h-3.5" />
            AWS App Runner / ECS
          </button>
          <button
            onClick={() => setActivePlatform('pwa_mobile')}
            className={`flex items-center gap-1.5 px-3.5 py-2 font-bold border-b-2 transition whitespace-nowrap shrink-0 ${
              activePlatform === 'pwa_mobile'
                ? 'border-blue-600 text-blue-600 bg-white rounded-t-lg'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            <Smartphone className="w-3.5 h-3.5" />
            Install Offline PWA
          </button>
        </div>

        {/* Content */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-4 text-xs flex-1">
          {activePlatform === 'supabase' && (
            <div className="space-y-4">
              {/* Storage Engine Banner */}
              <div className="p-3.5 bg-emerald-50 rounded-xl border border-emerald-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h4 className="font-bold text-emerald-950 text-xs sm:text-sm flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    High-Capacity Storage Aktif (IndexedDB + Supabase Cloud)
                  </h4>
                  <p className="text-emerald-800 text-[11px] mt-0.5 leading-relaxed">
                    Batas 5 MB browser <code className="bg-emerald-100 px-1 rounded">localStorage</code> telah diatasi dengan <strong>IndexedDB (&gt;100 MB)</strong> dan <strong>Batch Chunking</strong>. Saat ini tersimpan <strong>{localProductCount.toLocaleString('id-ID')} produk</strong> di perangkat ini.
                  </p>
                </div>
              </div>

              {/* Step 1: SQL Schema */}
              <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded bg-indigo-100 text-indigo-800">
                      Langkah 1
                    </span>
                    <h4 className="font-bold text-slate-800 text-xs sm:text-sm mt-1">
                      Buat Tabel di Supabase SQL Editor
                    </h4>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => copyCode('supabase-sql', SUPABASE_SQL_SCHEMA)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold text-xs transition"
                    >
                      {copiedKey === 'supabase-sql' ? (
                        <>
                          <Check className="w-3.5 h-3.5" />
                          SQL Tersalin!
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          Copy SQL Schema
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowSqlSchema((v) => !v)}
                      className="px-2.5 py-1.5 border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 rounded-lg font-semibold text-xs"
                    >
                      {showSqlSchema ? 'Sembunyikan SQL' : 'Lihat SQL'}
                    </button>
                  </div>
                </div>
                <p className="text-slate-600 text-[11px]">
                  Buka dashboard <strong>Supabase &rarr; SQL Editor &rarr; New Query</strong>, tempel (paste) SQL Schema di atas, lalu klik <strong>Run</strong>. Script SQL juga tersimpan di file <code className="bg-slate-200 px-1 py-0.5 rounded font-mono">supabase_schema.sql</code>.
                </p>
                {showSqlSchema && (
                  <pre className="bg-slate-900 text-emerald-300 p-3 rounded-xl font-mono text-[11px] overflow-x-auto max-h-48">
                    {SUPABASE_SQL_SCHEMA}
                  </pre>
                )}
              </div>

              {/* Step 2: Input API URL & Anon Key */}
              <form
                onSubmit={handleSaveAndTestSupabase}
                className="p-4 bg-white rounded-xl border border-slate-200 shadow-xs space-y-3"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-100 text-emerald-800">
                      Langkah 2
                    </span>
                    <h4 className="font-bold text-slate-800 text-xs sm:text-sm mt-1 flex items-center gap-1.5">
                      <KeyRound className="w-4 h-4 text-emerald-600" />
                      Masukkan Supabase Project URL &amp; API Key
                    </h4>
                  </div>
                </div>
                <p className="text-slate-500 text-[11px]">
                  Ambil dari <strong>Supabase Dashboard &rarr; Project Settings &rarr; API</strong>. Anda bisa memasukkannya di bawah ini langsung atau di file <code className="bg-slate-100 px-1 rounded font-mono">.env</code> (<code className="bg-slate-100 px-1 rounded font-mono">VITE_SUPABASE_URL</code> &amp; <code className="bg-slate-100 px-1 rounded font-mono">VITE_SUPABASE_ANON_KEY</code>).
                </p>

                <div className="grid grid-cols-1 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">
                      Supabase Project URL
                    </label>
                    <input
                      type="url"
                      value={supabaseUrl}
                      onChange={(e) => setSupabaseUrl(e.target.value)}
                      placeholder="https://xxxxxxxxxxxxxxxxxxxx.supabase.co"
                      className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">
                      Supabase Anon Public Key
                    </label>
                    <input
                      type="password"
                      value={supabaseAnonKey}
                      onChange={(e) => setSupabaseAnonKey(e.target.value)}
                      placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                      className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>
                </div>

                {connectionStatus && (
                  <div
                    className={`p-3 rounded-xl border flex items-start gap-2 text-xs font-medium ${
                      connectionStatus.ok
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                        : 'bg-amber-50 border-amber-200 text-amber-900'
                    }`}
                  >
                    {connectionStatus.ok ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    )}
                    <div className="flex-1">{connectionStatus.message}</div>
                  </div>
                )}

                {syncProgress && (
                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px] font-bold text-emerald-800">
                      <span>Mengirim Batch Data ke Supabase...</span>
                      <span>
                        {syncProgress.synced.toLocaleString('id-ID')} /{' '}
                        {syncProgress.total.toLocaleString('id-ID')} item (
                        {Math.round(
                          (syncProgress.synced / Math.max(1, syncProgress.total)) * 100
                        )}
                        %)
                      </span>
                    </div>
                    <div className="w-full h-2.5 bg-slate-200 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-emerald-600 transition-all duration-200"
                        style={{
                          width: `${Math.min(
                            100,
                            Math.round(
                              (syncProgress.synced / Math.max(1, syncProgress.total)) * 100
                            )
                          )}%`,
                        }}
                      />
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button
                    type="submit"
                    disabled={isTesting || isSyncing}
                    className="flex items-center gap-1.5 px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-bold text-xs transition disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isTesting ? 'animate-spin' : ''}`} />
                    {isTesting ? 'Menguji Koneksi...' : 'Simpan & Test Koneksi'}
                  </button>

                  <button
                    type="button"
                    onClick={handlePushAllToSupabase}
                    disabled={isSyncing || isTesting || !supabaseUrl.trim() || !supabaseAnonKey.trim()}
                    className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-xs transition disabled:opacity-50"
                  >
                    <UploadCloud className="w-3.5 h-3.5" />
                    Push {localProductCount.toLocaleString('id-ID')} Item ke Supabase
                  </button>

                  <button
                    type="button"
                    onClick={handlePullFromSupabase}
                    disabled={isSyncing || isTesting || !supabaseUrl.trim() || !supabaseAnonKey.trim()}
                    className="flex items-center gap-1.5 px-3.5 py-2 border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 rounded-xl font-bold text-xs transition disabled:opacity-50"
                  >
                    <DownloadCloud className="w-3.5 h-3.5" />
                    Tarik Data dari Supabase
                  </button>

                  <button
                    type="button"
                    onClick={async () => {
                      if (
                        window.confirm(
                          'Hapus seluruh data lokal lama dari browser ini agar hanya menggunakan data Supabase / Master Import?'
                        )
                      ) {
                        await storageService.clearLocalCatalog(false);
                        setConnectionStatus({
                          tested: true,
                          ok: true,
                          message:
                            'Data lokal lama berhasil dibersihkan! Silakan klik "Tarik Data dari Supabase" atau "Import Items" untuk memuat 10.112 item master.',
                        });
                      }
                    }}
                    disabled={isSyncing || isTesting}
                    className="flex items-center gap-1.5 px-3.5 py-2 border border-red-200 bg-red-50 hover:bg-red-100 text-red-700 rounded-xl font-bold text-xs transition disabled:opacity-50"
                  >
                    Bersihkan Data Lokal Lama
                  </button>
                </div>
              </form>
            </div>
          )}

          {activePlatform === 'vercel' && (
            <div className="space-y-4">
              <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200">
                <h4 className="font-bold text-slate-800 text-sm mb-1">
                  Deploying to Vercel
                </h4>
                <p className="text-slate-600 leading-relaxed">
                  The repository includes a ready-to-deploy <code className="bg-slate-200 px-1 py-0.5 rounded font-mono">vercel.json</code> configured with automatic SPA routing and asset compression.
                </p>
              </div>

              <div>
                <span className="font-bold text-slate-700 block mb-1">
                  Option 1: Deploy with Vercel CLI
                </span>
                <div className="relative bg-slate-900 text-slate-200 p-3 rounded-xl font-mono text-xs">
                  <div>npm install -g vercel</div>
                  <div>vercel deploy --prod</div>
                  <button
                    onClick={() => copyCode('vercel-cli', 'npm install -g vercel\nvercel deploy --prod')}
                    className="absolute right-2.5 top-2.5 p-1 bg-slate-800 hover:bg-slate-700 rounded text-slate-300"
                  >
                    {copiedKey === 'vercel-cli' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              <div>
                <span className="font-bold text-slate-700 block mb-1">
                  Option 2: Connect via GitHub
                </span>
                <p className="text-slate-600">
                  Push this project to a GitHub repository, visit vercel.com &rarr; &ldquo;Add New Project&rdquo;, and select the repo. Add <code className="bg-slate-100 px-1 rounded font-mono">VITE_SUPABASE_URL</code> and <code className="bg-slate-100 px-1 rounded font-mono">VITE_SUPABASE_ANON_KEY</code> in Environment Variables.
                </p>
              </div>
            </div>
          )}

          {activePlatform === 'aws' && (
            <div className="space-y-4">
              <div className="p-3.5 bg-orange-50 rounded-xl border border-orange-200 text-orange-950">
                <h4 className="font-bold text-sm mb-1">
                  Deploying to AWS Cloud (App Runner or ECS)
                </h4>
                <p className="text-xs leading-relaxed">
                  A multi-stage production <code className="bg-orange-100 px-1 py-0.5 rounded font-mono">Dockerfile</code> and NGINX reverse proxy config are pre-built in the project root.
                </p>
              </div>

              <div>
                <span className="font-bold text-slate-700 block mb-1">
                  Step 1: Build Docker Container
                </span>
                <div className="relative bg-slate-900 text-slate-200 p-3 rounded-xl font-mono text-xs">
                  <div>docker build -t aman-label-printer:latest .</div>
                  <button
                    onClick={() => copyCode('aws-docker', 'docker build -t aman-label-printer:latest .\ndocker run -p 3000:80 aman-label-printer:latest')}
                    className="absolute right-2.5 top-2.5 p-1 bg-slate-800 hover:bg-slate-700 rounded text-slate-300"
                  >
                    {copiedKey === 'aws-docker' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              <div>
                <span className="font-bold text-slate-700 block mb-1">
                  Step 2: Push to AWS ECR &amp; Deploy to App Runner
                </span>
                <div className="relative bg-slate-900 text-slate-200 p-3 rounded-xl font-mono text-xs">
                  <div># Authenticate with Amazon ECR</div>
                  <div>aws ecr get-login-password --region us-east-1 | docker login ...</div>
                  <div>docker tag aman-label-printer:latest &lt;aws_account_id&gt;.dkr.ecr.us-east-1.amazonaws.com/...</div>
                  <div>docker push ...</div>
                </div>
              </div>
            </div>
          )}

          {activePlatform === 'pwa_mobile' && (
            <div className="space-y-4">
              <div className="p-3.5 bg-blue-50 rounded-xl border border-blue-200 text-blue-950">
                <h4 className="font-bold text-sm mb-1">
                  Install as Mobile Native App (PWA)
                </h4>
                <p className="text-xs leading-relaxed">
                  This web app meets all Progressive Web App (PWA) criteria with standalone display, offline cache, and camera scanner access.
                </p>
              </div>

              <div className="space-y-2">
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                  <div className="font-bold text-slate-800">📱 Android (Chrome / Edge / Samsung)</div>
                  <div className="text-slate-600 mt-1">
                    Tap the <strong>three dots menu (&vellip;)</strong> &rarr; Select <strong>&ldquo;Add to Home screen&rdquo;</strong> or <strong>&ldquo;Install app&rdquo;</strong>.
                  </div>
                </div>

                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                  <div className="font-bold text-slate-800">🍏 iOS / iPhone / iPad (Safari)</div>
                  <div className="text-slate-600 mt-1">
                    Tap the <strong>Share button</strong> (square with arrow) &rarr; Scroll down and tap <strong>&ldquo;Add to Home Screen&rdquo;</strong>.
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 sm:px-6 py-3 border-t border-slate-200 bg-slate-50 flex justify-end shrink-0">
          <button
            onClick={onClose}
            className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl"
          >
            Tutup Panel
          </button>
        </div>
      </div>
    </div>
  );
};
