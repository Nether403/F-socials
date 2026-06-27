import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev proxy: the web app calls same-origin /api, proxied to the backend on :4000.
// Avoids CORS in dev. For production, set VITE_API_BASE and enable CORS on the API.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:4000', changeOrigin: true },
    },
  },
});
