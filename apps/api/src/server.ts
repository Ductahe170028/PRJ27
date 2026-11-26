import 'dotenv/config';
import { createApp } from './app.js';

const host = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.PORT ?? 3001);
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error('PORT phải là số nguyên từ 1 đến 65535.');
}
const clientOrigins = (process.env.CLIENT_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173')
  .split(',').map((origin) => origin.trim()).filter(Boolean);

const app = createApp({ clientOrigins });
const server = app.listen(port, host, () => {
  console.log(`[api] http://${host}:${port} — AI Game Creator (Gemini / Groq / demo)`);
});
server.on('error', (error: NodeJS.ErrnoException) => {
  console.error(error.code === 'EADDRINUSE' ? `[api] Cổng ${port} đang được sử dụng.` : error.message);
  process.exit(1);
});

let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  setTimeout(() => process.exit(1), 8_000).unref();
  server.close(() => process.exit(0));
  server.closeIdleConnections();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
