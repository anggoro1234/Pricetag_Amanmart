import React, { useState, useEffect, useRef, useCallback } from 'react';
import { BrowserMultiFormatReader } from '@zxing/library';
import {
  Camera,
  Barcode as BarcodeIcon,
  X,
  Volume2,
  Printer,
  CheckCircle2,
  AlertCircle,
  Keyboard,
  Layers,
  ClipboardPaste,
  Smartphone,
  RotateCcw,
  Database,
  RefreshCw,
  Plus,
  Minus,
  Trash2,
  ArrowRight,
  Check,
} from 'lucide-react';
import { Product, LabelTemplateConfig, StoreLocation, PrintQueueItem } from '../types';
import { storageService } from '../services/storageService';
import { audioService } from '../services/audioService';
import { LabelPreview } from './LabelPreview';

const sanitizeScanString = (raw: string): string =>
  raw.replace(/[\u0000-\u001F\u007F\u200B-\u200D\uFEFF]/g, '').trim();

const isBpomQrCode = (code: string): boolean =>
  /\(90\)\s*(?:na|nb|nc|nd|ne|md|ml|tr|qd|si|ti|sd|sl|ht|ff|dkl|gkl)/i.test(code) ||
  /^\s*(?:na|nb|nc|nd|ne|md|ml|tr)\d{7,}/i.test(code);

interface ScanSessionItem {
  id: string;
  product: Product;
  quantity: number;
  time: string;
  barcode: string;
}

interface BarcodeScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectProduct?: (product: Product) => void;
  onAddToBatchQueue?: (product: Product, quantity: number) => void;
  onQuickPrint?: (product: Product) => void;
  onOpenBatchPrint?: () => void;
  onUpdateBatchQuantity?: (id: string, delta: number) => void;
  onRemoveBatchItem?: (id: string) => void;
  batchQueue?: PrintQueueItem[];
  templates: LabelTemplateConfig[];
  activeStore: StoreLocation;
}

