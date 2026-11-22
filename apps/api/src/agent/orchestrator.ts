// FROZEN: Advanced Mode is off by default and not part of the MVP. See docs/DIRECTION.md.
import { randomUUID } from 'node:crypto';
import { CODE_MAX_REPAIRS, type AgentEvent, type AgentRequest } from '@game-creator/contracts';
import { AIError, StructuredOutputError, normalizeProviderError } from '../providers/errors.js';
import { diagnosticSink } from '../providers/diagnostic-sink.js';
import { GameGenerationService } from '../services/game-generation-service.js';
import { CodeGenerator, CodeRepairAgent, GamePlanner, readSource } from './agents.js';
import { narrowStateReads } from './state-narrowing.js';
import type { ValidationResult } from './code-validator.js';
import { IsolatedCodeValidator } from './isolated-validator.js';
import type { GameTester, TesterReadiness } from './game-tester.js';
import type { ProviderTelemetry } from '../providers/ai-provider.js';
import { NullRunDiagnostics, openRunDiagnostics, type RecordedFailure, type RepairProgress, type RunDiagnostics, type RunSummary } from './run-diagnostics.js';
import { JobQueue, type JobHandle, type RunningJob } from '../services/job-queue.js';

/** Default when no tester is supplied: AI code is never run on the host by accident. */
class FailClosedTester implements GameTester {
  async test(): Promise<never> {
    throw new AIError('tester_unavailable', 'Chưa cấu hình sandbox để kiểm tra game. Advanced không chạy code AI trên máy chủ.', 503);
  }
}

export class AgentOrchestrator {
  /** Reserved jobs, found again by the request object that reserve() returned. */
  private readonly jobs = new WeakMap<AgentRequest, JobHandle>();
  constructor(private readonly generation: GameGenerationService, private readonly tester: GameTester = new FailClosedTester(),
    private readonly validator: { validate(source: string, signal: AbortSignal): ValidationResult | Promise<ValidationResult> } = new IsolatedCodeValidator(),
    private readonly openRun: (request: AgentRequest) => Promise<RunDiagnostics> = openRunDiagnostics,
    // Default: one job and no queue, the behaviour before the queue existed.
    private readonly queue: JobQueue = new JobQueue({ concurrency: 1, maxQueue: 0, runTimeoutMs: 240_000 })) {}

  readiness(): TesterReadiness { return this.tester.readiness?.() ?? { ready: true, message: '' }; }
  startup(): Promise<void> { return this.tester.startup?.() ?? Promise.resolve(); }

  /** Stops admitting jobs, ends waiting and running ones, then stops the sandbox. */
  async shutdown(graceMs = 0): Promise<void> {
    await this.queue.shutdown(graceMs);
    await this.tester.dispose?.();
  }

  // Reserve before starting the response: a full queue or an unavailable
  // sandbox is a plain HTTP error, not a stream that fails afterwards.
  reserve(request: AgentRequest, owner = 'local'): { request: AgentRequest; release: () => void } {
    const readiness = this.readiness();
    if (!readiness.ready) throw new AIError('tester_unavailable', readiness.message, 503);
    const { provider, model } = this.generation.registry.resolve(request.providerId, request.modelId);
    if (!model.capabilities.structuredOutput) throw new AIError('invalid_model', 'Model này không hỗ trợ đầu ra có cấu trúc cho Advanced. Hãy chọn model khác trong Settings.', 400);
    const job = this.queue.admit(owner);
    const resolved: AgentRequest = { ...request, providerId: provider.id, modelId: model.id };
    this.jobs.set(resolved, job);
    return { request: resolved, release: () => job.release() };
  }

  async run(request: AgentRequest, client: string, disconnect: AbortSignal, emit: (event: AgentEvent) => void): Promise<void> {
    const reserved = this.jobs.get(request);
    const job = reserved ?? this.queue.admit(client);
    try {
      if (disconnect.aborted) return;
      let running: RunningJob;
      try {
        running = await job.start(disconnect, (place) => emit({ type: 'status', stage: 'Planning', message: `Đang chờ đến lượt: vị trí ${place} trong hàng đợi Advanced.`, attempt: 0 }));
      } catch (cause) {
        if (disconnect.aborted) return;
        const error = normalizeProviderError(cause);
        emit({ type: 'failed', error: { code: error.code, message: error.message, ...(error.retryAfterSeconds ? { retryAfterSeconds: error.retryAfterSeconds } : {}) } });
        return;
      }
      await this.execute(request, client, disconnect, running.signal, emit);
    } finally {
      if (!reserved) job.release();
    }
  }

