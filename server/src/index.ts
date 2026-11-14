import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './app';

const here = path.dirname(fileURLToPath(import.meta.url));
// In production the bundle lives at dist/server.js and the client at dist/public.
const candidates = [path.join(here, 'public'), path.join(here, '../../dist/public')];
const staticDir = candidates.find((d) => existsSync(path.join(d, 'index.html'))) ?? null;

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? '0.0.0.0';
const server = await startServer({ port, host, staticDir, log: true });
console.log(`Kessel Sabacc server listening on http://${host}:${server.port}`);
if (!staticDir) console.log('No client build found — run the Vite dev server (npm run dev) or npm run build.');

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    server.close().finally(() => process.exit(0));
  });
}
