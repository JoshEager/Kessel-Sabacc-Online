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
    // Vite rejects unknown Host headers by default. Accept any hostname so tailnet/LAN devices can
    // use MagicDNS short names (e.g. http://server:5173), full *.ts.net names or local hostnames.
    // Dev server only; production is served by the Node server, which has no Host check.
    allowedHosts: true,
    proxy: {
      '/socket.io': { target: 'http://localhost:3001', ws: true },
    },
  },
});
