import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import type {IncomingMessage, ServerResponse} from 'http';
import path from 'path';
import {defineConfig, type Plugin} from 'vite';

const CATALOG_DB_PATH = path.resolve(__dirname, '.amanmart-catalog-db.json');

interface ServerCatalogPayload {
  updatedAt: string | null;
  products: Record<string, unknown>[];
}

function readServerCatalog(): ServerCatalogPayload {
  try {
    if (!fs.existsSync(CATALOG_DB_PATH)) {
      return {updatedAt: null, products: []};
    }
    const raw = fs.readFileSync(CATALOG_DB_PATH, 'utf8');
    if (!raw.trim()) {
      return {updatedAt: null, products: []};
    }
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return {updatedAt: null, products: parsed};
    }
    if (parsed && Array.isArray(parsed.products)) {
      return {
        updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : null,
        products: parsed.products,
      };
    }
    return {updatedAt: null, products: []};
  } catch {
    return {updatedAt: null, products: []};
  }
}

function writeServerCatalog(payload: ServerCatalogPayload): void {
  const serialized = JSON.stringify(payload);
  const tmpPath = `${CATALOG_DB_PATH}.tmp`;
  try {
    fs.writeFileSync(tmpPath, serialized, 'utf8');
    fs.renameSync(tmpPath, CATALOG_DB_PATH);
  } catch {
    fs.writeFileSync(CATALOG_DB_PATH, serialized, 'utf8');
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch {
      // ignore cleanup error
    }
  }
}

function normalizeSkuKey(item: Record<string, unknown>): string {
  const raw = String(item.sku ?? item.SKU ?? '').trim().toLowerCase();
  if (!raw) return '';
  if (/^\d+\.0+$/.test(raw)) return raw.replace(/\.0+$/, '');
  return raw;
}

function deduplicateCatalogItems(items: Record<string, unknown>[]): Record<string, unknown>[] {
  const result: Record<string, unknown>[] = [];
  const skuIndexMap = new Map<string, number>();
  const idIndexMap = new Map<string, number>();

  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const skuKey = normalizeSkuKey(item);
    const idKey = String(item.id ?? '').trim();

    if (skuKey && skuIndexMap.has(skuKey)) {
      const idx = skuIndexMap.get(skuKey)!;
      result[idx] = {...result[idx], ...item};
      if (idKey) idIndexMap.set(idKey, idx);
      continue;
    }
    if (idKey && idIndexMap.has(idKey)) {
      const idx = idIndexMap.get(idKey)!;
      result[idx] = {...result[idx], ...item};
      if (skuKey) skuIndexMap.set(skuKey, idx);
      continue;
    }

    const nextIdx = result.length;
    result.push(item);
    if (skuKey) skuIndexMap.set(skuKey, nextIdx);
    if (idKey) idIndexMap.set(idKey, nextIdx);
  }

  return result;
}

function createCatalogApiMiddleware() {
  return (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = req.url ? req.url.split('?')[0] : '';
    if (url !== '/api/catalog') {
      next();
      return;
    }

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

    if (req.method === 'GET') {
      const store = readServerCatalog();
      res.statusCode = 200;
      res.end(
        JSON.stringify({
          ok: true,
          updatedAt: store.updatedAt,
          count: store.products.length,
          products: store.products,
        })
      );
      return;
    }

    if (req.method === 'DELETE') {
      try {
        if (fs.existsSync(CATALOG_DB_PATH)) {
          fs.unlinkSync(CATALOG_DB_PATH);
        }
        res.statusCode = 200;
        res.end(JSON.stringify({ok: true, updatedAt: new Date().toISOString(), count: 0}));
      } catch (err: unknown) {
        res.statusCode = 500;
        res.end(JSON.stringify({ok: false, error: err instanceof Error ? err.message : 'Delete failed'}));
      }
      return;
    }

    if (req.method === 'POST') {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      req.on('end', () => {
        try {
          const bodyStr = Buffer.concat(chunks).toString('utf8');
          const body = bodyStr ? JSON.parse(bodyStr) : {};
          const mode: 'replace' | 'upsert' = body.mode === 'replace' ? 'replace' : 'upsert';
          const incomingProducts: Record<string, unknown>[] = Array.isArray(body.products) ? body.products : [];
          const deletedIds = new Set<string>(
            Array.isArray(body.deletedIds) ? body.deletedIds.map((id: unknown) => String(id)) : []
          );
          const updatedAt = typeof body.updatedAt === 'string' ? body.updatedAt : new Date().toISOString();

          let finalProducts: Record<string, unknown>[];
          if (mode === 'replace') {
            finalProducts = deduplicateCatalogItems(
              incomingProducts.filter((p) => !deletedIds.has(String(p?.id ?? '')))
            );
          } else {
            const current = readServerCatalog().products.filter(
              (p) => !deletedIds.has(String(p?.id ?? ''))
            );
            finalProducts = deduplicateCatalogItems([...current, ...incomingProducts]);
          }

          writeServerCatalog({
            updatedAt,
            products: finalProducts,
          });

          res.statusCode = 200;
          res.end(
            JSON.stringify({
              ok: true,
              updatedAt,
              count: finalProducts.length,
            })
          );
        } catch (err: unknown) {
          res.statusCode = 400;
          res.end(
            JSON.stringify({
              ok: false,
              error: err instanceof Error ? err.message : 'Invalid catalog payload',
            })
          );
        }
      });
      return;
    }

    res.statusCode = 405;
    res.end(JSON.stringify({ok: false, error: 'Method not allowed'}));
  };
}

function amanmartCatalogSyncPlugin(): Plugin {
  return {
    name: 'amanmart-catalog-sync',
    configureServer(server) {
      server.middlewares.use(createCatalogApiMiddleware());
    },
    configurePreviewServer(server) {
      server.middlewares.use(createCatalogApiMiddleware());
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), amanmartCatalogSyncPlugin()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch:
        process.env.DISABLE_HMR === 'true'
          ? null
          : {
              ignored: ['**/.amanmart-catalog-db.json*'],
            },
    },
  };
});
