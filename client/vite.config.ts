import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root,
  plugins: [react()],
  build: {
    outDir: fileURLToPath(new URL('../dist/public', import.meta.url)),
    emptyOutDir: true,
  },
  server: {
    // Listen on all interfaces so other devices (LAN / Tailscale) can join during dev.
    host: '0.0.0.0',
    port: 5173,
    // Vite rejects unknown Host headers; allow Tailscale MagicDNS names (raw IPs are always allowed).
    allowedHosts: ['.ts.net'],
    proxy: {
      '/socket.io': { target: 'http://localhost:3001', ws: true },
    },
  },
});
