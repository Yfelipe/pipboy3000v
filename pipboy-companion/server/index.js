import path from 'node:path';
import { createApp } from './app.js';

const port = Number(process.env.PORT ?? 8077);
const host = process.env.HOST ?? '127.0.0.1';
const dataDir = process.env.PIPBOY_DATA_DIR ? path.resolve(process.env.PIPBOY_DATA_DIR) : undefined;

const { server, dataDir: resolvedDataDir } = await createApp({ dataDir });

server.listen(port, host, () => {
  const shown = host === '127.0.0.1' || host === '::1' ? 'localhost' : host;
  console.log(`Pip-Boy Companion running at http://${shown}:${port}`);
  console.log(`Data directory: ${resolvedDataDir}`);
  if (host !== '127.0.0.1' && host !== '::1' && host !== 'localhost') {
    console.warn('Warning: listening beyond localhost. Web Serial only works on localhost or HTTPS, and the API has no authentication.');
  }
});

let stopping = false;
function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  console.log(`\n${signal} received, shutting down…`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
