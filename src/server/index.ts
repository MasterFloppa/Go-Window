import './env.js';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createApp } from './app.js';
import { GoWindowService } from './service.js';
import { Store } from './store.js';

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? '127.0.0.1';
const DEV = process.env.GO_WINDOW_DEV === '1';
const REFRESH_MS = 20 * 60 * 1000;

const store = new Store(resolve(process.env.GO_WINDOW_DATA ?? 'data/store.json'));
const service = new GoWindowService(store, PORT);
const app = createApp(service);

// In dev the UI comes from Vite with hot reload; serving an old build here would only confuse.
const serveUi = !DEV && existsSync('dist/web/index.html');
if (serveUi) {
  app.use('/*', serveStatic({ root: './dist/web' }));
  app.get('*', serveStatic({ path: './dist/web/index.html' }));
}

serve({ fetch: app.fetch, port: PORT, hostname: HOST }, () => {
  const local = `http://${HOST === '0.0.0.0' ? '127.0.0.1' : HOST}:${PORT}`;
  if (DEV) console.log(`Go Window API ready on ${local}. Open the UI at http://localhost:5173`);
  else if (serveUi) console.log(`Go Window is running. Open ${local}`);
  else console.log(`Go Window API on ${local}. No UI build found: run \`npm start\` (or \`npm run dev\` for development).`);
  if (HOST === '0.0.0.0') {
    for (const url of service.lanUrls()) console.log(`  On your phone (same Wi-Fi), open once: ${url}/?k=${store.data.accessKey}`);
  }
});

let running = false;
const tick = async () => {
  if (running) return;
  running = true;
  try {
    await service.tick();
  } catch (err) {
    console.warn(`[refresh] ${(err as Error).message}`);
  } finally {
    running = false;
  }
};
setTimeout(tick, 3000);
setInterval(tick, REFRESH_MS);
