import React, { useState } from 'react';
import { 
  Printer, 
  Bluetooth, 
  Usb, 
  Monitor, 
  Settings2, 
  Check, 
  AlertCircle, 
  X, 
  Play, 
  Sparkles,
  Sliders,
  Cpu
} from 'lucide-react';
import { ThermalPrinterSettings } from '../types';
import { thermalPrinterService } from '../services/thermalPrinterService';
import { audioService } from '../services/audioService';

interface ThermalPrinterSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: ThermalPrinterSettings;
  onSaveSettings: (settings: ThermalPrinterSettings) => void;
}

export const ThermalPrinterSettingsModal: React.FC<ThermalPrinterSettingsModalProps> = ({
  isOpen,
  onClose,
  settings,
  onSaveSettings,
}) => {
  const [formData, setFormData] = useState<ThermalPrinterSettings>({ ...settings });
  const [connecting, setConnecting] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [connectedName, setConnectedName] = useState<string | null>(
    thermalPrinterService.getConnectedDeviceName()
  );

  if (!isOpen) return null;

  const capabilities = thermalPrinterService.getCapabilities();

  const handleConnectBluetooth = async () => {
    setConnecting(true);
    setStatusMessage(null);
    try {
      const name = await thermalPrinterService.connectBluetooth();
      setConnectedName(name);
      setFormData({ ...formData, connectionType: 'bluetooth', bluetoothDeviceName: name });
      setStatusMessage(`Successfully paired with ${name}!`);
      audioService.playPrintCompleteChime();
    } catch (err: any) {
      setStatusMessage(`Bluetooth pairing error: ${err.message}`);
      audioService.playErrorTone();
    } finally {
      setConnecting(false);
    }
  };

  const handleConnectSerial = async () => {
    setConnecting(true);
    setStatusMessage(null);
    try {
      const name = await thermalPrinterService.connectSerial();
      setConnectedName(name);
      setFormData({ ...formData, connectionType: 'serial' });
      setStatusMessage(`Connected to USB/Serial thermal port!`);
      audioService.playPrintCompleteChime();
    } catch (err: any) {
      setStatusMessage(`Serial port error: ${err.message}`);
      audioService.playErrorTone();
    } finally {
      setConnecting(false);
    }
  };

  const handleTestPrint = () => {
    thermalPrinterService.triggerSystemPrint('batch-printable-labels-area');
    audioService.playPrintCompleteChime();
    setStatusMessage('Test calibration print job sent to printer driver.');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveSettings(formData);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl overflow-hidden border border-slate-200 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-600/30 border border-blue-400 flex items-center justify-center text-blue-400">
              <Printer className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Thermal Printer Configuration</h2>
              <p className="text-xs text-slate-400">
                Web Bluetooth, Web Serial, TSPL/ESC-POS &amp; System Driver
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

        {/* Content Form */}
        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-5 flex-1">
          {statusMessage && (
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl text-xs text-blue-700 font-medium flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-blue-600 flex-shrink-0" />
              {statusMessage}
            </div>
          )}

          {/* Connection Interface */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
              Hardware Connection Interface
            </label>
            <div className="grid grid-cols-3 gap-2.5">
              <button
                type="button"
                onClick={() => setFormData({ ...formData, connectionType: 'browser_print' })}
                className={`flex flex-col items-center justify-center p-3 rounded-xl border text-center transition ${
                  formData.connectionType === 'browser_print'
                    ? 'border-blue-600 bg-blue-50 text-blue-700 ring-2 ring-blue-500/20'
                    : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                }`}
              >
                <Monitor className="w-5 h-5 mb-1.5" />
                <span className="text-xs font-bold">System Driver</span>
                <span className="text-[10px] text-slate-500">Zero Setup (Any OS)</span>
              </button>

              <button
                type="button"
                onClick={handleConnectBluetooth}
                disabled={!capabilities.hasBluetooth || connecting}
                className={`flex flex-col items-center justify-center p-3 rounded-xl border text-center transition ${
                  formData.connectionType === 'bluetooth'
                    ? 'border-blue-600 bg-blue-50 text-blue-700 ring-2 ring-blue-500/20'
                    : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                }`}
              >
                <Bluetooth className="w-5 h-5 mb-1.5 text-indigo-600" />
                <span className="text-xs font-bold">Web Bluetooth</span>
                <span className="text-[10px] text-slate-500">
                  {capabilities.hasBluetooth ? 'Direct Wireless' : 'Unsupported'}
                </span>
              </button>

              <button
                type="button"
                onClick={handleConnectSerial}
                disabled={!capabilities.hasSerial || connecting}
                className={`flex flex-col items-center justify-center p-3 rounded-xl border text-center transition ${
                  formData.connectionType === 'serial'
                    ? 'border-blue-600 bg-blue-50 text-blue-700 ring-2 ring-blue-500/20'
                    : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                }`}
              >
                <Usb className="w-5 h-5 mb-1.5 text-emerald-600" />
                <span className="text-xs font-bold">Web Serial/USB</span>
                <span className="text-[10px] text-slate-500">
                  {capabilities.hasSerial ? 'Direct COM Port' : 'Desktop only'}
                </span>
              </button>
            </div>

            {connectedName && (
              <div className="mt-2 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-lg flex items-center justify-between">
                <span>
                  Active Device: <strong>{connectedName}</strong>
                </span>
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              </div>
            )}
          </div>

          {/* Printer Command Language & Density */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                Printer Protocol Language
              </label>
              <select
                value={formData.printerLanguage}
                onChange={(e) =>
                  setFormData({ ...formData, printerLanguage: e.target.value as any })
                }
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-semibold focus:ring-2 focus:ring-blue-500"
              >
                <option value="TSPL">TSPL (TSC / Xprinter / Rongta / Gprinter)</option>
                <option value="ESC_POS">ESC/POS (Epson / Generic 58/80mm POS)</option>
                <option value="ZPL">ZPL (Zebra Industrial Printers)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                Print Head Density (DPI)
              </label>
              <select
                value={formData.dpi}
                onChange={(e) =>
                  setFormData({ ...formData, dpi: parseInt(e.target.value) as 203 | 300 })
                }
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-semibold focus:ring-2 focus:ring-blue-500"
              >
                <option value="203">203 DPI (8 dots/mm - Standard)</option>
                <option value="300">300 DPI (11.8 dots/mm - High Res)</option>
              </select>
            </div>
          </div>

          {/* Dimensions */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                Paper Roll (mm)
              </label>
              <input
                type="number"
                value={formData.paperWidthMm}
                onChange={(e) =>
                  setFormData({ ...formData, paperWidthMm: parseInt(e.target.value) || 65 })
                }
                className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs font-bold"
              />
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                Label Width (mm)
              </label>
              <input
                type="number"
                value={formData.labelWidthMm}
                onChange={(e) =>
                  setFormData({ ...formData, labelWidthMm: parseInt(e.target.value) || 65 })
                }
                className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs font-bold"
              />
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                Label Height (mm)
              </label>
              <input
                type="number"
                value={formData.labelHeightMm}
                onChange={(e) =>
                  setFormData({ ...formData, labelHeightMm: parseInt(e.target.value) || 28 })
                }
                className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs font-bold"
              />
            </div>
          </div>

          {/* Darkness / Heat Slider */}
          <div>
            <div className="flex justify-between items-center mb-1">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Thermal Head Burn Darkness
              </label>
              <span className="text-xs font-mono font-bold text-slate-800">
                {formData.darkness} / 15
              </span>
            </div>
            <input
              type="range"
              min="1"
              max="15"
              value={formData.darkness}
              onChange={(e) =>
                setFormData({ ...formData, darkness: parseInt(e.target.value) || 10 })
              }
              className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
            />
            <div className="flex justify-between text-[10px] text-slate-400 mt-0.5">
              <span>Light (Faster)</span>
              <span>Dark (Crisp Barcodes)</span>
            </div>
          </div>

          {/* Auto-cut and feed lines */}
          <div className="flex items-center justify-between pt-2 border-t border-slate-200">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={formData.autoCut}
                onChange={(e) => setFormData({ ...formData, autoCut: e.target.checked })}
                className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
              />
              <span className="text-xs font-semibold text-slate-700">
                Trigger Hardware Auto-Cutter
              </span>
            </label>

            <button
              type="button"
              onClick={handleTestPrint}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg text-xs transition"
            >
              <Play className="w-3.5 h-3.5 text-blue-600" />
              Test Calibration
            </button>
          </div>

          {/* Modal Footer */}
          <div className="pt-4 border-t border-slate-200 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-slate-300 text-slate-700 hover:bg-slate-100 rounded-xl text-xs font-semibold"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-sm"
            >
              Save Configuration
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
