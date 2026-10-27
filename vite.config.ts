import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src/web',
  plugins: [react()],
  build: { outDir: '../../dist/web', emptyOutDir: true, target: 'es2020' },
  server: { port: 5173, proxy: { '/api': 'http://localhost:8080' } },
});
