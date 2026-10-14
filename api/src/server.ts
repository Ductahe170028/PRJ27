import 'dotenv/config';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { createApp } from './app.js';
import { loadConfig } from './config.js';

try {
  const config = loadConfig();
  const webDir = path.resolve('web/dist');
  const app = createApp({ config, ...(existsSync(webDir) ? { staticDir: webDir } : {}) });
  const server = app.listen(config.PORT, config.HOST, () => {
    console.log(`Denise API (${config.API_MODE}) ready at http://${config.HOST}:${config.PORT}`);
  });
  const stop = () => { server.close(() => process.exit(0)); };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
} catch {
  // Never print config values, URLs with credentials, or tokens.
  console.error('Cannot start API. Check .env, endpoint URLs, credentials and configuration.');
  process.exitCode = 1;
}
