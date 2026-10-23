/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './': los mismos archivos sirven desde el backend en :8080 y desde GitHub Pages.
// Las tipografías van dentro del bundle para que la app ande sin internet en el aula.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist',
    assetsInlineLimit: (file) => (file.endsWith('.woff2') ? true : undefined),
    rollupOptions: {
      output: {
        // Las librerías cambian poco: en un archivo aparte quedan en la caché del navegador
        manualChunks: { ui: ['radix-ui', 'cmdk', 'lucide-react'], graficos: ['d3-scale', 'd3-shape', 'd3-array'] },
      },
    },
  },
  // Las pruebas leen el CSS de las pantallas como texto para buscar clases repetidas
  test: { css: { include: [/\/src\/(pages|styles)\/.+\.css/] } },
  server: {
    port: 5173,
    // Con el backend corriendo: npm run dev y las llamadas a /api van al contenedor
    proxy: { '/api': 'http://localhost:8080' },
  },
});
