import { randomUUID } from 'node:crypto';
import { CODE_MAX_REPAIRS, type AgentEvent, type AgentRequest } from '@game-creator/contracts';
import { AIError, normalizeProviderError } from '../providers/errors.js';
import { GameGenerationService } from '../services/game-generation-service.js';
import { CodeGenerator, CodeRepairAgent, GamePlanner, readSource } from './agents.js';
import type { ValidationResult } from './code-validator.js';
import { IsolatedCodeValidator } from './isolated-validator.js';
import { PlaywrightGameTester, type GameTester } from './game-tester.js';
import type { ProviderTelemetry } from '../providers/ai-provider.js';

export class AgentOrchestrator {
  private active = false;
  constructor(private readonly generation: GameGenerationService, private readonly tester: GameTester = new PlaywrightGameTester(),
    private readonly validator: { validate(source: string, signal: AbortSignal): ValidationResult | Promise<ValidationResult> } = new IsolatedCodeValidator()) {}

  // Reserve before starting the response. No queue and only one browser job.
  reserve(request: AgentRequest): { request: AgentRequest; release: () => void } {
    if (this.active) throw new AIError('rate_limit', 'Advanced đang xử lý một game. Hãy chờ hoàn tất.', 429, 10);
    const { provider, model } = this.generation.registry.resolve(request.providerId, request.modelId);
    if (!model.capabilities.structuredOutput) throw new AIError('invalid_model', 'Model này không hỗ trợ đầu ra có cấu trúc cho Advanced. Hãy chọn model khác trong Settings.', 400);
    this.active = true;
    let released = false;
    return {
      request: { ...request, providerId: provider.id, modelId: model.id },
      release: () => {
        if (released) return;
        released = true;
        this.active = false;
      },
    };
  }

  async run(request: AgentRequest, client: string, disconnect: AbortSignal, emit: (event: AgentEvent) => void): Promise<void> {
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(), 240_000);
    const signal = AbortSignal.any([disconnect, deadline.signal]);
    let attempt = 0;
    const status = (stage: Extract<AgentEvent, { type: 'status' }>['stage'], message: string) => emit({ type: 'status', stage, message, attempt });
    const codeAttempt = async (generate: () => Promise<string>): Promise<string> => {
      try { return await generate(); }
      catch (error) {
        // Malformed/truncated provider output consumes the existing repair
        // allowance; transport/auth/quota errors never become code repairs.
        if (error instanceof AIError && (error.code === 'invalid_code' || error.code === 'invalid_game_spec')) {
          emit({ type: 'log', lines: [error.message] });
          return JSON.stringify({ generationError: error.message });
        }
        throw error;
      }
    };
    const observe = (stage: 'Planning' | 'Coding' | 'Repairing') => (event: ProviderTelemetry) => {
      signal.throwIfAborted();
      if (event.type === 'wait') {
        status(stage, `Groq: chờ ${Math.ceil(event.milliseconds / 1000)} giây để giữ trong rate limit (${event.reason}).`);
      } else emit({ type: 'log', lines: [
        `${event.provider} · ${stage}: input ${event.inputTokens}, output ${event.outputTokens} token (reasoning ${event.reasoningTokens} nằm trong output); cap ${event.maxOutputTokens}.`,
        `Ước lượng input ${event.estimatedInputTokens}; quota còn ${event.remainingTokens ?? '?'} / ${event.limitTokens ?? '?'} TPM.`,
      ] });
    };
    try {
      signal.throwIfAborted();
      status('Planning', `${request.providerId} · ${request.modelId} — Đang lập kế hoạch cơ chế chơi.`);
      const plan = await new GamePlanner(this.generation).plan(request, client, signal, observe('Planning'));
      signal.throwIfAborted();
      emit({ type: 'plan', plan });
      status('Coding', 'Đang viết TypeScript cho cơ chế chơi trong kế hoạch.');
      let output = await codeAttempt(() => new CodeGenerator(this.generation).generate(request, plan, client, signal, observe('Coding')));
      for (attempt = 0; attempt <= CODE_MAX_REPAIRS; attempt += 1) {
        if (signal.aborted) throw new AIError('timeout', 'Lượt tạo game đã hết thời gian hoặc bị hủy.', 504);
        status('Validating', 'Kiểm tra TypeScript, API cho phép và giới hạn code.');
        const source = readSource(output);
        const validation = source === undefined ? { errors: ['Provider phải trả JSON {source: string}, một file TypeScript tối đa 24 KB.'] } : await this.validator.validate(source, signal);
        signal.throwIfAborted();
        let errors = validation.errors;
        if (!errors.length && validation.javascript) {
          status('Testing', 'Chạy Chromium cách ly: khởi động, thao tác và chơi lại.');
          errors = (await this.tester.test(validation.javascript, plan, signal, request.prompt)).errors;
          signal.throwIfAborted();
          if (!errors.length) {
            status('Completed', 'Game đã qua kiểm tra và sẵn sàng mở preview.');
            emit({ type: 'completed', project: { id: randomUUID(), mode: 'advanced', provider: request.providerId, modelId: request.modelId!, plan, javascript: validation.javascript, repairs: attempt } });
            return;
          }
        }
        emit({ type: 'log', lines: errors.slice(0, 10).map((line) => line.slice(0, 500)) });
        if (attempt === CODE_MAX_REPAIRS) throw new AIError('agent_failed', 'Game chưa vượt qua kiểm tra sau 2 lần sửa. Xem log hoặc nhấn Retry để bắt đầu lượt mới.', 422);
        status('Repairing', `Đang sửa lỗi lần ${attempt + 1}/2, giữ nguyên cơ chế được yêu cầu.`);
        output = await codeAttempt(() => new CodeRepairAgent(this.generation).repair(request, plan, source ?? output, errors, client, signal, observe('Repairing')));
      }
    } catch (cause) {
      if (disconnect.aborted) return;
      const error = deadline.signal.aborted ? new AIError('timeout', 'Advanced đã hết thời hạn 4 phút.', 504) : normalizeProviderError(cause);
      status('Failed', error.message);
      emit({ type: 'failed', error: { code: error.code, message: error.message, ...(error.retryAfterSeconds ? { retryAfterSeconds: error.retryAfterSeconds } : {}) } });
    } finally {
      clearTimeout(timer);
    }
  }
}
