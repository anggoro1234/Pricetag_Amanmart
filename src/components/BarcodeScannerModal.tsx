import React, { useState, useEffect, useRef } from 'react';
import { BrowserMultiFormatReader } from '@zxing/library';
import { 
  Camera, 
  Barcode as BarcodeIcon, 
  X, 
  Volume2, 
  Flashlight, 
  RefreshCw, 
  Plus, 
  Printer, 
  CheckCircle2, 
  AlertCircle,
  Keyboard,
  Layers
} from 'lucide-react';
import { Product, LabelTemplateConfig, StoreLocation } from '../types';
import { storageService } from '../services/storageService';
import { audioService } from '../services/audioService';
import { LabelPreview } from './LabelPreview';

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
  const [activeTab, setActiveTab] = useState<'camera' | 'usb_wedge' | 'manual'>('camera');
  const [scannedBarcode, setScannedBarcode] = useState<string>('');
  const [foundProduct, setFoundProduct] = useState<Product | null>(null);
  const [printQty, setPrintQty] = useState<number>(1);
  const [isCameraActive, setIsCameraActive] = useState<boolean>(false);
  const [hasTorch, setHasTorch] = useState<boolean>(false);
  const [isTorchOn, setIsTorchOn] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [wedgeBuffer, setWedgeBuffer] = useState<string>('');
  const [lastScanTime, setLastScanTime] = useState<string>('');
  const [showSuccessNotification, setShowSuccessNotification] = useState<boolean>(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const codeReaderRef = useRef<BrowserMultiFormatReader | null>(null);
  const selectedTemplate = templates[0];

  // Hardware USB Scanner Keyboard Wedge Global Listener
  useEffect(() => {
    let buffer = '';
    let lastKeyTime = Date.now();

    const handleKeyDown = (e: KeyboardEvent) => {
      const now = Date.now();
      const diff = now - lastKeyTime;
      lastKeyTime = now;

      // Ignore if user is typing in a standard input or textarea unless it's the scanner tab
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
        return;
      }

      if (e.key === 'Enter') {
        if (buffer.length >= 4) {
          handleBarcodeDetected(buffer.trim());
          buffer = '';
        }
      } else if (e.key.length === 1) {
        // Fast keystrokes (< 60ms) typical of hardware barcode guns
        if (diff > 120 && buffer.length > 0) {
          buffer = ''; // Reset if too slow (manual human typing)
        }
        buffer += e.key;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

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

    try {
      const codeReader = new BrowserMultiFormatReader();
      codeReaderRef.current = codeReader;

      const videoInputDevices = await codeReader.listVideoInputDevices();
      if (videoInputDevices.length === 0) {
        setCameraError('No camera found on this device.');
        setIsCameraActive(false);
        return;
      }

      // Prefer back/environment camera for barcode scanning
      const backCamera = videoInputDevices.find(
        (dev) => dev.label.toLowerCase().includes('back') || dev.label.toLowerCase().includes('rear')
      ) || videoInputDevices[0];

      if (videoRef.current) {
        codeReader.decodeFromVideoDevice(
          backCamera.deviceId,
          videoRef.current,
          (result, error) => {
            if (result) {
              const text = result.getText();
              handleBarcodeDetected(text);
            }
          }
        );
      }
    } catch (err: any) {
      console.warn('Camera access error:', err);
      setCameraError(err.message || 'Camera access not permitted or unavailable.');
      setIsCameraActive(false);
    }
  };

  const stopCamera = () => {
    if (codeReaderRef.current) {
      codeReaderRef.current.reset();
      codeReaderRef.current = null;
    }
    setIsCameraActive(false);
  };

  const handleBarcodeDetected = (rawCode: string) => {
    const code = rawCode.trim();
    if (!code) return;

    audioService.playScanBeep();
    setScannedBarcode(code);
    setLastScanTime(new Date().toLocaleTimeString());

    const product = storageService.findProductByBarcode(code);
    if (product) {
      setFoundProduct(product);
      setShowSuccessNotification(true);
      setTimeout(() => setShowSuccessNotification(false), 2500);
      if (onSelectProduct) {
        onSelectProduct(product);
      }
    } else {
      setFoundProduct(null);
      audioService.playErrorTone();
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
        <div className="flex border-b border-slate-200 bg-slate-50 px-4 pt-2 gap-2">
          <button
            onClick={() => setActiveTab('camera')}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold border-b-2 transition ${
              activeTab === 'camera'
                ? 'border-blue-600 text-blue-600 bg-white rounded-t-lg'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Camera className="w-4 h-4" />
            Camera Scanner
          </button>
          <button
            onClick={() => setActiveTab('usb_wedge')}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold border-b-2 transition ${
              activeTab === 'usb_wedge'
                ? 'border-blue-600 text-blue-600 bg-white rounded-t-lg'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Keyboard className="w-4 h-4" />
            Hardware USB Gun (Live)
          </button>
          <button
            onClick={() => setActiveTab('manual')}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold border-b-2 transition ${
              activeTab === 'manual'
                ? 'border-blue-600 text-blue-600 bg-white rounded-t-lg'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <BarcodeIcon className="w-4 h-4" />
            Test Emulators &amp; Manual
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
                    <button
                      onClick={() => setActiveTab('manual')}
                      className="px-3 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded-lg hover:bg-blue-700"
                    >
                      Use Test Barcodes / Manual Input
                    </button>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>Supports EAN-13, Code 128, UPC, QR</span>
                <span className="flex items-center gap-1">
                  <Volume2 className="w-3.5 h-3.5 text-blue-500" /> Audio Beep Enabled
                </span>
              </div>
            </div>
          )}

          {/* Tab 2: Hardware USB Gun Wedge Listener */}
          {activeTab === 'usb_wedge' && (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-6 text-center space-y-4">
              <div className="w-16 h-16 rounded-full bg-emerald-100 border border-emerald-300 text-emerald-600 flex items-center justify-center mx-auto animate-pulse">
                <Keyboard className="w-8 h-8" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-800">Hardware Scanner Ready</h3>
                <p className="text-sm text-slate-600 max-w-md mx-auto mt-1">
                  Point your physical USB or Bluetooth handheld scanner at any product barcode. The wedge listener is listening continuously in the background.
                </p>
              </div>
              <div className="inline-flex items-center gap-2 bg-white px-4 py-2 rounded-lg border border-slate-200 shadow-sm text-xs font-mono text-slate-600">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
                Listening for scan bursts...
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
                    onChange={(e) => setWedgeBuffer(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleBarcodeDetected(wedgeBuffer);
                      }
                    }}
                    className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none font-mono"
                  />
                  <button
                    onClick={() => handleBarcodeDetected(wedgeBuffer)}
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
            <div className="border border-amber-200 bg-amber-50 rounded-xl p-4 flex items-center gap-3">
              <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0" />
              <div>
                <div className="text-xs font-bold text-amber-800">
                  Barcode Not Found: {scannedBarcode}
                </div>
                <div className="text-xs text-amber-700 mt-0.5">
                  No matching product in inventory catalog for code &ldquo;{scannedBarcode}&rdquo;.
                </div>
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
