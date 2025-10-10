import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  server: {
    port: 5173,
    strictPort: true,
    host: true,
    proxy: { '/api': { target: 'http://localhost:8080', changeOrigin: true, secure: false, ws: true } },
    watch: { ignored: ['**/pdfs/**'] },
  },
  clearScreen: false,
});
