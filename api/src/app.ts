import express, { type ErrorRequestHandler } from 'express';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import { idSchema, reopenInputSchema, studentCodeSchema } from '../../shared/contracts.js';
import { authenticate } from './auth.js';
import type { Gateway } from './clients/gateway.js';
import { MockGateway } from './clients/mock-gateway.js';
import { RealGateway } from './clients/real-gateway.js';
import { type Config, loadConfig, realWritesConfigured } from './config.js';
import { AppError } from './errors.js';
import { type AuditWriter, ReopenService } from './services/reopen-service.js';

export function createApp(options: { config?: Config; gateway?: Gateway; audit?: AuditWriter; staticDir?: string } = {}) {
  const config = options.config ?? loadConfig();
  const gateway = options.gateway ?? (config.API_MODE === 'mock' ? new MockGateway() : new RealGateway(config));
  const service = new ReopenService(gateway, config, options.audit);
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.locals.requestId = randomUUID();
    res.set({ 'X-Request-Id': res.locals.requestId, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY' });
    if (req.path.startsWith('/api')) res.set('Cache-Control', 'no-store');
    next();
  });
  app.get('/api/health', (_req, res) => { res.json({ ok: true }); });
  app.use('/api', (req, res, next) => {
    try {
      res.locals.actor = authenticate(req, config);
      if (req.method === 'POST') {
        const origin = req.get('origin');
        if (req.get('sec-fetch-site') === 'cross-site' || (origin && origin !== config.WEB_ORIGIN)) throw new AppError(403, 'INVALID_ORIGIN', 'Nguồn yêu cầu không được cho phép.');
        if (!req.is('application/json')) throw new AppError(415, 'JSON_REQUIRED', 'Yêu cầu phải dùng application/json.');
      }
      next();
    } catch (error) { next(error); }
  });
  app.use('/api', express.json({ limit: '16kb' }));
  app.get('/api/context', (_req, res) => {
    res.json({
      mode: config.API_MODE,
      canReopen: res.locals.actor.canReopen && (config.API_MODE === 'mock' || realWritesConfigured(config)),
      actorName: config.API_MODE === 'mock' ? 'Tech Support · Demo' : res.locals.actor.id,
      notice: config.API_MODE === 'mock'
        ? 'Bạn đang dùng dữ liệu mô phỏng. Các thao tác không ảnh hưởng đến học viên thật.'
        : config.LOCAL_PERSONAL_MODE
          ? 'Dữ liệu API thật · Chế độ cá nhân localhost. Bạn có thể tra cứu học viên, khóa học và BTVN; mở lại bài đang bị khóa.'
          : 'Dữ liệu API thật. Mutation mặc định bị khóa; schema và ánh xạ ID cần được kiểm chứng.',
    });
  });
  app.get('/api/students/:studentCode', async (req, res) => {
    const code = studentCodeSchema.parse(req.params.studentCode);
    res.json(await service.search(code, res.locals.actor));
  });
  app.get('/api/students/:studentCode/courses/:enrollmentId/lessons', async (req, res) => {
    const code = studentCodeSchema.parse(req.params.studentCode);
    const enrollment = idSchema.parse(req.params.enrollmentId);
    res.json(await service.lessons(code, enrollment, res.locals.actor));
  });
  app.get('/api/students/:studentCode/courses/:enrollmentId/lessons/:studentLessonId/submissions/:submissionId', async (req, res) => {
    const p = z.object({ studentCode: studentCodeSchema, enrollmentId: idSchema, studentLessonId: idSchema, submissionId: idSchema }).parse(req.params);
    res.json(await service.prepare(p.studentCode, p.enrollmentId, p.studentLessonId, p.submissionId, res.locals.actor));
  });
  app.post('/api/reopen', async (req, res) => {
    const input = reopenInputSchema.parse(req.body);
    res.json(await service.reopen(input, res.locals.actor, res.locals.requestId));
  });
  app.use('/api', (_req, _res, next) => { next(new AppError(404, 'NOT_FOUND', 'API không tồn tại.')); });
  if (options.staticDir) {
    app.use(express.static(options.staticDir, { index: false }));
    app.get('/{*path}', (_req, res) => { res.sendFile(path.resolve(options.staticDir!, 'index.html')); });
  }
  const errors: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    let status = 500, code = 'INTERNAL_ERROR', message = 'Có lỗi xử lý. Vui lòng thử tải lại dữ liệu.', uncertain = false;
    if (error instanceof z.ZodError) { status = 400; code = 'VALIDATION_ERROR'; message = error.issues[0]?.message ?? 'Dữ liệu đầu vào không hợp lệ.'; }
    else if (error instanceof AppError) { ({ status, code, message, uncertain } = error); }
    else if (error && typeof error === 'object' && 'type' in error && error.type === 'entity.parse.failed') { status = 400; code = 'INVALID_JSON'; message = 'Nội dung JSON không hợp lệ.'; }
    else if (error && typeof error === 'object' && 'type' in error && error.type === 'entity.too.large') { status = 413; code = 'PAYLOAD_TOO_LARGE'; message = 'Yêu cầu vượt quá kích thước cho phép.'; }
    res.status(status).json({ error: { code, message, requestId: res.locals.requestId, ...(uncertain ? { uncertain: true } : {}) } });
  };
  app.use(errors);
  return app;
}
