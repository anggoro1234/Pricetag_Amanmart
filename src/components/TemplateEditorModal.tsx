import React, { useState } from 'react';
import { 
  Palette, 
  Eye, 
  Check, 
  X, 
  LayoutTemplate, 
  Sliders, 
  Type, 
  Layers,
  Save,
  RotateCcw
} from 'lucide-react';
import { LabelTemplateConfig, Product, StoreLocation } from '../types';
import { LabelPreview } from './LabelPreview';
import { INITIAL_PRODUCTS } from '../data/initialData';

interface TemplateEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  templates: LabelTemplateConfig[];
  activeTemplateId: string;
  onSaveTemplate: (template: LabelTemplateConfig) => void;
  activeStore: StoreLocation;
}

export const TemplateEditorModal: React.FC<TemplateEditorModalProps> = ({
  isOpen,
  onClose,
  templates,
  activeTemplateId,
  onSaveTemplate,
  activeStore,
}) => {
  const [selectedId, setSelectedId] = useState<string>(activeTemplateId);
  const currentInitial = templates.find((t) => t.id === selectedId) || templates[0];
  const [editingTemplate, setEditingTemplate] = useState<LabelTemplateConfig>({ ...currentInitial });
  const [sampleProductIndex, setSampleProductIndex] = useState<number>(0);

  if (!isOpen) return null;

  const sampleProduct: Product = INITIAL_PRODUCTS[sampleProductIndex] || INITIAL_PRODUCTS[0];

  const handleSelectBase = (tmpl: LabelTemplateConfig) => {
    setSelectedId(tmpl.id);
    setEditingTemplate({ ...tmpl });
  };

  const handleSave = () => {
    onSaveTemplate(editingTemplate);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl overflow-hidden border border-slate-200 flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-600/30 border border-purple-400 flex items-center justify-center text-purple-400">
              <LayoutTemplate className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Custom Label Template Studio</h2>
              <p className="text-xs text-slate-400">
                Design shelf stickers, two-tier pricing tags, and thermal labels
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

        {/* Content Body */}
        <div className="flex-1 overflow-hidden flex flex-col md:flex-row">
          {/* Left: Settings Controls */}
          <div className="w-full md:w-1/2 p-6 overflow-y-auto space-y-5 border-r border-slate-200">
            {/* Template Selector */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
                Preset Archetypes
              </label>
              <div className="grid grid-cols-2 gap-2">
                {templates.map((tmpl) => (
                  <button
                    key={tmpl.id}
                    type="button"
                    onClick={() => handleSelectBase(tmpl)}
                    className={`p-2.5 rounded-xl border text-left transition ${
                      editingTemplate.id === tmpl.id
                        ? 'border-purple-600 bg-purple-50 text-purple-900 font-bold ring-2 ring-purple-500/20'
                        : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                    }`}
                  >
                    <div className="text-xs truncate">{tmpl.name}</div>
                    <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                      {tmpl.widthMm} x {tmpl.heightMm} mm
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Template Name */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                Template Name
              </label>
              <input
                type="text"
                value={editingTemplate.name}
                onChange={(e) => setEditingTemplate({ ...editingTemplate, name: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-semibold focus:ring-2 focus:ring-purple-500"
              />
            </div>

            {/* Physical Dimensions */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                  Width (mm)
                </label>
                <input
                  type="number"
                  min="20"
                  max="150"
                  value={editingTemplate.widthMm}
                  onChange={(e) =>
                    setEditingTemplate({
                      ...editingTemplate,
                      widthMm: parseInt(e.target.value) || 60,
                    })
                  }
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs font-bold font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                  Height (mm)
                </label>
                <input
                  type="number"
                  min="15"
                  max="200"
                  value={editingTemplate.heightMm}
                  onChange={(e) =>
                    setEditingTemplate({
                      ...editingTemplate,
                      heightMm: parseInt(e.target.value) || 28,
                    })
                  }
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs font-bold font-mono"
                />
              </div>
            </div>

            {/* Price Color */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
                Primary Price Accent Color
              </label>
              <div className="flex items-center gap-3">
                {[
                  { label: 'Red (Attached Example)', color: '#e11d48' },
                  { label: 'Deep Black', color: '#0f172a' },
                  { label: 'Blue', color: '#0284c7' },
                  { label: 'Emerald', color: '#059669' },
                ].map((item) => (
                  <button
                    key={item.color}
                    type="button"
                    onClick={() =>
                      setEditingTemplate({ ...editingTemplate, primaryPriceColor: item.color })
                    }
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition ${
                      editingTemplate.primaryPriceColor === item.color
                        ? 'border-purple-600 bg-purple-50 text-purple-900 ring-2 ring-purple-500/20'
                        : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                    }`}
                  >
                    <span
                      className="w-3.5 h-3.5 rounded-full border border-black/10"
                      style={{ backgroundColor: item.color }}
                    />
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Elements Visibility Toggles */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
                Data Fields Visibility
              </label>
              <div className="space-y-2 bg-slate-50 p-3 rounded-xl border border-slate-200 text-xs">
                <label className="flex items-center justify-between cursor-pointer">
                  <span className="font-semibold text-slate-700">Show Bulk / Carton Price</span>
                  <input
                    type="checkbox"
                    checked={editingTemplate.showBulkPrice}
                    onChange={(e) =>
                      setEditingTemplate({ ...editingTemplate, showBulkPrice: e.target.checked })
                    }
                    className="w-4 h-4 text-purple-600 rounded"
                  />
                </label>

                <label className="flex items-center justify-between cursor-pointer">
                  <span className="font-semibold text-slate-700">Show SKU / PLU Code</span>
                  <input
                    type="checkbox"
                    checked={editingTemplate.showSku}
                    onChange={(e) =>
                      setEditingTemplate({ ...editingTemplate, showSku: e.target.checked })
                    }
                    className="w-4 h-4 text-purple-600 rounded"
                  />
                </label>

                <label className="flex items-center justify-between cursor-pointer">
                  <span className="font-semibold text-slate-700">Show Print / Effective Date</span>
                  <input
                    type="checkbox"
                    checked={editingTemplate.showDate}
                    onChange={(e) =>
                      setEditingTemplate({ ...editingTemplate, showDate: e.target.checked })
                    }
                    className="w-4 h-4 text-purple-600 rounded"
                  />
                </label>

                <label className="flex items-center justify-between cursor-pointer">
                  <span className="font-semibold text-slate-700">Show Store Location Header</span>
                  <input
                    type="checkbox"
                    checked={editingTemplate.showStoreName}
                    onChange={(e) =>
                      setEditingTemplate({ ...editingTemplate, showStoreName: e.target.checked })
                    }
                    className="w-4 h-4 text-purple-600 rounded"
                  />
                </label>
              </div>
            </div>

            {/* Barcode Height */}
            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Barcode Height
                </label>
                <span className="text-xs font-mono font-bold text-slate-800">
                  {editingTemplate.barcodeHeightMm} mm
                </span>
              </div>
              <input
                type="range"
                min="6"
                max="25"
                value={editingTemplate.barcodeHeightMm}
                onChange={(e) =>
                  setEditingTemplate({
                    ...editingTemplate,
                    barcodeHeightMm: parseInt(e.target.value) || 12,
                  })
                }
                className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-purple-600"
              />
            </div>
          </div>

          {/* Right: Real-Time Live Render & Calibration */}
          <div className="w-full md:w-1/2 bg-slate-100 p-6 flex flex-col items-center justify-center space-y-4">
            <div className="w-full flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Live 1:1 Scale Preview
              </span>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-slate-500">Sample Item:</span>
                <select
                  value={sampleProductIndex}
                  onChange={(e) => setSampleProductIndex(parseInt(e.target.value))}
                  className="text-xs px-2 py-1 bg-white border border-slate-300 rounded font-semibold"
                >
                  {INITIAL_PRODUCTS.map((p, idx) => (
                    <option key={p.id} value={idx}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* High-Res Label Rendering */}
            <div className="bg-white p-6 rounded-2xl shadow-xl border border-slate-300 flex items-center justify-center">
              <LabelPreview
                product={sampleProduct}
                template={editingTemplate}
                store={activeStore}
                scale={1.3}
              />
            </div>

            <div className="text-center text-xs text-slate-500 max-w-sm">
              Rendered with exact barcode geometry for 203/300 DPI thermal heads.
              Includes dual-tier pricing matching the attached example.
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 border border-slate-300 text-slate-700 hover:bg-slate-100 rounded-xl text-xs font-semibold"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="flex items-center gap-1.5 px-5 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-bold shadow-sm"
          >
            <Save className="w-4 h-4" />
            Save &amp; Apply Template
          </button>
        </div>
      </div>
    </div>
  );
};
