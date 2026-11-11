import { LabelTemplateConfig, Product, ThermalPrinterSettings } from '../types';

export interface BluetoothDeviceWrapper {
  device: any;
  server?: any;
  characteristic?: any;
  name: string;
  connected: boolean;
}

class ThermalPrinterService {
  private activeBtDevice: BluetoothDeviceWrapper | null = null;
  private activeSerialPort: any = null;

  // Check browser hardware API capabilities
  getCapabilities() {
    return {
      hasBluetooth: typeof navigator !== 'undefined' && 'bluetooth' in navigator,
      hasSerial: typeof navigator !== 'undefined' && 'serial' in navigator,
      hasUsb: typeof navigator !== 'undefined' && 'usb' in navigator,
    };
  }

  // Connect via Web Bluetooth (Standard ESC/POS or TSPL thermal printer service)
  async connectBluetooth(): Promise<string> {
    if (!('bluetooth' in navigator)) {
      throw new Error('Web Bluetooth is not supported on this browser. Try Chrome or Edge.');
    }

    try {
      const device = await (navigator as any).bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [
          '000018f0-0000-1000-8000-00805f9b34fb', // Standard thermal printer service
          '49535343-fe7d-4ae5-8fa9-9fafd205e455', // ISSC transparent
          '0000e0ff-0000-1000-8000-00805f9b34fb',
          '0000ff00-0000-1000-8000-00805f9b34fb',
        ],
      });

      const server = await device.gatt.connect();
      this.activeBtDevice = {
        device,
        server,
        name: device.name || 'Bluetooth Thermal Printer',
        connected: true,
      };

