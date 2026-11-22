import { resolve } from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    port: 5174,
    open: false,
  },
  build: {
    outDir: 'dist',
    assetsInlineLimit: 0,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        'castle-defense': resolve(__dirname, 'castle-defense/index.html'),
        brawl: resolve(__dirname, 'brawl/index.html'),
      },
    },
  },
});