  private async execute(request: AgentRequest, client: string, disconnect: AbortSignal, lifecycle: AbortSignal, emit: (event: AgentEvent) => void): Promise<void> {
    // lifecycle aborts with an AIError when the job times out or the server stops.
    const signal = AbortSignal.any([disconnect, lifecycle]);
    let diagnostics: RunDiagnostics = new NullRunDiagnostics();
    const diag = async (task: () => Promise<void>) => { try { await task(); } catch { /* Diagnostics never change the pipeline result. */ } };
    const box: RunSummary = { outcome: 'cancelled', repairs: 0 };
    try {
      if (disconnect.aborted) return;
      try { diagnostics = await this.openRun(request); }
      catch { diagnostics = new NullRunDiagnostics(); }
      if (diagnostics.directory) console.info(`[advanced] diagnostics ${diagnostics.directory}`);
      await diagnosticSink.run(diagnostics, () => this.pipeline(request, client, signal, disconnect, lifecycle, emit, diagnostics, diag, box));
    } finally {
      await diag(() => diagnostics.summary(box));
    }
  }

  private async pipeline(request: AgentRequest, client: string, signal: AbortSignal, disconnect: AbortSignal, lifecycle: AbortSignal, emit: (event: AgentEvent) => void, diagnostics: RunDiagnostics, diag: (task: () => Promise<void>) => Promise<void>, box: RunSummary): Promise<void> {
    let attempt = 0;
    let activeStage: Extract<AgentEvent, { type: 'status' }>['stage'] = 'Planning';
    const status = (stage: Extract<AgentEvent, { type: 'status' }>['stage'], message: string) => { activeStage = stage; emit({ type: 'status', stage, message, attempt }); };
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
      diagnostics.stage = 'planning';
      await diag(() => diagnostics.planningRequest({ provider: request.providerId, model: request.modelId ?? '', prompt: request.prompt, maxOutputTokens: 450 }));
      status('Planning', `${request.providerId} · ${request.modelId} — Đang lập kế hoạch cơ chế chơi.`);
      const plan = await new GamePlanner(this.generation).plan(request, client, signal, observe('Planning'));
      signal.throwIfAborted();
      await diag(() => diagnostics.planningResponse(plan));
      emit({ type: 'plan', plan });
      diagnostics.stage = 'coding';
      status('Coding', 'Đang viết TypeScript cho cơ chế chơi trong kế hoạch.');
      let output = await codeAttempt(() => new CodeGenerator(this.generation).generate(request, plan, client, signal, observe('Coding')));
      await diag(() => diagnostics.agentOutput(output));
      let previousErrors = '';
      for (attempt = 0; attempt <= CODE_MAX_REPAIRS; attempt += 1) {
        if (signal.aborted) throw new AIError('timeout', 'Lượt tạo game đã hết thời gian hoặc bị hủy.', 504);
        status('Validating', 'Kiểm tra TypeScript, API cho phép và giới hạn code.');
        const read = readSource(output);
        const narrowed = read === undefined ? undefined : narrowStateReads(read);
        const source = narrowed?.source;
        const validation = source === undefined ? { errors: [rejectedOutput(output)] } : await this.validator.validate(source, signal);
        signal.throwIfAborted();
        let errors = [...validation.errors];
        if (errors.length > 0 && narrowed) {
          for (const note of narrowed.notes) {
            if (errors.length >= 10) break;
            if (!errors.includes(note)) errors.push(note);
          }
        }
        await diag(() => diagnostics.checkedSource(attempt, {
          ...(typeof read === 'string' ? { before: read } : {}),
          ...(source !== undefined ? { after: source } : {}),
          errors,
        }));
        if (!errors.length && validation.javascript) {
          status('Testing', 'Chạy Chromium cách ly: khởi động, thao tác và chơi lại.');
          const tested = await this.tester.test(validation.javascript, plan, signal, request.prompt);
          errors = tested.errors;
          await diag(() => diagnostics.testing({ attempt, passed: errors.length === 0, errors }));
          signal.throwIfAborted();
          if (!errors.length) {
            await diag(() => diagnostics.checkedProgress(attempt, { errors, fingerprintBefore: previousErrors, fingerprintAfter: errorFingerprint(errors), progress: 'passed' }));
            box.outcome = 'completed';
            box.repairs = attempt;
            status('Completed', 'Game đã qua kiểm tra và sẵn sàng mở preview.');
            emit({ type: 'completed', project: { id: randomUUID(), mode: 'advanced', provider: request.providerId, modelId: request.modelId!, plan, javascript: validation.javascript, repairs: attempt } });
            return;
          }
        }
        const found = errors;
        const fingerprint = errorFingerprint(found);
        const stalled = previousErrors !== '' && fingerprint === previousErrors;
        const fingerprintBefore = previousErrors;
        previousErrors = fingerprint;
        const progress: RepairProgress = attempt > 0 && stalled ? 'repair_no_progress' : found.length ? 'validation_errors' : 'passed';
        await diag(() => diagnostics.checkedProgress(attempt, { errors: found, fingerprintBefore, fingerprintAfter: fingerprint, progress }));
        if (stalled) errors = ['repair_no_progress: lần sửa trước giữ nguyên các lỗi này. Sửa đúng các dòng được liệt kê; không trả lại cùng source.', ...errors];
        emit({ type: 'log', lines: errors.slice(0, 10).map((line) => line.slice(0, 500)) });
        if (attempt === CODE_MAX_REPAIRS) throw new AIError('agent_failed', `Game chưa vượt qua kiểm tra sau 2 lần sửa.${stalled ? ' repair_no_progress.' : ''} Xem log hoặc nhấn Retry để bắt đầu lượt mới.`, 422);
        const repairIndex: 1 | 2 = attempt === 0 ? 1 : 2;
        await diag(() => diagnostics.repairInput(repairIndex, { source: source ?? output, diagnostics: errors, fingerprintBefore: previousErrors, maxOutputTokens: 2400 }));
        diagnostics.stage = repairIndex === 1 ? 'repair-1' : 'repair-2';
        status('Repairing', `Đang sửa lỗi lần ${attempt + 1}/2, giữ nguyên cơ chế được yêu cầu.`);
        output = await codeAttempt(() => new CodeRepairAgent(this.generation).repair(request, plan, source ?? output, errors, client, signal, observe('Repairing')));
        await diag(() => diagnostics.agentOutput(output));
      }
    } catch (cause) {
      if (disconnect.aborted) {
        box.failedStage = activeStage;
        return;
      }
      const error = lifecycle.aborted && lifecycle.reason instanceof AIError ? lifecycle.reason : normalizeProviderError(cause);
      box.outcome = 'failed';
      box.failedStage = activeStage;
      box.errorCode = error.code;
      box.errorMessage = error.message;
      box.repairs = attempt;
      await diag(() => diagnostics.stageError(recordedFailure(error)));
      status('Failed', error.message);
      emit({ type: 'failed', error: { code: error.code, message: error.message, ...(error.retryAfterSeconds ? { retryAfterSeconds: error.retryAfterSeconds } : {}) } });
    }
  }
}

function errorFingerprint(errors: readonly string[]): string {
  return errors.map((line) => line.replace(/game.ts:\d+:\s*/g, '').replace(/`[^`]*`\s*/g, '')).sort().join('\n');
}

function recordedFailure(error: AIError): RecordedFailure {
  const failure: RecordedFailure = { code: error.code, message: error.message, contentPresent: false };
  if (!(error instanceof StructuredOutputError)) return failure;
  if (error.providerStatus !== undefined) failure.httpStatus = error.providerStatus;
  if (error.schemaPath) failure.schemaPath = error.schemaPath;
  if (error.failedGeneration) {
    failure.rawContent = error.failedGeneration;
    failure.contentPresent = true;
  }
  return failure;
}

function rejectedOutput(output: string): string {
  try {
    const parsed = JSON.parse(output) as { generationError?: unknown };
    if (typeof parsed.generationError === 'string') return parsed.generationError.slice(0, 500);
  } catch { /* The model text itself was not JSON. */ }
  return 'Provider không trả JSON code hợp lệ (thiếu source hoặc setup/update/helpers). Một file TypeScript tối đa 24 KB. Đây không phải lỗi TypeScript hay hết quota.';
}
