import React, { useState, useEffect } from 'react';
import { 
  Barcode as BarcodeIcon, 
  Printer, 
  Layers, 
  Building2, 
  BarChart3, 
  Sparkles, 
  ArrowRight, 
  CheckCircle2, 
  WifiOff, 
  AlertTriangle,
  Plus,
  RotateCcw,
  Sliders,
  ExternalLink,
  Upload
} from 'lucide-react';
import { 
  Product, 
  StoreLocation, 
  LabelTemplateConfig, 
  User, 
  PrintQueueItem, 
  ThermalPrinterSettings, 
  StockAdjustment 
} from './types';
import { storageService } from './services/storageService';
import { thermalPrinterService } from './services/thermalPrinterService';
import { audioService } from './services/audioService';
import { LabelPreview } from './components/LabelPreview';
import { Navbar } from './components/Navbar';
import { ProductCatalog } from './components/ProductCatalog';
import { StockSyncMatrix } from './components/StockSyncMatrix';
import { InventoryDashboard } from './components/InventoryDashboard';
import { BarcodeScannerModal } from './components/BarcodeScannerModal';
import { BatchPrintModal } from './components/BatchPrintModal';
import { ThermalPrinterSettingsModal } from './components/ThermalPrinterSettingsModal';
import { TemplateEditorModal } from './components/TemplateEditorModal';
import { NotificationCenter } from './components/NotificationCenter';
import { AuthModal } from './components/AuthModal';
import { DeployGuideModal } from './components/DeployGuideModal';
import { ProductFormModal } from './components/ProductFormModal';
import { StockAdjustModal } from './components/StockAdjustModal';
import { ProductImportModal } from './components/ProductImportModal';
import { AmanmartLogo, AmanmartBannerCard } from './components/AmanmartLogo';

