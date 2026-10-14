/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';

// Vela: frontend del visor. `base: './'` es obligatorio para que el bundle
// funcione bajo el protocolo de assets de Tauri (rutas relativas).
export default defineConfig({
  base: './',
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.ts'],
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: {
          pdf: ['pdfjs-dist'],
          codemirror: [
            '@codemirror/state',
            '@codemirror/view',
            '@codemirror/commands',
            '@codemirror/language',
            '@codemirror/lang-markdown',
            '@codemirror/search',
            '@codemirror/autocomplete',
          ],
        },
      },
    },
  },
  server: {
    port: 5199,
    strictPort: true,
  },
  preview: {
    port: 5198,
    strictPort: true,
  },
});
