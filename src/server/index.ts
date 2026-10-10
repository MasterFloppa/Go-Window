import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createApp } from './app.js';
import { GoWindowService } from './service.js';
import { Store } from './store.js';

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? '127.0.0.1';
const REFRESH_MS = 20 * 60 * 1000;

const store = new Store(resolve(process.env.GO_WINDOW_DATA ?? 'data/store.json'));
const service = new GoWindowService(store, PORT);
const app = createApp(service);

if (existsSync('dist/web/index.html')) {
  app.use('/*', serveStatic({ root: './dist/web' }));
  app.get('*', serveStatic({ path: './dist/web/index.html' }));
}

serve({ fetch: app.fetch, port: PORT, hostname: HOST }, () => {
  console.log(`Go Window API on http://${HOST === '0.0.0.0' ? '127.0.0.1' : HOST}:${PORT}`);
  if (HOST === '0.0.0.0') {
    for (const url of service.lanUrls()) console.log(`  on your Wi-Fi: ${url}/?k=${store.data.accessKey}`);
  }
  if (!existsSync('dist/web/index.html')) console.log('  UI: run `npm run dev` and open http://localhost:5173');
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