export default function App() {
  // Core application states
  const [products, setProducts] = useState<Product[]>(storageService.getProducts());
  const [stores, setStores] = useState<StoreLocation[]>(storageService.getStores());
  const [templates, setTemplates] = useState<LabelTemplateConfig[]>(storageService.getTemplates());
  const [activeStoreId, setActiveStoreId] = useState<string>(storageService.getActiveStoreId());
  const [currentUser, setCurrentUser] = useState<User>(storageService.getCurrentUser());
  const [printerSettings, setPrinterSettings] = useState<ThermalPrinterSettings>(
    storageService.getPrinterSettings()
  );
  const [activeTemplateId, setActiveTemplateId] = useState<string>('tmpl-supermarket');

  // Navigation tab: 'catalog' | 'sync_matrix' | 'analytics'
  const [activeTab, setActiveTab] = useState<'catalog' | 'sync_matrix' | 'analytics'>('catalog');

  // Offline and sync state
  const [isOnline, setIsOnline] = useState<boolean>(storageService.isOnline());
  const [isSimulatedOffline, setIsSimulatedOffline] = useState<boolean>(
    storageService.isSimulatedOffline()
  );
  const [offlineQueue, setOfflineQueue] = useState(storageService.getOfflineQueue());
  const [alerts, setAlerts] = useState(storageService.getAlerts());

  // Print queue for bulk batch printing
  const [batchQueue, setBatchQueue] = useState<PrintQueueItem[]>([]);

  // Modals visibility
  const [scannerOpen, setScannerOpen] = useState<boolean>(false);
  const [batchPrintOpen, setBatchPrintOpen] = useState<boolean>(false);
  const [printerSettingsOpen, setPrinterSettingsOpen] = useState<boolean>(false);
  const [templateEditorOpen, setTemplateEditorOpen] = useState<boolean>(false);
  const [notificationsOpen, setNotificationsOpen] = useState<boolean>(false);
  const [authModalOpen, setAuthModalOpen] = useState<boolean>(false);
  const [deployGuideOpen, setDeployGuideOpen] = useState<boolean>(false);
  const [productFormOpen, setProductFormOpen] = useState<boolean>(false);
  const [productImportOpen, setProductImportOpen] = useState<boolean>(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [stockAdjustOpen, setStockAdjustOpen] = useState<boolean>(false);
  const [adjustingProduct, setAdjustingProduct] = useState<Product | null>(null);

  // Subscribe to storage changes & multi-store sync events
  useEffect(() => {
    const unsubscribe = storageService.subscribe(() => {
      setProducts([...storageService.getProducts()]);
      setStores([...storageService.getStores()]);
      setTemplates([...storageService.getTemplates()]);
      setCurrentUser(storageService.getCurrentUser());
      setActiveStoreId(storageService.getActiveStoreId());
      setPrinterSettings(storageService.getPrinterSettings());
      setIsOnline(storageService.isOnline());
      setIsSimulatedOffline(storageService.isSimulatedOffline());
      setOfflineQueue([...storageService.getOfflineQueue()]);
      setAlerts([...storageService.getAlerts()]);
    });

    const handleOnlineStatus = () => {
      setIsOnline(storageService.isOnline());
    };

    window.addEventListener('online', handleOnlineStatus);
    window.addEventListener('offline', handleOnlineStatus);

    return () => {
      unsubscribe();
      window.removeEventListener('online', handleOnlineStatus);
      window.removeEventListener('offline', handleOnlineStatus);
    };
  }, []);

  const activeStore = stores.find((s) => s.id === activeStoreId) || stores[0];
  const activeTemplate = templates.find((t) => t.id === activeTemplateId) || templates[0];

  // Attached example products from image.png
  const attachedExample1 = products.find((p) => p.sku === '1001040') || products[0];
  const attachedExample2 = products.find((p) => p.sku === '1001041') || products[1];

  // Quick single print handler (preserves existing batch items or adds this product)
  const handleQuickPrint = (product: Product) => {
    setBatchQueue((prev) => {
      const existing = prev.find((item) => item.product.id === product.id);
      if (existing) {
        return prev;
      }
      return [
        ...prev,
        {
          id: `print-${Date.now()}-${product.id}`,
          product,
          quantity: 1,
          templateId: activeTemplateId,
          storeId: activeStore.id,
        },
      ];
    });
    setBatchPrintOpen(true);
    audioService.playScanBeep();
  };

  // Add to batch queue
  const handleAddToBatch = (product: Product, quantity: number = 1) => {
    setBatchQueue((prev) => {
      const existing = prev.find((item) => item.product.id === product.id);
      if (existing) {
        return prev.map((item) =>
          item.product.id === product.id
            ? { ...item, quantity: item.quantity + quantity }
            : item
        );
      }
      return [
        ...prev,
        {
          id: `queue-${Date.now()}-${product.id}`,
          product,
          quantity,
          templateId: activeTemplateId,
          storeId: activeStore.id,
        },
      ];
    });
  };

  // Batch queue updates
  const handleUpdateBatchQuantity = (id: string, delta: number) => {
    setBatchQueue((prev) =>
      prev
        .map((item) =>
          item.id === id ? { ...item, quantity: Math.max(1, item.quantity + delta) } : item
        )
        .filter((item) => item.quantity > 0)
    );
  };

  const handleRemoveBatchItem = (id: string) => {
    setBatchQueue((prev) => prev.filter((item) => item.id !== id));
  };

  const handleClearBatchQueue = () => {
    setBatchQueue([]);
  };

  // Delete product and clean up from batch print queue
  const handleDeleteProduct = (productId: string) => {
    storageService.deleteProduct(productId);
    setBatchQueue((prev) => prev.filter((item) => item.product.id !== productId));
  };

  // Save product and sync any existing item in batch print queue
  const handleSaveProduct = (savedProduct: Product) => {
    storageService.saveProduct(savedProduct);
    setBatchQueue((prev) =>
      prev.map((item) =>
        item.product.id === savedProduct.id ? { ...item, product: savedProduct } : item
      )
    );
  };

  // Toggle CRT / Bulk Price visibility on the active template without losing stored CRT prices
  const handleToggleBulkPrice = (showBulk: boolean) => {
    const targetTmpl = templates.find((t) => t.id === activeTemplateId) || templates[0];
    if (targetTmpl) {
      storageService.saveTemplate({ ...targetTmpl, showBulkPrice: showBulk });
    }
  };

  // Add multiple items to batch in a single O(N) state update (prevents UI lag on large batches)
  const handleAddBatchToQueue = (items: { product: Product; quantity: number }[]) => {
    setBatchQueue((prev) => {
      const next = [...prev];
      const idxMap = new Map<string, number>();
      next.forEach((entry, idx) => idxMap.set(entry.product.id, idx));

      const now = Date.now();
      items.forEach(({ product, quantity }, i) => {
        const existingIdx = idxMap.get(product.id);
        if (existingIdx !== undefined) {
          next[existingIdx] = {
            ...next[existingIdx],
            quantity: next[existingIdx].quantity + quantity,
          };
        } else {
          idxMap.set(product.id, next.length);
          next.push({
            id: `queue-${now}-${i}-${product.id}`,
            product,
            quantity,
            templateId: activeTemplateId,
            storeId: activeStore.id,
          });
        }
      });

      return next;
    });
    setBatchPrintOpen(true);
    audioService.playPrintCompleteChime();
  };

  // Toggle offline simulation
  const handleToggleOffline = () => {
    storageService.setSimulatedOffline(!isSimulatedOffline);
  };

  // Quick print pair matching attached example
  const handlePrintAttachedPair = () => {
    setBatchQueue([
      {
        id: `pair-1-${Date.now()}`,
        product: attachedExample1,
        quantity: 1,
        templateId: 'tmpl-supermarket',
        storeId: activeStore.id,
      },
      {
        id: `pair-2-${Date.now()}`,
        product: attachedExample2,
        quantity: 1,
        templateId: 'tmpl-supermarket',
        storeId: activeStore.id,
      },
    ]);
    setActiveTemplateId('tmpl-supermarket');
    setBatchPrintOpen(true);
    audioService.playPrintCompleteChime();
  };

  return (
    <div className="min-h-screen bg-[#f4f7f4] text-slate-900 flex flex-col font-sans selection:bg-emerald-600 selection:text-white">
      {/* Top Navbar */}
      <Navbar
        stores={stores}
        activeStore={activeStore}
        onSelectStore={(id) => storageService.setActiveStoreId(id)}
        currentUser={currentUser}
        isOnline={isOnline}
        isSimulatedOffline={isSimulatedOffline}
        onToggleOffline={handleToggleOffline}
        batchQueueCount={batchQueue.reduce((s, i) => s + i.quantity, 0)}
        unreadAlertsCount={alerts.filter((a) => !a.isRead).length}
        onOpenScanner={() => setScannerOpen(true)}
        onOpenBatchPrint={() => setBatchPrintOpen(true)}
        onOpenPrinterSettings={() => setPrinterSettingsOpen(true)}
        onOpenTemplateEditor={() => setTemplateEditorOpen(true)}
        onOpenNotifications={() => setNotificationsOpen(true)}
        onOpenAuth={() => setAuthModalOpen(true)}
        onOpenDeployGuide={() => setDeployGuideOpen(true)}
        printerSettings={printerSettings}
      />

      {/* Offline Status Warning Bar */}
      {!isOnline && (
        <div className="bg-amber-500 text-amber-950 px-4 py-2 text-xs font-bold flex items-center justify-between shadow-xs">
          <div className="flex items-center gap-2 max-w-7xl mx-auto w-full">
            <WifiOff className="w-4 h-4 text-amber-950 flex-shrink-0" />
            <span>
              Offline Mode Active (Local Database Working) —{' '}
              {offlineQueue.length > 0
                ? `${offlineQueue.length} pending transaction(s) will auto-sync when online.`
                : 'All scans and prints work offline.'}
            </span>
            {isSimulatedOffline && (
              <button
                onClick={handleToggleOffline}
                className="ml-auto underline hover:text-white text-[11px] font-extrabold"
              >
                Reconnect to Cloud
              </button>
            )}
          </div>
        </div>
      )}

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-3 sm:px-6 py-4 sm:py-6 space-y-4 sm:space-y-6">
        {/* Amanmart Official Brand Header Box */}
        <div 
          className="rounded-2xl text-white shadow-xs overflow-hidden relative px-4 py-4 sm:px-6 sm:py-4.5 border border-emerald-800/40"
          style={{
            background: 'linear-gradient(135deg, #092c1a 0%, #0d3b23 55%, #124d2e 100%)',
          }}
        >
          {/* Subtle background ambient glow */}
          <div className="absolute -right-12 -top-12 w-56 h-56 rounded-full bg-emerald-500/10 blur-3xl pointer-events-none" />
          
          <div className="flex flex-col md:flex-row items-center justify-between gap-4 relative z-10">
            {/* Logo positioned proportionally with store context */}
            <div className="flex flex-col sm:flex-row items-center gap-3.5 sm:gap-4 text-center sm:text-left">
              <AmanmartLogo size="md" theme="dark" showTagline={true} />

              <div>
                <div className="flex items-center justify-center sm:justify-start gap-2 flex-wrap">
                  <span className="bg-emerald-500/25 text-emerald-300 text-[11px] font-extrabold px-2.5 py-0.5 rounded-full border border-emerald-500/35 uppercase tracking-wide">
                    Branch {activeStore.code} • {activeStore.name}
                  </span>
                  <span className="text-xs text-emerald-200/70 font-mono">
                    {stores.length} Connected Branches
                  </span>
                </div>
                <h2 className="text-sm sm:text-base font-bold text-white mt-1">
                  Thermal Price Label Printing &amp; Multi-Branch Inventory
                </h2>
                <p className="text-xs text-emerald-200/80 mt-0.5 max-w-xl">
                  ESC/POS &amp; TSPL thermal printing, real-time stock sync, and barcode scanner integration.
                </p>
              </div>
            </div>

            {/* Header Action Buttons */}
            <div className="flex items-center gap-2 sm:gap-2.5 z-10 flex-wrap justify-center w-full sm:w-auto flex-shrink-0">
              <button
                onClick={() => setScannerOpen(true)}
                className="flex-1 sm:flex-initial justify-center flex items-center gap-1.5 px-3.5 py-2 bg-emerald-950/80 hover:bg-emerald-900 text-emerald-100 border border-emerald-700/60 rounded-xl text-xs font-semibold transition active:scale-95"
              >
                <BarcodeIcon className="w-4 h-4 text-[#62cb32]" />
                Scan Barcode
              </button>

              <button
                onClick={() => setProductImportOpen(true)}
                className="flex-1 sm:flex-initial justify-center flex items-center gap-1.5 px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold shadow-md shadow-black/20 transition active:scale-95 border border-emerald-400/30"
              >
                <Upload className="w-4 h-4" />
                Import Items
              </button>
            </div>
          </div>
        </div>

        {/* Primary View Navigation Tabs in Soft Green Theme */}
        <div className="flex overflow-x-auto border-b border-emerald-200/80 bg-white px-2 sm:px-4 rounded-t-2xl shadow-xs gap-1 sm:gap-3 pt-2">
          <button
            onClick={() => setActiveTab('catalog')}
            className={`flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2.5 sm:py-3 text-xs sm:text-sm font-bold border-b-2 transition whitespace-nowrap shrink-0 ${
              activeTab === 'catalog'
                ? 'border-emerald-700 text-emerald-800 bg-emerald-50/50 rounded-t-lg'
                : 'border-transparent text-slate-500 hover:text-emerald-800'
            }`}
          >
            <BarcodeIcon className="w-4 h-4 shrink-0" />
            <span>Product Catalog &amp; Label Printing ({products.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('sync_matrix')}
            className={`flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2.5 sm:py-3 text-xs sm:text-sm font-bold border-b-2 transition whitespace-nowrap shrink-0 ${
              activeTab === 'sync_matrix'
                ? 'border-emerald-700 text-emerald-800 bg-emerald-50/50 rounded-t-lg'
                : 'border-transparent text-slate-500 hover:text-emerald-800'
            }`}
          >
            <Building2 className="w-4 h-4 shrink-0" />
            <span>Multi-Store Real-Time Cloud Sync ({stores.length} Branches)</span>
          </button>

          <button
            onClick={() => setActiveTab('analytics')}
            className={`flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2.5 sm:py-3 text-xs sm:text-sm font-bold border-b-2 transition whitespace-nowrap shrink-0 ${
              activeTab === 'analytics'
                ? 'border-emerald-700 text-emerald-800 bg-emerald-50/50 rounded-t-lg'
                : 'border-transparent text-slate-500 hover:text-emerald-800'
            }`}
          >
            <BarChart3 className="w-4 h-4 shrink-0" />
            <span>Inventory Analytics &amp; Reports</span>
          </button>
        </div>

        {/* Tab 1: Product Catalog & Label Printing */}
        {activeTab === 'catalog' && (
          <ProductCatalog
            products={products}
            activeStore={activeStore}
            stores={stores}
            onQuickPrint={handleQuickPrint}
            onAddToBatch={handleAddToBatch}
            onAddBatchToQueue={handleAddBatchToQueue}
            onOpenBatchPrint={() => setBatchPrintOpen(true)}
            batchQueue={batchQueue}
            onAdjustStock={(p) => {
              setAdjustingProduct(p);
              setStockAdjustOpen(true);
            }}
            onEditProduct={(p) => {
              setEditingProduct(p);
              setProductFormOpen(true);
            }}
            onAddNewProduct={() => {
              setEditingProduct(null);
              setProductFormOpen(true);
            }}
            onDeleteProduct={handleDeleteProduct}
            onOpenImport={() => setProductImportOpen(true)}
            onOpenSupabaseModal={() => setDeployGuideOpen(true)}
            userRole={currentUser.role}
            templates={templates}
            showBulkPrice={activeTemplate?.showBulkPrice ?? false}
            onToggleBulkPrice={handleToggleBulkPrice}
          />
        )}

        {/* Tab 2: Multi-Store Cloud Stock Synchronization */}
        {activeTab === 'sync_matrix' && (
          <StockSyncMatrix
            products={products}
            stores={stores}
            activeStore={activeStore}
            userRole={currentUser.role}
            userName={currentUser.name}
          />
        )}

        {/* Tab 3: Inventory Dashboard & Analytics */}
        {activeTab === 'analytics' && (
          <InventoryDashboard
            products={products}
            stores={stores}
            activeStore={activeStore}
            onQuickPrint={handleQuickPrint}
            onAddBatchToQueue={handleAddBatchToQueue}
          />
        )}
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-emerald-200/80 mt-12 py-6 text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-800">Amanmart Shelf Label &amp; Multi-Branch Inventory</span>
            <span>•</span>
            <span className="text-emerald-700 font-semibold">Halal Terjangkau</span>
            <span>•</span>
            <span>Thermal ESC/POS &amp; TSPL Ready</span>
          </div>

          <div className="flex items-center gap-4 text-slate-600">
            <button
              onClick={() => setDeployGuideOpen(true)}
              className="hover:text-emerald-700 font-semibold flex items-center gap-1"
            >
              Cloud Deployment
            </button>
            <button
              onClick={() => setPrinterSettingsOpen(true)}
              className="hover:text-emerald-700 font-semibold"
            >
              Printer Settings
            </button>
            <button
              onClick={() => setTemplateEditorOpen(true)}
              className="hover:text-emerald-700 font-semibold"
            >
              Template Studio
            </button>
          </div>
        </div>
      </footer>

      {/* Modals */}
      <BarcodeScannerModal
        isOpen={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onSelectProduct={(p) => {
          handleAddToBatch(p, 1);
        }}
        onAddToBatchQueue={(p, qty) => {
          handleAddToBatch(p, qty);
        }}
        onQuickPrint={(p) => {
          handleQuickPrint(p);
        }}
        onOpenBatchPrint={() => {
          setScannerOpen(false);
          setBatchPrintOpen(true);
        }}
        onUpdateBatchQuantity={handleUpdateBatchQuantity}
        onRemoveBatchItem={handleRemoveBatchItem}
        batchQueue={batchQueue}
        templates={templates}
        activeStore={activeStore}
      />

      <BatchPrintModal
        isOpen={batchPrintOpen}
        onClose={() => setBatchPrintOpen(false)}
        queue={batchQueue}
        products={products}
        onAddProduct={handleAddToBatch}
        onReorderQueue={setBatchQueue}
        onUpdateQuantity={handleUpdateBatchQuantity}
        onRemoveItem={handleRemoveBatchItem}
        onClearQueue={handleClearBatchQueue}
        templates={templates}
        activeTemplateId={activeTemplateId}
        onSelectTemplate={setActiveTemplateId}
        onToggleBulkPrice={handleToggleBulkPrice}
        activeStore={activeStore}
        printerSettings={printerSettings}
      />

      <ThermalPrinterSettingsModal
        isOpen={printerSettingsOpen}
        onClose={() => setPrinterSettingsOpen(false)}
        settings={printerSettings}
        onSaveSettings={(st) => storageService.savePrinterSettings(st)}
      />

      <TemplateEditorModal
        isOpen={templateEditorOpen}
        onClose={() => setTemplateEditorOpen(false)}
        templates={templates}
        activeTemplateId={activeTemplateId}
        onSaveTemplate={(tmpl) => storageService.saveTemplate(tmpl)}
        activeStore={activeStore}
      />

      <NotificationCenter
        isOpen={notificationsOpen}
        onClose={() => setNotificationsOpen(false)}
        alerts={alerts}
        onMarkAsRead={(id) => storageService.markAlertAsRead(id)}
        onMarkAllAsRead={() => storageService.markAllAlertsAsRead()}
        onClearAlerts={() => storageService.clearAlerts()}
        onQuickPrintFromAlert={(sku) => {
          const p = products.find((prod) => prod.sku === sku);
          if (p) {
            handleQuickPrint(p);
            setNotificationsOpen(false);
          }
        }}
      />

      <AuthModal
        isOpen={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        currentUser={currentUser}
        onSelectUser={(u) => storageService.setCurrentUser(u)}
        stores={stores}
      />

      <DeployGuideModal
        isOpen={deployGuideOpen}
        onClose={() => setDeployGuideOpen(false)}
      />

      <ProductFormModal
        isOpen={productFormOpen}
        onClose={() => {
          setProductFormOpen(false);
          setEditingProduct(null);
        }}
        onSave={handleSaveProduct}
        onDelete={handleDeleteProduct}
        productToEdit={editingProduct}
        stores={stores}
        activeStoreId={activeStore.id}
      />

      <StockAdjustModal
        isOpen={stockAdjustOpen}
        onClose={() => {
          setStockAdjustOpen(false);
          setAdjustingProduct(null);
        }}
        product={adjustingProduct}
        activeStore={activeStore}
        onConfirmAdjust={(prodId, stId, newQty, reason) => {
          storageService.adjustStock(prodId, stId, newQty, reason, currentUser.name);
          audioService.playPrintCompleteChime();
        }}
      />

      {productImportOpen && (
        <ProductImportModal
          isOpen={productImportOpen}
          onClose={() => setProductImportOpen(false)}
          stores={stores}
          activeStoreId={activeStore.id}
          existingProducts={products}
          onImportComplete={(imported, targetStoreId, updateExisting, replaceAllLocal) => {
            storageService.importProducts(imported, targetStoreId, updateExisting, replaceAllLocal);
          }}
        />
      )}
    </div>
  );
}
