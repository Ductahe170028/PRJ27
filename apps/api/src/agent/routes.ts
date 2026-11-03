import type { Express, Request } from 'express';
import { AgentRequestSchema } from '@game-creator/contracts';
import { AIError } from '../providers/errors.js';
import { AgentOrchestrator } from './orchestrator.js';

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
    response.json({ enabled: allowed, localOnly: true, maxRepairs: 2, message: allowed ? 'Advanced thử nghiệm local · tối đa 2 lần sửa · tối đa 4 lượt gọi AI.' : 'Advanced chỉ mở trên localhost khi ADVANCED_AI_ENABLED=true và NODE_ENV khác production.' });
  });
  app.post('/api/agent/generate', async (request, response) => {
    if (!advancedAllowed(request, enabled)) throw new AIError('advanced_unavailable', 'Advanced chỉ được phép chạy thử local, không mở qua domain hoặc máy khác.', 403);
    if (!request.is('application/json')) throw new AIError('invalid_code', 'Yêu cầu phải là application/json.', 400);
    const parsed = AgentRequestSchema.safeParse(request.body);
    if (!parsed.success) throw new AIError('invalid_code', 'Cần prompt 1–2000 ký tự và lựa chọn provider hợp lệ.', 400);
    const reservation = agent.reserve(parsed.data);
    const controller = new AbortController();
    const disconnect = () => { if (!response.writableEnded) controller.abort(); };
    response.on('close', disconnect);
    response.status(200).setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    response.setHeader('X-Accel-Buffering', 'no');
    response.flushHeaders();
    try {
      await agent.run(reservation.request, request.ip ?? 'local', controller.signal, (event) => {
        if (!response.destroyed && !controller.signal.aborted) response.write(`${JSON.stringify(event)}\n`);
      });
      response.end();
    } finally { response.off('close', disconnect); reservation.release(); }
  });
}
