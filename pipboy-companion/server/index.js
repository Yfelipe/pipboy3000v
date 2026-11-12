import path from 'node:path';
import { createApp, isLoopbackHost, LOOPBACK_HOSTS } from './app.js';

const port = Number(process.env.PORT ?? 8077);
const host = process.env.HOST ?? '127.0.0.1';
if (!isLoopbackHost(host)) {
  console.error(`HOST=${host} isn't supported: the companion only runs on this computer. Use one of ${LOOPBACK_HOSTS.join(', ')}.`);
  console.error('It has no authentication, it refuses requests that aren\'t addressed to localhost, and Web Serial needs localhost anyway.');
  process.exit(1);
}
const dataDir = process.env.PIPBOY_DATA_DIR ? path.resolve(process.env.PIPBOY_DATA_DIR) : undefined;

const { server, dataDir: resolvedDataDir } = await createApp({ dataDir });

server.listen(port, host, () => {
  console.log(`Pip-Boy Companion running at http://localhost:${port}`);
  console.log(`Data directory: ${resolvedDataDir}`);
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
