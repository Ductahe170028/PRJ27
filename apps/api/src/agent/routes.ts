import type { Express, Request } from 'express';
import { AgentRequestSchema } from '@game-creator/contracts';
import { AIError } from '../providers/errors.js';
import { AgentOrchestrator } from './orchestrator.js';
import { withResponseAbort } from '../http/response-abort.js';
import { clientKey } from '../http/client-key.js';

function localUrl(value: string): boolean {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname); }
  catch { return false; }
}
export function advancedAllowed(request: Request, enabled: boolean): boolean {
  const ip = request.socket.remoteAddress ?? '';
  return enabled && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip)
    && localUrl(`http://${request.headers.host ?? ''}`) && (!request.headers.origin || localUrl(request.headers.origin));
}
export function mountAgentRoutes(app: Express, agent: AgentOrchestrator, enabled: boolean) {
  app.get('/api/agent/config', (request, response) => {
    const allowed = advancedAllowed(request, enabled);
    // Allowed by policy is not enough: the sandbox must also have passed its self-check.
    const readiness = allowed ? agent.readiness() : { ready: false, message: '' };
    response.json({
      enabled: allowed && readiness.ready, localOnly: true, maxRepairs: 2,
      message: !allowed ? 'Advanced chỉ mở trên localhost khi ADVANCED_AI_ENABLED=true và NODE_ENV khác production.'
        : readiness.ready ? 'Advanced thử nghiệm local · tối đa 2 lần sửa · tự chờ quota Groq ngắn hạn.' : readiness.message,
    });
  });
  app.post('/api/agent/generate', async (request, response) => {
    if (!advancedAllowed(request, enabled)) throw new AIError('advanced_unavailable', 'Advanced chỉ được phép chạy thử local, không mở qua domain hoặc máy khác.', 403);
    if (!request.is('application/json')) throw new AIError('invalid_code', 'Yêu cầu phải là application/json.', 400);
    const parsed = AgentRequestSchema.safeParse(request.body);
    if (!parsed.success) throw new AIError('invalid_code', 'Cần prompt 1–2000 ký tự và lựa chọn provider hợp lệ.', 400);
    const reservation = agent.reserve(parsed.data, clientKey(request.ip));
    try {
      await withResponseAbort(response, async (signal) => {
        signal.throwIfAborted();
        response.status(200).setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
        response.setHeader('X-Accel-Buffering', 'no');
        response.flushHeaders();
        await agent.run(reservation.request, clientKey(request.ip), signal, (event) => {
          if (!response.destroyed && !signal.aborted) response.write(`${JSON.stringify(event)}\n`);
        });
        response.end();
      });
    } finally { reservation.release(); }
  });
}