export const BarcodeScannerModal: React.FC<BarcodeScannerModalProps> = ({
  isOpen,
  onClose,
  onSelectProduct,
  onAddToBatchQueue,
  onQuickPrint,
  onOpenBatchPrint,
  onUpdateBatchQuantity,
  onRemoveBatchItem,
  batchQueue,
  templates,
  activeStore,
}) => {
  const [isAndroid, setIsAndroid] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? /android/i.test(navigator.userAgent) : false
  );
  const [activeTab, setActiveTab] = useState<'camera' | 'usb_wedge' | 'manual'>(() =>
    typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent) ? 'usb_wedge' : 'camera'
  );
  const [scannedBarcode, setScannedBarcode] = useState<string>('');
  const [foundProduct, setFoundProduct] = useState<Product | null>(null);
  const [printQty, setPrintQty] = useState<number>(1);
  const [isCameraActive, setIsCameraActive] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [wedgeBuffer, setWedgeBuffer] = useState<string>('');
  const [autoSubmitNoEnter, setAutoSubmitNoEnter] = useState<boolean>(true);
  const [allowVirtualKeyboard, setAllowVirtualKeyboard] = useState<boolean>(true);
  const [lastSignalInfo, setLastSignalInfo] = useState<string>('Menunggu sinyal dari scanner PDA / USB...');
  const [clipboardError, setClipboardError] = useState<string | null>(null);
  const [lastScanTime, setLastScanTime] = useState<string>('');
  const [showSuccessNotification, setShowSuccessNotification] = useState<boolean>(false);
  const [continuousScan, setContinuousScan] = useState<boolean>(true);
  const [catalogCount, setCatalogCount] = useState<number>(0);
  const [isSyncingCatalog, setIsSyncingCatalog] = useState<boolean>(false);
  const [syncStatusMsg, setSyncStatusMsg] = useState<string | null>(null);
  const [autoQueueToBatch, setAutoQueueToBatch] = useState<boolean>(true);
  const [scanSessionHistory, setScanSessionHistory] = useState<ScanSessionItem[]>([]);

  const totalBatchItems = batchQueue ? batchQueue.length : scanSessionHistory.length;
  const totalBatchLabels = batchQueue
    ? batchQueue.reduce((acc, it) => acc + (it.quantity || 1), 0)
    : scanSessionHistory.reduce((acc, it) => acc + it.quantity, 0);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const pdaInputRef = useRef<HTMLInputElement | null>(null);
  const codeReaderRef = useRef<BrowserMultiFormatReader | null>(null);
  const scanActiveRef = useRef<boolean>(false);
  const lastScanTimestampRef = useRef<number>(0);
  const lastScanCodeRef = useRef<string>('');
  const autoSubmitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const globalBurstTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleBarcodeDetectedRef = useRef<(rawCode: string, source?: string) => void>(() => {});
  const submitPdaBufferRef = useRef<(rawValue: string, source: string) => void>(() => {});
  const selectedTemplate = templates[0];

  // Subscribe to storage changes so catalogCount stays live when Supabase/Master sync finishes
  useEffect(() => {
    const updateCount = () => {
      setCatalogCount(storageService.getProducts().length);
    };
    updateCount();
    const unsub = storageService.subscribe(updateCount);
    return () => unsub();
  }, []);

  const handlePullSupabaseCatalog = useCallback(async () => {
    setIsSyncingCatalog(true);
    setSyncStatusMsg('Menarik katalog produk dari Supabase...');
    try {
      const res = await storageService.pullAllFromSupabase((loaded) => {
        setSyncStatusMsg(`Mengunduh dari Supabase: ${loaded.toLocaleString('id-ID')} item...`);
      });
      setCatalogCount(storageService.getProducts().length);
      if (res.ok) {
        setSyncStatusMsg(`Berhasil menarik ${res.count.toLocaleString('id-ID')} item dari Supabase!`);
      } else {
        setSyncStatusMsg(res.error || 'Gagal menarik data Supabase.');
      }
    } catch (err: any) {
      setSyncStatusMsg(err?.message || 'Error koneksi Supabase.');
    } finally {
      setIsSyncingCatalog(false);
    }
  }, []);

  const handleLoadMasterCatalogLocal = useCallback(async () => {
    setIsSyncingCatalog(true);
    setSyncStatusMsg('Memuat 10.112 item Master CSV langsung ke PDA...');
    try {
      const { count } = await storageService.loadBundledMasterCsv(activeStore.id, false);
      setCatalogCount(storageService.getProducts().length);
      setSyncStatusMsg(`Berhasil memuat ${count.toLocaleString('id-ID')} item Master ke PDA!`);
    } catch (err: any) {
      setSyncStatusMsg(err?.message || 'Gagal memuat Master CSV.');
    } finally {
      setIsSyncingCatalog(false);
    }
  }, [activeStore.id]);

  // Detect Android / Mobile Data Terminal and sync catalog count on modal open
  useEffect(() => {
    const androidDevice = typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent);
    setIsAndroid(androidDevice);
    if (isOpen) {
      const currentLen = storageService.getProducts().length;
      setCatalogCount(currentLen);
      if (androidDevice) {
        setActiveTab('usb_wedge');
      }
    } else {
      if (autoSubmitTimerRef.current) {
        clearTimeout(autoSubmitTimerRef.current);
        autoSubmitTimerRef.current = null;
      }
      if (globalBurstTimerRef.current) {
        clearTimeout(globalBurstTimerRef.current);
        globalBurstTimerRef.current = null;
      }
    }
  }, [isOpen]);

  // Keep PDA capture input focused when Hardware PDA / USB tab is active
  const focusPdaInput = useCallback(() => {
    if (!isOpen || activeTab !== 'usb_wedge') return;
    requestAnimationFrame(() => {
      if (pdaInputRef.current && document.activeElement !== pdaInputRef.current) {
        pdaInputRef.current.focus({ preventScroll: true });
      }
    });
  }, [isOpen, activeTab]);

  useEffect(() => {
    if (!isOpen || activeTab !== 'usb_wedge') return;
    const t = setTimeout(focusPdaInput, 60);
    const handleWindowFocus = () => focusPdaInput();
    const handleVisibility = () => {
      if (!document.hidden) focusPdaInput();
    };
    window.addEventListener('focus', handleWindowFocus);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      clearTimeout(t);
      window.removeEventListener('focus', handleWindowFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [isOpen, activeTab, focusPdaInput]);

  // Capture Android WebKit/Chromium 'textInput' events on PDA input for OEM ScanWedge IME commits
  useEffect(() => {
    const inputEl = pdaInputRef.current;
    if (!isOpen || activeTab !== 'usb_wedge' || !inputEl) return;

    const handleNativeTextInput = (ev: Event) => {
      const data = (ev as unknown as { data?: string }).data;
      if (!data) return;
      if (/[\r\n\t]/.test(data)) {
        setTimeout(() => {
          const val = pdaInputRef.current?.value || data;
          submitPdaBufferRef.current(val, 'PDA TextInput+Enter');
        }, 0);
      } else {
        setLastSignalInfo(`TextInput(${data.length}): "${sanitizeScanString(data)}"`);
      }
    };

    inputEl.addEventListener('textInput', handleNativeTextInput);
    return () => {
      inputEl.removeEventListener('textInput', handleNativeTextInput);
    };
  }, [isOpen, activeTab]);

  // Hardware USB / Android PDA Global Capture Listener (capture phase)
  // Menangkap HID keyboard maupun Android KeyEvent apabila fokus sempat lepas dari kotak input
  useEffect(() => {
    if (!isOpen) return;

    let buffer = '';
    let lastKeyTime = Date.now();

    const mapFallbackKeyChar = (e: KeyboardEvent): string => {
      if (e.key && e.key.length === 1) return e.key;
      const kc = e.keyCode || e.which;
      if (kc >= 48 && kc <= 57) return String.fromCharCode(kc);
      if (kc >= 96 && kc <= 105) return String.fromCharCode(kc - 48);
      if (kc >= 65 && kc <= 90) return String.fromCharCode(kc);
      if (kc === 189 || kc === 109) return '-';
      return '';
    };

    const flushGlobalBuffer = (source: string) => {
      if (globalBurstTimerRef.current) {
        clearTimeout(globalBurstTimerRef.current);
        globalBurstTimerRef.current = null;
      }
      const code = sanitizeScanString(buffer);
      buffer = '';
      if (code.length >= 3) {
        handleBarcodeDetectedRef.current(code, source);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      // Jika fokus berada di PDA capture input atau input lain, biarkan handler input tersebut memprosesnya
      if (
        target &&
        (target === pdaInputRef.current ||
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT')
      ) {
        return;
      }

      const now = Date.now();
      const diff = now - lastKeyTime;
      lastKeyTime = now;
      const kc = e.keyCode || e.which;

      if (e.key === 'Enter' || e.key === 'Tab' || e.key === 'NumpadEnter' || kc === 13 || kc === 66) {
        if (buffer.length >= 3) {
          e.preventDefault();
          e.stopPropagation();
          flushGlobalBuffer(`Global Key (${e.key || kc})`);
        } else {
          buffer = '';
        }
        return;
      }

      const ch = mapFallbackKeyChar(e);
      if (!ch) {
        if (e.key === 'Unidentified' || kc === 229) {
          setLastSignalInfo(`Global Unidentified (code=${kc}) - memfokuskan kotak scan...`);
          if (activeTab === 'usb_wedge') {
            pdaInputRef.current?.focus({ preventScroll: true });
          }
        }
        return;
      }

      if (diff > 200 && buffer.length > 0) {
        buffer = '';
      }

      buffer += ch;
      setLastSignalInfo(`Global KeyBurst: "${buffer}"`);

      if (globalBurstTimerRef.current) {
        clearTimeout(globalBurstTimerRef.current);
      }
      globalBurstTimerRef.current = setTimeout(() => {
        if (buffer.length >= 4) {
          flushGlobalBuffer('Global Auto-Capture');
        }
      }, 200);
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      if (globalBurstTimerRef.current) {
        clearTimeout(globalBurstTimerRef.current);
        globalBurstTimerRef.current = null;
      }
    };
  }, [isOpen, activeTab]);

  // Camera Barcode Scanning with ZXing
  useEffect(() => {
    if (!isOpen || activeTab !== 'camera') {
      stopCamera();
      return;
    }

    startCamera();

    return () => {
      stopCamera();
    };
  }, [isOpen, activeTab]);

  const startCamera = async () => {
    setCameraError(null);
    setIsCameraActive(true);
    scanActiveRef.current = true;

    try {
      const codeReader = new BrowserMultiFormatReader();
      codeReaderRef.current = codeReader;

      const videoInputDevices = await codeReader.listVideoInputDevices();
      if (videoInputDevices.length === 0) {
        setCameraError('Tidak ada kamera yang terdeteksi di perangkat ini.');
        setIsCameraActive(false);
        scanActiveRef.current = false;
        return;
      }

      // Prefer back/environment camera for barcode scanning (crucial for Android handhelds)
      const backCamera = videoInputDevices.find(
        (dev) =>
          dev.label.toLowerCase().includes('back') ||
          dev.label.toLowerCase().includes('rear') ||
          dev.label.toLowerCase().includes('environment')
      ) || videoInputDevices[0];

      if (videoRef.current && scanActiveRef.current) {
        codeReader.decodeFromVideoDevice(
          backCamera.deviceId,
          videoRef.current,
          (result, error) => {
            if (result && scanActiveRef.current) {
              const text = result.getText();
              handleBarcodeDetected(text);
              // If continuous scan is off, stop after first successful read
              if (!continuousScan) {
                stopCamera();
              }
            } else if (error && scanActiveRef.current) {
              // Log ZXing errors but don't crash - common on Android WebView
              console.warn('ZXing decode warning:', error?.message || error);
            }
          }
        );
      }
    } catch (err: any) {
      console.warn('Camera access error:', err);
      const msg = err.message || 'Camera access not permitted or unavailable.';

      // Android-specific error messages
      let userMsg = msg;
      if (msg.includes('NotAllowedError') || msg.includes('PermissionDenied')) {
        userMsg = 'Izin kamera ditolak. Silakan izinkan akses kamera di browser Android Anda.';
      } else if (msg.includes('NotFoundError') || msg.includes('DevicesNotFound')) {
        userMsg = 'Kamera tidak ditemukan. Pastikan perangkat Anda memiliki kamera.';
      } else if (msg.includes('NotSupportedError') || msg.includes('ConstraintNotSatisfied')) {
        userMsg = 'Kamera tidak didukung di browser ini. Coba gunakan Chrome atau Edge di Android.';
      } else if (msg.includes('NotReadableError') || msg.includes('TrackStartError')) {
        userMsg = 'Kamera sedang digunakan aplikasi lain. Tutup aplikasi kamera lain dan coba lagi.';
      }

      setCameraError(userMsg);
      setIsCameraActive(false);
      scanActiveRef.current = false;
    }
  };

  const stopCamera = () => {
    if (codeReaderRef.current) {
      codeReaderRef.current.reset();
      codeReaderRef.current = null;
    }
    setIsCameraActive(false);
    scanActiveRef.current = false;
  };

  const handleBarcodeDetected = (rawCode: string, source: string = 'Scanner') => {
    const code = sanitizeScanString(rawCode);
    if (!code) return;

    // Debounce hanya untuk kode IDENTIK dalam 1.2 detik agar scan berurutan barang berbeda tetap instan
    const now = Date.now();
    if (code === lastScanCodeRef.current && now - lastScanTimestampRef.current < 1200) {
      return;
    }
    lastScanTimestampRef.current = now;
    lastScanCodeRef.current = code;

    const timeStr = new Date().toLocaleTimeString();
    setLastSignalInfo(`${source}: "${code}" (${timeStr})`);
    audioService.playScanBeep();
    setScannedBarcode(code);
    setLastScanTime(timeStr);

    const productsLen = storageService.getProducts().length;
    setCatalogCount(productsLen);

    const product = storageService.findProductByBarcode(code);
    if (product) {
      setFoundProduct(product);
      setShowSuccessNotification(true);
      setTimeout(() => setShowSuccessNotification(false), 2500);

      // Dual Behavior:
      // 1. Simpan & antrekan produk ke antrean Bulk Batch Print otomatis tanpa pop-up redirect
      if (autoQueueToBatch) {
        if (onAddToBatchQueue) {
          onAddToBatchQueue(product, 1);
        } else if (onSelectProduct) {
          onSelectProduct(product);
        }
      } else if (onSelectProduct) {
        onSelectProduct(product);
      }

      // 2. Simpan & perbarui riwayat produk yang terscan pada interface terminal PDA
      const scanTimeStr = new Date().toLocaleTimeString();
      setScanSessionHistory((prev) => {
        const existIdx = prev.findIndex((item) => item.product.id === product.id);
        if (existIdx >= 0) {
          const updated = [...prev];
          updated[existIdx] = {
            ...updated[existIdx],
            quantity: updated[existIdx].quantity + 1,
            time: scanTimeStr,
          };
          const [moved] = updated.splice(existIdx, 1);
          return [moved, ...updated];
        }
        return [
          {
            id: `scan-${Date.now()}-${product.id}`,
            product,
            quantity: 1,
            time: scanTimeStr,
            barcode: code,
          },
          ...prev,
        ];
      });

      setLastSignalInfo(`✅ ${product.name} (+1 ke antrean batch) (${timeStr})`);

      if (!continuousScan && scanActiveRef.current) {
        stopCamera();
      }
    } else {
      setFoundProduct(null);
      audioService.playErrorTone();
    }
  };

  handleBarcodeDetectedRef.current = handleBarcodeDetected;

  const submitPdaBuffer = useCallback(
    (rawValue: string, source: string) => {
      if (autoSubmitTimerRef.current) {
        clearTimeout(autoSubmitTimerRef.current);
        autoSubmitTimerRef.current = null;
      }
      const clean = sanitizeScanString(rawValue);
      if (pdaInputRef.current) {
        pdaInputRef.current.value = '';
      }
      if (clean.length >= 2) {
        handleBarcodeDetectedRef.current(clean, source);
      }
      focusPdaInput();
    },
    [focusPdaInput]
  );

  submitPdaBufferRef.current = submitPdaBuffer;

  const handlePdaInputChange = (rawValue: string) => {
    setClipboardError(null);
    // Jika PDA menyisipkan terminator CR/LF/Tab di dalam teks (commitText)
    if (/[\r\n\t]/.test(rawValue)) {
      submitPdaBuffer(rawValue, 'PDA Scan (Terminator)');
      return;
    }

    const clean = sanitizeScanString(rawValue);
    if (clean.length > 0) {
      setLastSignalInfo(`Input PDA(${clean.length}): "${clean}"`);
    }

    // Auto-submit untuk PDA Android yang TIDAK mengirim tombol Enter setelah scan selesai
    if (autoSubmitTimerRef.current) {
      clearTimeout(autoSubmitTimerRef.current);
      autoSubmitTimerRef.current = null;
    }

    if (autoSubmitNoEnter && clean.length >= 4) {
      autoSubmitTimerRef.current = setTimeout(() => {
        const liveVal = pdaInputRef.current?.value || clean;
        submitPdaBuffer(liveVal, 'PDA Auto-Capture');
      }, 180);
    }
  };

  const handlePasteClipboard = async () => {
    setClipboardError(null);
    try {
      if (!navigator.clipboard?.readText) {
        setClipboardError('Browser tidak mendukung baca clipboard langsung. Gunakan Paste manual di kotak input.');
        return;
      }
      const clipText = await navigator.clipboard.readText();
      const clean = sanitizeScanString(clipText || '');
      if (!clean) {
        setClipboardError('Clipboard kosong. Pastikan hasil scan PDA tersalin terlebih dahulu.');
        return;
      }
      submitPdaBuffer(clean, 'Clipboard PDA');
    } catch {
      setClipboardError('Izin akses clipboard ditolak browser. Ketuk kotak input PDA di atas lalu pilih Paste.');
    }
  };

  if (!isOpen) return null;

  const catalogSyncBanner =
    catalogCount <= 50 || syncStatusMsg ? (
      <div className="border border-red-200 bg-red-50 rounded-xl p-3.5 space-y-2">
        {catalogCount <= 50 && (
          <>
            <div className="text-xs font-bold text-red-800">
              Katalog di Perangkat Ini Baru {catalogCount.toLocaleString('id-ID')} Item (Belum 10.000+ Item)
            </div>
            <p className="text-xs text-red-700">
              Scan produk toko tidak akan ketemu sebelum data master dimuat ke browser PDA ini. Ketuk salah satu tombol di bawah:
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={isSyncingCatalog}
                onClick={handlePullSupabaseCatalog}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-xs font-semibold rounded-lg transition"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isSyncingCatalog ? 'animate-spin' : ''}`} />
                Tarik Data Supabase
              </button>
              <button
                type="button"
                disabled={isSyncingCatalog}
                onClick={handleLoadMasterCatalogLocal}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-xs font-semibold rounded-lg transition"
              >
                <Database className="w-3.5 h-3.5" />
                Muat Master 10.112 Item ke PDA
              </button>
            </div>
          </>
        )}
        {syncStatusMsg && (
          <p className="text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded px-2.5 py-1.5">
            {syncStatusMsg}
          </p>
        )}
      </div>
    ) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden border border-slate-200 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 bg-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-600/30 border border-blue-400 flex items-center justify-center text-blue-400">
              <BarcodeIcon className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Barcode Scanner &amp; Quick Lookup</h2>
              <p className="text-xs text-slate-400">
                Direct camera feed &amp; USB hardware scanner wedge listener
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex overflow-x-auto border-b border-slate-200 bg-slate-50 px-3 sm:px-4 pt-2 gap-1 sm:gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('usb_wedge')}
            className={`flex items-center gap-1.5 px-3 sm:px-4 py-2 text-xs sm:text-sm font-semibold border-b-2 whitespace-nowrap transition ${
              activeTab === 'usb_wedge'
                ? 'border-emerald-600 text-emerald-700 bg-white rounded-t-lg'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Smartphone className="w-4 h-4" />
            PDA / USB Scanner
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('camera')}
            className={`flex items-center gap-1.5 px-3 sm:px-4 py-2 text-xs sm:text-sm font-semibold border-b-2 whitespace-nowrap transition ${
              activeTab === 'camera'
                ? 'border-blue-600 text-blue-600 bg-white rounded-t-lg'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Camera className="w-4 h-4" />
            Camera Scanner
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('manual')}
            className={`flex items-center gap-1.5 px-3 sm:px-4 py-2 text-xs sm:text-sm font-semibold border-b-2 whitespace-nowrap transition ${
              activeTab === 'manual'
                ? 'border-blue-600 text-blue-600 bg-white rounded-t-lg'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <BarcodeIcon className="w-4 h-4" />
            Manual / Test
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 overflow-y-auto space-y-4 flex-1">
          {/* Tab 1: Camera Scanner */}
          {activeTab === 'camera' && (
            <div className="space-y-3">
              <div className="relative rounded-xl overflow-hidden bg-black aspect-video max-h-64 flex items-center justify-center border border-slate-700">
                <video
                  ref={videoRef}
                  className="w-full h-full object-cover"
                  playsInline
                  autoPlay
                  muted
                  disablePictureInPicture
                  style={{ transform: isAndroid ? 'scaleX(-1)' : 'scaleX(1)' }}
                />

                {/* Reticle Overlay */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="w-64 h-32 border-2 border-dashed border-red-500 rounded-lg relative">
                    <div className="absolute top-1/2 left-0 right-0 h-0.5 bg-red-500/80 animate-pulse" />
                    <span className="absolute -top-6 left-1/2 -translate-x-1/2 text-[11px] bg-black/70 text-white px-2 py-0.5 rounded-full whitespace-nowrap">
                      Align Barcode Inside Box
                    </span>
                  </div>
                </div>

                {cameraError && (
                  <div className="absolute inset-0 bg-slate-900/90 flex flex-col items-center justify-center p-4 text-center">
                    <AlertCircle className="w-8 h-8 text-amber-400 mb-2" />
                    <p className="text-sm text-slate-200 font-medium mb-3">{cameraError}</p>
                    <div className="flex flex-col gap-2 w-full">
                      <button
                        onClick={() => startCamera()}
                        className="px-3 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded-lg hover:bg-blue-700"
                      >
                        Coba Lagi Kamera
                      </button>
                      <button
                        onClick={() => setActiveTab('usb_wedge')}
                        className="px-3 py-1.5 bg-emerald-600 text-white text-xs font-semibold rounded-lg hover:bg-emerald-700"
                      >
                        Gunakan Hardware Scanner (USB Wedge)
                      </button>
                      <button
                        onClick={() => setActiveTab('manual')}
                        className="px-3 py-1.5 bg-slate-600 text-white text-xs font-semibold rounded-lg hover:bg-slate-700"
                      >
                        Input Manual / Test Barcode
                      </button>
                    </div>
                    {isAndroid && (
                      <p className="text-xs text-slate-400 mt-2 text-center">
                        Tip Android: Jika kamera tidak bekerja, gunakan tombol scan fisik pada handheld scanner Anda (mode USB Wedge) atau input manual barcode.
                      </p>
                    )}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between gap-4 text-xs text-slate-500">
                <div className="flex items-center gap-2">
                  <span>Supports EAN-13, Code 128, UPC, QR</span>
                  {isAndroid && (
                    <span className="flex items-center gap-1 px-2 py-0.5 bg-blue-50 text-blue-700 rounded border border-blue-100 text-[10px]">
                      Android Mode Active
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={continuousScan}
                      onChange={(e) => setContinuousScan(e.target.checked)}
                      className="w-3 h-3 rounded text-blue-600 focus:ring-blue-500"
                    />
                    <span>Scan Berulang</span>
                  </label>
                  <span className="flex items-center gap-1">
                    <Volume2 className="w-3.5 h-3.5 text-blue-500" /> Beep
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Tab 2: Hardware USB / Bluetooth / Android Data Terminal (PDA) Capture */}
          {activeTab === 'usb_wedge' && (
            <div
              onClick={focusPdaInput}
              className="bg-slate-50 border border-slate-200 rounded-xl p-4 sm:p-5 space-y-4"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-full bg-emerald-100 border border-emerald-300 text-emerald-600 flex items-center justify-center flex-shrink-0">
                    <Keyboard className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm sm:text-base font-bold text-slate-800">
                      PDA Data Terminal &amp; USB Scanner Ready
                    </h3>
                    <p className="text-xs text-slate-600">
                      Mendukung Android IME / ScanWedge, Keyboard Wedge USB, &amp; auto-submit tanpa tombol Enter.
                    </p>
                  </div>
                </div>
                <span
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold whitespace-nowrap self-start sm:self-center ${
                    catalogCount > 0
                      ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                      : 'bg-amber-100 text-amber-800 border border-amber-200'
                  }`}
                >
                  Katalog: {catalogCount.toLocaleString('id-ID')} item
                </span>
              </div>

              {/* Batch Queue Status Header Banner */}
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-xs">
                    <Layers className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-bold text-emerald-950">
                        Antrean Batch: {totalBatchLabels} Label ({totalBatchItems} Produk)
                      </span>
                      <span className="text-[10px] bg-emerald-200/80 text-emerald-900 font-semibold px-2 py-0.5 rounded-full">
                        Auto-Queue Aktif
                      </span>
                    </div>
                    <p className="text-[11px] text-emerald-700 truncate">
                      Barcode yang discan otomatis diantrekan &amp; tersimpan di terminal PDA ini.
                    </p>
                  </div>
                </div>

                {onOpenBatchPrint && (
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenBatchPrint();
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition shadow-xs shrink-0"
                  >
                    <span>Buka Cetak Batch ({totalBatchItems})</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Dedicated Focusable Capture Input (Uncontrolled DOM ref + inputMode="text" default so Android DT338b ScanWedge IME CommitText works reliably) */}
              <div className="bg-white border-2 border-emerald-500 rounded-xl p-3 shadow-xs space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <label
                    htmlFor="pda-capture-input"
                    className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-emerald-700"
                  >
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
                    Kotak Tangkap Scan (Tetap Aktif &amp; Terfokus)
                  </label>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={(e) => {
                      e.stopPropagation();
                      setAllowVirtualKeyboard((prev) => !prev);
                      focusPdaInput();
                    }}
                    className="text-[11px] font-semibold text-blue-600 hover:text-blue-800 underline"
                  >
                    {allowVirtualKeyboard ? 'Mode PDA: Teks/IME (Sembunyikan Keyboard)' : 'Mode PDA: None (Aktifkan Teks/IME)'}
                  </button>
                </div>

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const liveVal = pdaInputRef.current?.value || '';
                    submitPdaBuffer(liveVal, 'PDA Form Submit');
                  }}
                  className="flex flex-col sm:flex-row gap-2"
                >
                  <input
                    id="pda-capture-input"
                    ref={pdaInputRef}
                    type="text"
                    defaultValue=""
                    inputMode={allowVirtualKeyboard ? 'text' : 'none'}
                    enterKeyHint="search"
                    autoFocus
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    placeholder="Arahkan laser PDA ke barcode & tekan tombol orange..."
                    onInput={(e) => handlePdaInputChange((e.target as HTMLInputElement).value)}
                    onCompositionEnd={(e) => {
                      const val = (e.currentTarget as HTMLInputElement).value;
                      if (val) {
                        handlePdaInputChange(val);
                      }
                    }}
                    onPaste={(e) => {
                      const pasted = e.clipboardData?.getData('text') || '';
                      if (pasted) {
                        e.preventDefault();
                        submitPdaBuffer(pasted, 'PDA Paste Event');
                      }
                    }}
                    onKeyDown={(e) => {
                      const kc = e.keyCode || e.which;
                      if (e.key === 'Enter' || e.key === 'Tab' || e.key === 'NumpadEnter' || kc === 13 || kc === 66) {
                        e.preventDefault();
                        submitPdaBuffer(e.currentTarget.value, `PDA Key (${e.key || kc})`);
                      } else if (e.key === 'Unidentified' || kc === 229) {
                        setLastSignalInfo(`IME KeyDown(229) terdeteksi, membaca input...`);
                      }
                    }}
                    onBlur={() => {
                      setTimeout(() => {
                        if (!isOpen || activeTab !== 'usb_wedge') return;
                        const active = document.activeElement as HTMLElement | null;
                        if (!active || active === document.body) {
                          focusPdaInput();
                        }
                      }, 80);
                    }}
                    className="flex-1 px-3 py-2.5 bg-slate-50 border border-slate-300 rounded-lg text-sm font-mono text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:bg-white focus:outline-none"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={(e) => {
                        e.stopPropagation();
                        focusPdaInput();
                      }}
                      className="flex items-center justify-center gap-1 px-3 py-2 bg-slate-100 hover:bg-slate-200 border border-slate-300 text-slate-700 text-xs font-semibold rounded-lg transition"
                      title="Fokuskan ulang kotak scan PDA"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      Fokus
                    </button>
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={(e) => {
                        e.stopPropagation();
                        handlePasteClipboard();
                      }}
                      className="flex items-center justify-center gap-1 px-3 py-2 bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-700 text-xs font-semibold rounded-lg transition"
                      title="Tempel hasil scan jika PDA disetel ke mode Clipboard"
                    >
                      <ClipboardPaste className="w-3.5 h-3.5" />
                      Tempel Clipboard
                    </button>
                  </div>
                </form>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-[11px] text-slate-600">
                  <div className="flex flex-wrap items-center gap-3">
                    <label
                      className="flex items-center gap-1.5 cursor-pointer font-medium text-emerald-800"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        checked={autoQueueToBatch}
                        onChange={(e) => setAutoQueueToBatch(e.target.checked)}
                        className="w-3.5 h-3.5 rounded text-emerald-600 focus:ring-emerald-500"
                      />
                      <span>Auto-Queue ke Antrean Batch (tanpa popup)</span>
                    </label>
                    <label
                      className="flex items-center gap-1.5 cursor-pointer"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        checked={autoSubmitNoEnter}
                        onChange={(e) => setAutoSubmitNoEnter(e.target.checked)}
                        className="w-3.5 h-3.5 rounded text-emerald-600 focus:ring-emerald-500"
                      />
                      <span>Auto-scan tanpa tombol Enter</span>
                    </label>
                  </div>
                  <span className="font-mono text-[10px] text-slate-500 truncate max-w-full">
                    Sinyal: {lastSignalInfo}
                  </span>
                </div>

                {clipboardError && (
                  <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2.5 py-1.5">
                    {clipboardError}
                  </p>
                )}
              </div>

              {/* Android Data Terminal Setup Guide */}
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-3.5 text-left space-y-1.5">
                <p className="text-xs text-blue-900 font-bold">
                  Wajib Cek Pengaturan Bawaan Android Data Terminal (Jika Sinyal Tetap Kosong):
                </p>
                <ol className="text-xs text-blue-800 list-decimal pl-4 space-y-1">
                  <li>
                    Buka aplikasi scanner bawaan PDA (<strong>Scan Setting / ScanWedge / DataWedge / Scanner</strong>).
                  </li>
                  <li>
                    Ubah <strong>Output Mode</strong> dari <code className="bg-blue-100 px-1 rounded">Broadcast / Intent</code> menjadi{' '}
                    <strong>Keyboard Output / Focus Input / Analog Keyboard / Keystroke Output</strong> (browser web tidak dapat membaca Android Intent langsung).
                  </li>
                  <li>
                    Aktifkan <strong>Terminator / Suffix = Enter</strong> (opsional, karena sistem sudah mendukung <em>Auto-scan tanpa Enter</em>) lalu ketuk kotak hijau di atas sebelum menekan tombol orange.
                  </li>
                </ol>
              </div>
            </div>
          )}

          {/* Tab 3: Manual Input & One-Click Test Emulators */}
          {activeTab === 'manual' && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                  Type or Paste Barcode / SKU
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="e.g. 089686010015 or 1001040"
                    value={wedgeBuffer}
                    onChange={(e) => {
                      const raw = e.target.value;
                      if (/[\r\n\t]/.test(raw)) {
                        const clean = sanitizeScanString(raw);
                        setWedgeBuffer('');
                        if (clean) handleBarcodeDetected(clean, 'Manual Terminator');
                      } else {
                        setWedgeBuffer(raw);
                      }
                    }}
                    onPaste={(e) => {
                      const pasted = e.clipboardData?.getData('text') || '';
                      if (pasted) {
                        e.preventDefault();
                        const clean = sanitizeScanString(pasted);
                        setWedgeBuffer(clean);
                        if (clean) handleBarcodeDetected(clean, 'Manual Paste');
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === 'Tab') {
                        e.preventDefault();
                        handleBarcodeDetected(wedgeBuffer, 'Manual Input');
                      }
                    }}
                    className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => handleBarcodeDetected(wedgeBuffer, 'Manual Lookup')}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition"
                  >
                    Lookup
                  </button>
                </div>
              </div>

              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500 block mb-2">
                  Quick Click Test Barcodes (From Attached Example)
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    onClick={() => handleBarcodeDetected('089686010015')}
                    className="flex items-center justify-between p-2.5 rounded-lg border border-slate-200 hover:border-blue-400 hover:bg-blue-50 text-left transition"
                  >
                    <div>
                      <div className="text-xs font-bold text-slate-800">Indomie Ayam Bawang 69g</div>
                      <div className="text-[11px] font-mono text-slate-500">089686010015 (SKU: 1001040)</div>
                    </div>
                    <span className="text-xs font-bold text-red-600">Rp 2.900</span>
                  </button>

                  <button
                    onClick={() => handleBarcodeDetected('089686010046')}
                    className="flex items-center justify-between p-2.5 rounded-lg border border-slate-200 hover:border-blue-400 hover:bg-blue-50 text-left transition"
                  >
                    <div>
                      <div className="text-xs font-bold text-slate-800">Indomie Ayam Spesial 75g</div>
                      <div className="text-[11px] font-mono text-slate-500">089686010046 (SKU: 1001041)</div>
                    </div>
                    <span className="text-xs font-bold text-red-600">Rp 2.900</span>
                  </button>

                  <button
                    onClick={() => handleBarcodeDetected('8992761011124')}
                    className="flex items-center justify-between p-2.5 rounded-lg border border-slate-200 hover:border-blue-400 hover:bg-blue-50 text-left transition"
                  >
                    <div>
                      <div className="text-xs font-bold text-slate-800">Ultra Milk Full Cream 1L</div>
                      <div className="text-[11px] font-mono text-slate-500">8992761011124 (SKU: 1002011)</div>
                    </div>
                    <span className="text-xs font-bold text-slate-900">Rp 21.500</span>
                  </button>

                  <button
                    onClick={() => handleBarcodeDetected('8998866200234')}
                    className="flex items-center justify-between p-2.5 rounded-lg border border-slate-200 hover:border-blue-400 hover:bg-blue-50 text-left transition"
                  >
                    <div>
                      <div className="text-xs font-bold text-slate-800">Aqua Air Mineral 600ml</div>
                      <div className="text-[11px] font-mono text-slate-500">8998866200234 (SKU: 1003055)</div>
                    </div>
                    <span className="text-xs font-bold text-slate-900">Rp 3.500</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Scanned Result Card */}
          {foundProduct ? (
            <div className="border border-emerald-200 bg-emerald-50/50 rounded-xl p-4 space-y-3">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0" />
                  <div>
                    <span className="text-xs font-bold uppercase tracking-wider text-emerald-700">
                      Product Identified
                    </span>
                    <h4 className="text-sm font-bold text-slate-900 leading-tight">
                      {foundProduct.name}
                    </h4>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-black text-red-600">
                    {foundProduct.currency} {foundProduct.pricing.unitPrice.toLocaleString('id-ID')}
                  </div>
                  <div className="text-[10px] text-slate-500">
                    Stock: {foundProduct.stocks[activeStore.id]?.quantity ?? 0} units
                  </div>
                </div>
              </div>

              {/* Exact Tag Preview */}
              <div className="flex justify-center p-2 bg-white rounded-lg border border-slate-200 shadow-inner overflow-x-auto">
                <LabelPreview
                  product={foundProduct}
                  template={selectedTemplate}
                  store={activeStore}
                  scale={1.1}
                />
              </div>

              {/* Quick Actions */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-emerald-200">
                <div className="flex items-center gap-2">
                  <label className="text-xs text-slate-600 font-medium">Quantity:</label>
                  <input
                    type="number"
                    min="1"
                    max="1000"
                    value={printQty}
                    onChange={(e) => setPrintQty(Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-16 px-2 py-1 border border-slate-300 rounded text-center text-xs font-bold"
                  />
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      if (onAddToBatchQueue) {
                        onAddToBatchQueue(foundProduct, printQty);
                        audioService.playPrintCompleteChime();
                      }
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-xs font-semibold transition"
                  >
                    <Layers className="w-3.5 h-3.5" />
                    + Tambah ({printQty}) ke Antrean
                  </button>

                  <button
                    onClick={() => {
                      if (onQuickPrint) {
                        onQuickPrint(foundProduct);
                      }
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold transition shadow-sm"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    Print Now
                  </button>
                </div>
              </div>
            </div>
          ) : scannedBarcode ? (
            <div className="border border-amber-200 bg-amber-50 rounded-xl p-4 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div className="space-y-2 flex-1 min-w-0">
                <div className="text-xs font-bold text-amber-900 break-all">
                  Barcode Not Found: {scannedBarcode} {lastScanTime ? `(${lastScanTime})` : ''}
                </div>
                <div className="text-xs text-amber-800">
                  No matching product in inventory catalog ({catalogCount.toLocaleString('id-ID')} items loaded) for code &ldquo;{scannedBarcode}&rdquo;.
                </div>

                {isBpomQrCode(scannedBarcode) && (
                  <div className="bg-white border border-amber-300 rounded-lg p-2.5 text-xs text-amber-900">
                    <span className="font-bold block">Terdeteksi QR Code BPOM 2D (Bukan Barcode Kasir):</span>
                    Kode <code className="bg-amber-100 px-1 rounded break-all">{scannedBarcode}</code> adalah Nomor Izin Edar BPOM. Arahkan laser PDA ke <strong>barcode garis vertikal 1D (13 digit angka seperti 899...)</strong> pada kemasan produk.
                  </div>
                )}
              </div>
            </div>
          ) : null}

          {/* Scan Session History List (Data Tetap Tersimpan di Interface Terminal PDA) */}
          {scanSessionHistory.length > 0 && (
            <div className="border border-slate-200 bg-white rounded-xl p-3.5 space-y-2.5 shadow-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-md bg-emerald-100 text-emerald-700 flex items-center justify-center">
                    <Layers className="w-3.5 h-3.5" />
                  </div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                    Sesi Scan PDA Ini ({scanSessionHistory.length} Produk • {totalBatchLabels} Label)
                  </h4>
                </div>
                {onOpenBatchPrint && (
                  <button
                    type="button"
                    onClick={onOpenBatchPrint}
                    className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 hover:text-emerald-900 underline"
                  >
                    <span>Buka Batch Print Queue</span>
                    <ArrowRight className="w-3 h-3" />
                  </button>
                )}
              </div>

              <div className="divide-y divide-slate-100 max-h-48 overflow-y-auto pr-1">
                {scanSessionHistory.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between py-2 text-xs gap-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-bold text-slate-900 truncate">{item.product.name}</p>
                      <p className="text-[11px] font-mono text-slate-500">
                        {item.barcode} • SKU: {item.product.sku} • Rp{' '}
                        {item.product.pricing.unitPrice.toLocaleString('id-ID')}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 font-bold rounded text-[11px]">
                        {item.quantity}x
                      </span>
                      <span className="text-[10px] text-slate-400">{item.time}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {catalogSyncBanner}

          {catalogSyncBanner}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
          <div className="flex items-center gap-3">
            <div>
              Active Store:{' '}
              <span className="font-semibold text-slate-700">{activeStore.name}</span>
            </div>
            {totalBatchItems > 0 && (
              <span className="inline-flex items-center gap-1 text-emerald-700 font-bold bg-emerald-100 border border-emerald-200 px-2.5 py-0.5 rounded-full">
                <Check className="w-3 h-3 text-emerald-600" />
                {totalBatchLabels} Label di Antrean
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {onOpenBatchPrint && totalBatchItems > 0 && (
              <button
                type="button"
                onClick={onOpenBatchPrint}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg transition shadow-xs"
              >
                <Layers className="w-3.5 h-3.5" />
                <span>Buka Batch Print ({totalBatchItems})</span>
              </button>
            )}
            <button
              onClick={onClose}
              className="px-4 py-1.5 bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 font-semibold rounded-lg transition"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
