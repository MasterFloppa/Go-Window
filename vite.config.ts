import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const apiPort = Number(process.env.PORT ?? 8787);

export default defineConfig({
  root: 'src/web',
  plugins: [react()],
  build: {
    outDir: '../../dist/web',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      // Trailing slash matters: plain '/api' would also proxy the UI's own module '/api.ts'.
      '/api/': `http://127.0.0.1:${apiPort}`,
    },
  },
  test: {
    root: '.',
    include: ['test/**/*.test.ts'],
  },
});
