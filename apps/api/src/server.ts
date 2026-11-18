import 'dotenv/config';
import { createApp } from './app.js';
import type { AgentOrchestrator } from './agent/orchestrator.js';

const host = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.PORT ?? 3001);
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error('PORT phải là số nguyên từ 1 đến 65535.');
}
const clientOrigins = (process.env.CLIENT_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173')
  .split(',').map((origin) => origin.trim()).filter(Boolean);

const app = createApp({ clientOrigins });
const agent = app.locals.agent as AgentOrchestrator;
const server = app.listen(port, host, () => {
  console.log(`[api] http://${host}:${port} — AI Game Creator (Gemini / Groq / demo)`);
  if (!app.locals.advancedEnabled) {
    console.log('[advanced] tắt (NODE_ENV=production hoặc ADVANCED_AI_ENABLED=false): không có sandbox nào được khởi tạo.');
    return;
  }
  // Advanced reports itself unavailable until the sandbox self-check passes.
  void agent.startup().then(
    () => { const state = agent.readiness(); console.log(`[advanced] ${state.ready ? 'sandbox sẵn sàng' : `sandbox chưa sẵn sàng: ${state.message}`}`); },
    () => console.error('[advanced] không khởi tạo được sandbox'),
  );
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
  // Stop jobs and containers first so open NDJSON streams end and close() can finish.
  void agent.shutdown(2_000).catch(() => undefined).finally(() => {
    server.close(() => process.exit(0));
    server.closeIdleConnections();
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
