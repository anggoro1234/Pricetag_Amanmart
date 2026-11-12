import React, { useState, useEffect, useRef, useCallback } from 'react';
import { BrowserMultiFormatReader } from '@zxing/library';
import {
  Camera,
  Barcode as BarcodeIcon,
  X,
  Volume2,
  Plus,
  Printer,
  CheckCircle2,
  AlertCircle,
  Keyboard,
  Layers,
  ClipboardPaste,
  Smartphone,
  RotateCcw,
} from 'lucide-react';
import { Product, LabelTemplateConfig, StoreLocation } from '../types';
import { storageService } from '../services/storageService';
import { audioService } from '../services/audioService';
import { LabelPreview } from './LabelPreview';

const sanitizeScanString = (raw: string): string =>
  raw.replace(/[\u0000-\u001F\u007F\u200B-\u200D\uFEFF]/g, '').trim();

interface BarcodeScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectProduct?: (product: Product) => void;
  onAddToBatchQueue?: (product: Product, quantity: number) => void;
  onQuickPrint?: (product: Product) => void;
  templates: LabelTemplateConfig[];
  activeStore: StoreLocation;
}

export const BarcodeScannerModal: React.FC<BarcodeScannerModalProps> = ({
  isOpen,
  onClose,
  onSelectProduct,
  onAddToBatchQueue,
  onQuickPrint,
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
  const [pdaCaptureValue, setPdaCaptureValue] = useState<string>('');
  const [autoSubmitNoEnter, setAutoSubmitNoEnter] = useState<boolean>(true);
  const [allowVirtualKeyboard, setAllowVirtualKeyboard] = useState<boolean>(false);
  const [lastSignalInfo, setLastSignalInfo] = useState<string>('Menunggu sinyal dari scanner PDA / USB...');
  const [clipboardError, setClipboardError] = useState<string | null>(null);
  const [lastScanTime, setLastScanTime] = useState<string>('');
  const [showSuccessNotification, setShowSuccessNotification] = useState<boolean>(false);
  const [continuousScan, setContinuousScan] = useState<boolean>(true);
  const [catalogCount, setCatalogCount] = useState<number>(0);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const pdaInputRef = useRef<HTMLInputElement | null>(null);
  const codeReaderRef = useRef<BrowserMultiFormatReader | null>(null);
  const scanActiveRef = useRef<boolean>(false);
  const lastScanTimestampRef = useRef<number>(0);
  const lastScanCodeRef = useRef<string>('');
  const autoSubmitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleBarcodeDetectedRef = useRef<(rawCode: string, source?: string) => void>(() => {});
  const selectedTemplate = templates[0];

  // Detect Android / Mobile Data Terminal and sync catalog count on modal open
  useEffect(() => {
    const androidDevice = typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent);
    setIsAndroid(androidDevice);
    if (isOpen) {
      setCatalogCount(storageService.getProducts().length);
      if (androidDevice) {
        setActiveTab('usb_wedge');
      }
    } else {
      if (autoSubmitTimerRef.current) {
        clearTimeout(autoSubmitTimerRef.current);
        autoSubmitTimerRef.current = null;
      }
    }
  }, [isOpen]);

  // Keep PDA capture input focused when Hardware PDA / USB tab is active
  const focusPdaInput = useCallback(() => {
    if (!isOpen || activeTab !== 'usb_wedge') return;
    setTimeout(() => {
      pdaInputRef.current?.focus({ preventScroll: true });
    }, 60);
  }, [isOpen, activeTab]);

  useEffect(() => {
    focusPdaInput();
  }, [focusPdaInput]);

  // Hardware USB / Bluetooth Scanner Keyboard Wedge Global Listener
  // Mendukung HID keyboard (laptop) serta mencegah konflik dengan input PDA/manual terfokus
  useEffect(() => {
    if (!isOpen) return;

    let buffer = '';
    let lastKeyTime = Date.now();
    let scanInProgress = false;

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      // Biarkan PDA Capture Input & Manual Input menangani event-nya sendiri via onChange/onInput/onKeyDown
      if (
        target &&
        (target === pdaInputRef.current ||
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA')
      ) {
        return;
      }

      const now = Date.now();
      const diff = now - lastKeyTime;
      lastKeyTime = now;

      if (e.key === 'Enter' || e.key === 'Tab') {
        if (buffer.length >= 3) {
          e.preventDefault();
          const finalCode = buffer;
          buffer = '';
          scanInProgress = false;
          handleBarcodeDetectedRef.current(finalCode, `HID Global (${e.key})`);
        } else {
          buffer = '';
          scanInProgress = false;
        }
        return;
      }

      // Abaikan tombol kontrol/modifier atau Unidentified (IME Android memerlukan fokus ke <input>)
      if (e.key.length > 1) {
        return;
      }

      if (diff > 180 && buffer.length > 0 && !scanInProgress) {
        buffer = '';
      }

      scanInProgress = true;
      buffer += e.key;
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

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
      if (onSelectProduct) {
        onSelectProduct(product);
      }
      if (!continuousScan && scanActiveRef.current) {
        stopCamera();
      }
    } else {
      setFoundProduct(null);
      audioService.playErrorTone();
    }
  };

  handleBarcodeDetectedRef.current = handleBarcodeDetected;

  const submitPdaBuffer = (rawValue: string, source: string) => {
    if (autoSubmitTimerRef.current) {
      clearTimeout(autoSubmitTimerRef.current);
      autoSubmitTimerRef.current = null;
    }
    const clean = sanitizeScanString(rawValue);
    setPdaCaptureValue('');
    if (clean.length >= 2) {
      handleBarcodeDetected(clean, source);
    }
    focusPdaInput();
  };

  const handlePdaInputChange = (rawValue: string) => {
    setClipboardError(null);
    // Jika PDA menyisipkan terminator CR/LF/Tab di dalam teks (commitText)
    if (/[\r\n\t]/.test(rawValue)) {
      submitPdaBuffer(rawValue, 'PDA Scan (Terminator)');
      return;
    }

    const clean = sanitizeScanString(rawValue);
    setPdaCaptureValue(clean);

    if (clean.length > 0) {
      setLastSignalInfo(`Input PDA masuk: "${clean}"`);
    }

    // Auto-submit untuk PDA Android yang TIDAK mengirim tombol Enter setelah scan selesai
    if (autoSubmitTimerRef.current) {
      clearTimeout(autoSubmitTimerRef.current);
      autoSubmitTimerRef.current = null;
    }

    if (autoSubmitNoEnter && clean.length >= 4) {
      autoSubmitTimerRef.current = setTimeout(() => {
        submitPdaBuffer(clean, 'PDA Auto-Capture');
      }, 170);
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

              {/* Dedicated Focusable Capture Input (NEVER readOnly so Android ScanWedge IME CommitText works) */}
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
                    onClick={(e) => {
                      e.stopPropagation();
                      setAllowVirtualKeyboard((prev) => !prev);
                      focusPdaInput();
                    }}
                    className="text-[11px] font-semibold text-blue-600 hover:text-blue-800 underline"
                  >
                    {allowVirtualKeyboard ? 'Sembunyikan Keyboard HP' : 'Buka Keyboard HP'}
                  </button>
                </div>

                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    id="pda-capture-input"
                    ref={pdaInputRef}
                    type="text"
                    inputMode={allowVirtualKeyboard ? 'text' : 'none'}
                    autoFocus
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    placeholder="Arahkan laser PDA ke barcode & tekan tombol orange..."
                    value={pdaCaptureValue}
                    onChange={(e) => handlePdaInputChange(e.target.value)}
                    onCompositionEnd={(e) => {
                      const val = (e.target as HTMLInputElement).value;
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
                      if (e.key === 'Enter' || e.key === 'Tab') {
                        e.preventDefault();
                        submitPdaBuffer(pdaCaptureValue, `PDA Key (${e.key})`);
                      }
                    }}
                    className="flex-1 px-3 py-2.5 bg-slate-50 border border-slate-300 rounded-lg text-sm font-mono text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:bg-white focus:outline-none"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
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
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-[11px] text-slate-600">
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
                    <span>Auto-scan tanpa tombol Enter (wajib aktif untuk mayoritas PDA Android)</span>
                  </label>
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
                    Queue ({printQty})
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
              <div>
                <div className="text-xs font-bold text-amber-800">
                  Barcode Not Found: {scannedBarcode} {lastScanTime ? `(${lastScanTime})` : ''}
                </div>
                <div className="text-xs text-amber-700 mt-0.5">
                  No matching product in inventory catalog ({catalogCount.toLocaleString('id-ID')} items loaded) for code &ldquo;{scannedBarcode}&rdquo;.
                </div>
                {catalogCount === 0 && (
                  <div className="text-xs font-semibold text-red-700 mt-1">
                    Perhatian: Katalog di perangkat ini masih 0 produk. Buka tombol Panel Supabase di header untuk menyinkronkan data dari cloud ke PDA ini.
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between text-xs text-slate-500">
          <div>
            Active Store:{' '}
            <span className="font-semibold text-slate-700">{activeStore.name}</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 font-semibold rounded-lg transition"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
