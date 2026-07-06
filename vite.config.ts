import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'es2021',
    assetsInlineLimit: 8192,
    reportCompressedSize: true,
  },
  server: {
    port: 5173,
  },
});
