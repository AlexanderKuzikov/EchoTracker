import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const base = process.env['ECHO_BASE'] ?? '/echo/';

export default defineConfig({
  base,
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: Number(process.env['WEB_PORT'] ?? 5174),
    strictPort: false,
    proxy: {
      [`${base}api`]: `http://127.0.0.1:${process.env['API_PORT'] ?? 8100}`,
    },
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1200,
  },
});