      return device.name || 'Bluetooth Printer Connected';
    } catch (err: any) {
      if (err.name === 'NotFoundError') {
        throw new Error('Pairing cancelled by user');
      }
      throw err;
    }
  }

  // Connect via Web Serial (USB-to-Serial thermal printers like Xprinter / Zebra / Rongta)
  async connectSerial(): Promise<string> {
    if (!('serial' in navigator)) {
      throw new Error('Web Serial is not supported on this browser. Try Chrome or Edge desktop.');
    }

    try {
      const port = await (navigator as any).serial.requestPort();
      await port.open({ baudRate: 9600 });
      this.activeSerialPort = port;
      return 'Serial Port Connected (9600 Baud)';
    } catch (err: any) {
      if (err.name === 'NotFoundError') {
        throw new Error('Port selection cancelled');
      }
      throw err;
    }
  }

  disconnect() {
    if (this.activeBtDevice?.device?.gatt?.connected) {
      this.activeBtDevice.device.gatt.disconnect();
    }
    this.activeBtDevice = null;
    if (this.activeSerialPort) {
      this.activeSerialPort.close().catch(() => {});
      this.activeSerialPort = null;
    }
  }

  getConnectedDeviceName(): string | null {
    if (this.activeBtDevice?.connected) return this.activeBtDevice.name;
    if (this.activeSerialPort) return 'USB / Serial Thermal Printer';
    return null;
  }

  // Generate TSPL (TSC Label Printer Language) for precise sticky labels (Xprinter, Rongta, Zebra TSPL)
  generateTSPL(product: Product, template: LabelTemplateConfig, copies: number = 1): string {
    const dotsPerMm = template.dpi === 300 ? 11.8 : 8;
    const widthDots = Math.round(template.widthMm * dotsPerMm);
    const heightDots = Math.round(template.heightMm * dotsPerMm);

    const lines: string[] = [
      `SIZE ${template.widthMm} mm, ${template.heightMm} mm`,
      `GAP 3 mm, 0 mm`,
      `DIRECTION 1`,
      `CLS`,
    ];

    // Clean product title (max 28 chars for width fit)
    const cleanName = product.name.replace(/["']/g, '');
    lines.push(`TEXT 16, 16, "3", 0, 1, 1, "${cleanName.slice(0, 32)}"`);

    // Red/bold unit price
    const unitPriceFormatted = `${product.currency} ${product.pricing.unitPrice.toLocaleString('id-ID')} / ${product.pricing.unitLabel} / ${product.pricing.unitQuantity}`;
    lines.push(`TEXT ${widthDots - 220}, 44, "3", 0, 1, 1, "${unitPriceFormatted}"`);

    // Bulk price if present and template enabled
    if (template.showBulkPrice && product.pricing.bulkPrice && product.pricing.bulkLabel) {
      const bulkPriceFormatted = `${product.currency} ${product.pricing.bulkPrice.toLocaleString('id-ID')} / ${product.pricing.bulkLabel} / ${product.pricing.bulkQuantity}`;
      lines.push(`TEXT ${widthDots - 220}, 72, "2", 0, 1, 1, "${bulkPriceFormatted}"`);
    }

    // Barcode (EAN13 or 128)
    const bcType = product.barcode.length === 13 ? 'EAN13' : '128';
    lines.push(`BARCODE 16, 96, "${bcType}", 55, 1, 0, 2, 2, "${product.barcode}"`);

    // SKU and Live Print Date (Today)
    const now = new Date();
    const livePrintDate = `${String(now.getDate()).padStart(2, '0')}/${String(
      now.getMonth() + 1
    ).padStart(2, '0')}/${now.getFullYear()}`;

    if (template.showSku) {
      lines.push(`TEXT ${widthDots - 130}, 105, "2", 0, 1, 1, "${product.sku}"`);
    }
    if (template.showDate) {
      lines.push(`TEXT ${widthDots - 130}, 125, "1", 0, 1, 1, "${livePrintDate}"`);
    }

    lines.push(`PRINT ${copies}, 1`);
    return lines.join('\r\n');
  }

  // Generate standard ESC/POS commands (for 58mm / 80mm continuous receipt and label rolls)
  generateEscPos(product: Product, template: LabelTemplateConfig, copies: number = 1): Uint8Array {
    const encoder = new TextEncoder();
    const chunks: Uint8Array[] = [];

    const pushBytes = (...bytes: number[]) => {
      chunks.push(new Uint8Array(bytes));
    };

    const pushText = (str: string) => {
      chunks.push(encoder.encode(str + '\n'));
    };

    const now = new Date();
    const livePrintDate = `${String(now.getDate()).padStart(2, '0')}/${String(
      now.getMonth() + 1
    ).padStart(2, '0')}/${now.getFullYear()}`;

    for (let c = 0; c < copies; c++) {
      // ESC @ (Initialize)
      pushBytes(0x1B, 0x40);

      // Align Center
      pushBytes(0x1B, 0x61, 0x01);

      // Bold Product Name
      pushBytes(0x1B, 0x45, 0x01);
      pushText(product.name);
      pushBytes(0x1B, 0x45, 0x00);

      // Price - Double height & width
      pushBytes(0x1D, 0x21, 0x11);
      pushText(`${product.currency} ${product.pricing.unitPrice.toLocaleString('id-ID')}`);
      pushBytes(0x1D, 0x21, 0x00);

      if (template.showBulkPrice && product.pricing.bulkPrice) {
        pushText(`${product.currency} ${product.pricing.bulkPrice.toLocaleString('id-ID')} / ${product.pricing.bulkLabel}`);
      }

      // Barcode (GS k)
      // Set barcode height
      pushBytes(0x1D, 0x68, 60);
      // Set barcode width
      pushBytes(0x1D, 0x77, 2);
      // HRI characters below
      pushBytes(0x1D, 0x48, 2);

      // Code 128 barcode
      const bcData = encoder.encode(product.barcode);
      pushBytes(0x1D, 0x6B, 73, bcData.length);
      chunks.push(bcData);

      // SKU and live print date
      pushText(`\nSKU: ${product.sku} | Date: ${livePrintDate}`);

      // Feed lines
      pushBytes(0x1B, 0x64, 3);
      // Cut paper (GS V 66 0)
      pushBytes(0x1D, 0x56, 66, 0);
    }

    // Merge all byte arrays
    const totalLength = chunks.reduce((acc, curr) => acc + curr.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result;
  }

  // Direct print using system print dialog with 3-column side-by-side layout and wider/larger physical tag sizing
  triggerSystemPrint(labelElementId: string, columns: number = 3, printSizeScale: number = 1.08) {
    const printElement = document.getElementById(labelElementId);
    if (!printElement) {
      window.print();
      return;
    }

    // Create dedicated invisible print iframe for seamless background printing
    const existingFrame = document.getElementById('label-print-frame') as HTMLIFrameElement;
    if (existingFrame) {
      existingFrame.remove();
    }

    const iframe = document.createElement('iframe');
    iframe.id = 'label-print-frame';
    iframe.style.position = 'fixed';
    iframe.style.top = '-10000px';
    iframe.style.left = '-10000px';
    iframe.style.width = '0px';
    iframe.style.height = '0px';
    iframe.style.border = 'none';

    document.body.appendChild(iframe);

    const doc = iframe.contentWindow?.document;
    if (!doc) {
      window.print();
      return;
    }

    // Copy styles from main document to preserve Tailwind CSS & custom styling
    let stylesHtml = '';
    document.querySelectorAll('style, link[rel="stylesheet"]').forEach((el) => {
      stylesHtml += el.outerHTML;
    });

    const isMultiColumn = columns > 1;
    const tagHeightMm = Math.round(36 * printSizeScale);

    doc.open();
    doc.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Print Labels</title>
          ${stylesHtml}
          <style>
            @page {
              size: auto;
              margin: 2.5mm;
            }
            body {
              margin: 0;
              padding: 1mm;
              background: #ffffff;
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
              box-sizing: border-box;
            }
            .print-container {
              display: grid !important;
              grid-template-columns: ${
                isMultiColumn ? `repeat(${columns}, minmax(0, 1fr))` : '1fr'
              } !important;
              gap: 2mm !important;
              width: 100% !important;
              align-items: stretch !important;
              justify-items: stretch !important;
              page-break-after: auto;
            }
            .print-container > div {
              width: 100% !important;
              display: flex !important;
              flex-direction: column !important;
              align-items: stretch !important;
              page-break-inside: avoid !important;
              break-inside: avoid !important;
            }
            .label-item {
              width: 100% !important;
              min-height: ${tagHeightMm}mm !important;
              height: ${tagHeightMm}mm !important;
              padding: 2.2mm 3.2mm !important;
              border: 1px solid #94a3b8 !important;
              box-sizing: border-box !important;
              page-break-inside: avoid !important;
              break-inside: avoid !important;
              max-width: 100% !important;
            }
            .print\\:hidden {
              display: none !important;
            }
          </style>
        </head>
        <body>
          <div class="print-container">
            ${printElement.innerHTML}
          </div>
        </body>
      </html>
    `);
    doc.close();

    // Wait for styles and barcode images/SVGs to settle
    setTimeout(() => {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    }, 400);
  }
}

export const thermalPrinterService = new ThermalPrinterService();
