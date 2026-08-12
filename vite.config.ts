import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `base: './'` emits relative asset URLs so the built `dist/` folder can be
// dropped at a domain root *or* in a subdirectory (GitHub Pages, S3 prefix,
// a CDN path) without a rebuild.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist',
    assetsInlineLimit: 0,
  },
});
