import express, { type ErrorRequestHandler } from 'express';
import cors from 'cors';
import { GenerateGameRequestSchema, ProviderRequestSchema } from '@game-creator/contracts';
import { DemoGameProvider } from './providers/demo-game-provider.js';
import { GameService } from './services/game-service.js';
import { createProviderRegistry } from './providers/create-registry.js';
import { AIError } from './providers/errors.js';
import { GameGenerationService } from './services/game-generation-service.js';
import { RequestBudget } from './services/request-budget.js';
import { AgentOrchestrator } from './agent/orchestrator.js';
import { mountAgentRoutes } from './agent/routes.js';
import { withResponseAbort } from './http/response-abort.js';
import { clientKey } from './http/client-key.js';
import { resolveTrustProxy } from './http/trust-proxy.js';
import { createAgent } from './agent/create-agent.js';

interface AppOptions {
  service?: GameService;
  generationService?: GameGenerationService;
  clientOrigins?: string[];
  agent?: AgentOrchestrator;
  advancedEnabled?: boolean;
  /** Express `trust proxy`. Default: from TRUST_PROXY (loopback in production). */
  trustProxy?: 'loopback' | false;
}

export function createApp(options: AppOptions = {}) {
  const app = express();
  const service = options.service ?? new GameService(new DemoGameProvider());
  const generation = options.generationService ?? new GameGenerationService(createProviderRegistry(), new RequestBudget({
    requestsPerMinute: readLimit('AI_REQUESTS_PER_MINUTE', 5, 60),
    requestsPerDay: readLimit('AI_REQUESTS_PER_DAY', 100, 1_000),
    maxConcurrent: readLimit('AI_MAX_CONCURRENT', 2, 5),
  }), readLimit('AI_TIMEOUT_MS', 45_000, 50_000));
  const origins = options.clientOrigins ?? ['http://localhost:5173', 'http://127.0.0.1:5173'];

  app.disable('x-powered-by');
  // Only the Nginx on this machine may set the client address (X-Forwarded-For).
  app.set('trust proxy', options.trustProxy ?? resolveTrustProxy(process.env));
  app.use(cors({ origin: origins, methods: ['GET', 'POST'] }));
  app.use(express.json({ limit: '16kb' }));
  app.use((_request, response, next) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });

  app.get('/api/health', (_request, response) => {
    response.json({ status: 'ok', service: 'ai-game-creator-api', mode: 'multi-provider' });
  });

  app.get('/api/ai/providers', (_request, response) => {
    response.json({ providers: generation.registry.list() });
  });

  app.post('/api/ai/test-connection', async (request, response) => {
    const parsed = ProviderRequestSchema.safeParse(request.body);
    if (!parsed.success) throw new AIError('invalid_model', 'Hãy chọn provider và model hợp lệ.', 400);
    await withResponseAbort(response, async (signal) => {
      response.json(await generation.testConnection(parsed.data, clientKey(request.ip), signal));
    });
  });

  app.post('/api/games/generate', async (request, response) => {
    const result = GenerateGameRequestSchema.safeParse(request.body);
    if (!result.success) {
      response.status(400).json({
        error: {
          code: 'INVALID_PROMPT',
          message: result.error.issues[0]?.message ?? 'Mô tả game không hợp lệ.',
        },
      });
      return;
    }
    const { providerId, modelId } = result.data;
    if ((!providerId && !modelId) || (providerId === 'demo' && modelId === 'platformer-v1')) {
      response.status(201).json({ data: await service.generate(result.data) });
      return;
    }
    if (!providerId || providerId === 'demo') {
      throw new AIError('invalid_model', 'Cần chọn cả provider và model hợp lệ.', 400);
    }
    await withResponseAbort(response, async (signal) => {
      const project = await generation.generate({ ...result.data, providerId }, clientKey(request.ip), signal);
      response.status(201).json({ data: project });
    });
  });

  const advancedEnabled = options.advancedEnabled ?? (process.env.ADVANCED_AI_ENABLED !== 'false' && process.env.NODE_ENV !== 'production');
  // The sandbox and queue are only built when Advanced can run at all.
  const agent = options.agent ?? (advancedEnabled ? createAgent(generation, process.env) : new AgentOrchestrator(generation));
  app.locals.agent = agent;
  app.locals.advancedEnabled = advancedEnabled;
  mountAgentRoutes(app, agent, advancedEnabled);

  app.use((_request, response) => {
    response.status(404).json({ error: { code: 'NOT_FOUND', message: 'API không tồn tại.' } });
  });

  const errorHandler: ErrorRequestHandler = (error: unknown, _request, response, next) => {
    const kind = typeof error === 'object' && error !== null && 'type' in error ? error.type : undefined;
    if (response.destroyed) return;
    // Once NDJSON has started, Express must close the stream; writing JSON here
    // would corrupt the protocol and raise ERR_HTTP_HEADERS_SENT.
    if (response.headersSent) { next(error); return; }
    if (error instanceof AIError) {
      if (error.retryAfterSeconds) response.setHeader('Retry-After', error.retryAfterSeconds);
      response.status(error.status).json({ error: {
        code: error.code, message: error.message,
        ...(error.retryAfterSeconds ? { retryAfterSeconds: error.retryAfterSeconds } : {}),
        ...(error.issues ? { issues: error.issues } : {}),
      } });
    } else if (kind === 'entity.too.large') {
      response.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Dữ liệu gửi lên quá lớn.' } });
    } else if (kind === 'entity.parse.failed') {
      response.status(400).json({ error: { code: 'INVALID_JSON', message: 'Nội dung JSON không hợp lệ.' } });
    } else {
      console.error('[api] INTERNAL_ERROR');
      response.status(500).json({
        error: { code: 'INTERNAL_ERROR', message: 'Không thể tạo game lúc này. Hãy thử lại.' },
      });
    }
  };
  app.use(errorHandler);
  return app;
}

function readLimit(name: string, fallback: number, maximum: number): number {
  const value = Number(process.env[name] || fallback);
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${name} phải là số nguyên từ 1 đến ${maximum}.`);
  }
  return value;
}
