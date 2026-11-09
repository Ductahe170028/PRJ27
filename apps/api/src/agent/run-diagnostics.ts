import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AgentRequest } from '@game-creator/contracts';
import type { DiagnosticSink, ProviderExchange } from '../providers/diagnostic-sink.js';

export type DiagnosticStage = 'planning' | 'coding' | 'repair-1' | 'repair-2';
export type RepairProgress = 'passed' | 'validation_errors' | 'repair_no_progress';

export interface DiagnosticIO {
  writeFile(file: string, data: string): Promise<void>;
}

export interface RecordedFailure {
  code: string;
  message: string;
  contentPresent: boolean;
  httpStatus?: number;
  schemaPath?: string;
  rawContent?: string;
}

export interface RunSummary {
  outcome: 'completed' | 'failed' | 'cancelled';
  failedStage?: string;
  errorCode?: string;
  errorMessage?: string;
  repairs: number;
}

const SECRET_KEY = /^(?:authorization|proxy-authorization|api[-_]?key|x-api-key|cookie|set-cookie|headers)$/i;
const SECRET_TEXT = /(?:bearer\s+[A-Za-z0-9._~+/-]+=*|gsk_[A-Za-z0-9]+|sk-[A-Za-z0-9]+|(?:authorization|api[_-]?key|groq_api_key|gemini_api_key)\s*[:=]\s*\S+(?:\s+\S+)?)/gi;

export function redactDiagnostics(value: string): string;
export function redactDiagnostics(value: unknown): unknown;
export function redactDiagnostics(value: unknown): unknown {
  if (typeof value === 'string') return value.replace(SECRET_TEXT, '[redacted]');
  if (Array.isArray(value)) return value.map((item) => redactDiagnostics(item));
  if (!value || typeof value !== 'object') return value;
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) continue;
    output[key] = redactDiagnostics(child);
  }
  return output;
}

export function diagnosticsRoot(): string {
  return fileURLToPath(new URL('../../../../.local-diagnostics/', import.meta.url));
}

export function diagnosticsEnabled(): boolean {
  if (process.env.NODE_ENV === 'production' || process.env.ADVANCED_DIAGNOSTICS === '0') return false;
  if (process.env.NODE_ENV === 'test' && process.env.ADVANCED_DIAGNOSTICS !== '1') return false;
  return true;
}

function formatStamp(date: Date): string {
  const part = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}${part(date.getMonth() + 1)}${part(date.getDate())}-${part(date.getHours())}${part(date.getMinutes())}${part(date.getSeconds())}`;
}

export async function allocateRun(root: string, now = new Date()): Promise<{ runId: string; directory: string }> {
  await mkdir(root, { recursive: true });
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const runId = `advanced-${formatStamp(now)}-${randomBytes(2).toString('hex')}`;
    const directory = path.join(root, runId);
    try {
      await mkdir(directory);
      return { runId, directory };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
  const runId = `advanced-${formatStamp(now)}-${randomUUID().slice(0, 8)}`;
  const directory = path.join(root, runId);
  await mkdir(directory);
  return { runId, directory };
}

const defaultIO: DiagnosticIO = {
  async writeFile(file, data) {
    const temporary = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
    await writeFile(temporary, data, 'utf8');
    try {
      await rename(temporary, file);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EEXIST' || code === 'EPERM' || code === 'EBUSY') {
        await rm(file, { force: true });
        await rename(temporary, file);
        return;
      }
      await rm(temporary, { force: true });
      throw error;
    }
  },
};

function defined(value: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

export function folderForAttempt(attempt: number): DiagnosticStage {
  if (attempt <= 0) return 'coding';
  return attempt === 1 ? 'repair-1' : 'repair-2';
}

export interface RunDiagnostics extends DiagnosticSink {
  readonly runId: string;
  readonly directory: string;
  stage: DiagnosticStage;
  planningRequest(meta: { provider: string; model: string; prompt: string; maxOutputTokens: number }): Promise<void>;
  planningResponse(plan: unknown): Promise<void>;
  agentOutput(agentOutput: string): Promise<void>;
  checkedSource(attempt: number, snapshot: { before?: string; after?: string; errors: readonly string[] }): Promise<void>;
  testing(result: { attempt: number; passed: boolean; errors: readonly string[] }): Promise<void>;
  checkedProgress(attempt: number, progress: { errors: readonly string[]; fingerprintBefore: string; fingerprintAfter: string; progress: RepairProgress }): Promise<void>;
  repairInput(index: 1 | 2, input: { source: string; diagnostics: readonly string[]; fingerprintBefore: string; maxOutputTokens: number }): Promise<void>;
  stageError(failure: RecordedFailure): Promise<void>;
  summary(summary: RunSummary): Promise<void>;
}

export class NullRunDiagnostics implements RunDiagnostics {
  readonly runId = '';
  readonly directory = '';
  stage: DiagnosticStage = 'planning';
  async note(): Promise<void> { /* Diagnostics are off. */ }
  async planningRequest(): Promise<void> { /* Diagnostics are off. */ }
  async planningResponse(): Promise<void> { /* Diagnostics are off. */ }
  async agentOutput(): Promise<void> { /* Diagnostics are off. */ }
  async checkedSource(): Promise<void> { /* Diagnostics are off. */ }
  async testing(): Promise<void> { /* Diagnostics are off. */ }
  async checkedProgress(): Promise<void> { /* Diagnostics are off. */ }
  async repairInput(): Promise<void> { /* Diagnostics are off. */ }
  async stageError(): Promise<void> { /* Diagnostics are off. */ }
  async summary(): Promise<void> { /* Diagnostics are off. */ }
}

export class FileRunDiagnostics implements RunDiagnostics {
  stage: DiagnosticStage = 'planning';
  private readonly stages: string[] = [];
  private readonly exchanges = new Map<DiagnosticStage, ProviderExchange[]>();
  private readonly last = new Map<DiagnosticStage, ProviderExchange>();
  private requestMeta: Record<string, unknown> = {};
  private tail: Promise<void> = Promise.resolve();

  private constructor(
    readonly runId: string,
    readonly directory: string,
    private readonly root: string,
    private readonly startedAt: string,
    private readonly providerId: string,
    private readonly modelId: string,
    private readonly io: DiagnosticIO,
  ) {}

  static async create(request: AgentRequest, root: string, io: DiagnosticIO = defaultIO, now = new Date()): Promise<FileRunDiagnostics> {
    const allocated = await allocateRun(root, now);
    const run = new FileRunDiagnostics(allocated.runId, allocated.directory, root, now.toISOString(), request.providerId, request.modelId ?? '', io);
    await run.writeManifest().catch(() => undefined);
    await run.writeLatest().catch(() => undefined);
    return run;
  }

  note(exchange: ProviderExchange): Promise<void> {
    const stage = this.stage;
    const safe = redactDiagnostics(exchange) as ProviderExchange;
    return this.enqueue(async () => {
      const list = this.exchanges.get(stage) ?? [];
      list.push(safe);
      this.exchanges.set(stage, list);
      this.last.set(stage, safe);
      await this.writeJson(`${stage}/exchanges.json`, list);
      const failed = (safe.httpStatus ?? 0) >= 400 || Boolean(safe.errorCode);
      if (stage === 'planning') {
        await this.writeJson(failed ? 'planning/error.json' : 'planning/response.json', safe);
        if (safe.responseFormat !== undefined) {
          this.requestMeta = { ...this.requestMeta, responseFormat: safe.responseFormat };
          await this.writeJson('planning/request.json', this.requestMeta);
        }
      } else if (failed) await this.writeJson(`${stage}/error.json`, safe);
      else await this.writeJson(`${stage}/raw-output.json`, { model: safe });
      await this.mark(`${stage}:exchange`);
    });
  }

  planningRequest(meta: { provider: string; model: string; prompt: string; maxOutputTokens: number }): Promise<void> {
    return this.enqueue(async () => {
      this.requestMeta = { ...this.requestMeta, ...meta, promptChars: meta.prompt.length };
      await this.writeJson('planning/request.json', this.requestMeta);
      await this.mark('planning:request');
    });
  }

  planningResponse(plan: unknown): Promise<void> {
    return this.enqueue(async () => {
      const exchange = this.last.get('planning');
      await this.writeJson('planning/response.json', { ...(exchange ?? {}), plan });
      await this.mark('planning:response');
    });
  }

  agentOutput(agentOutput: string): Promise<void> {
    const stage = this.stage;
    if (stage === 'planning') return Promise.resolve();
    return this.enqueue(async () => {
      const model = this.last.get(stage);
      await this.writeJson(`${stage}/raw-output.json`, { ...(model ? { model } : {}), agentOutput });
      await this.mark(`${stage}:raw`);
    });
  }

  checkedSource(attempt: number, snapshot: { before?: string; after?: string; errors: readonly string[] }): Promise<void> {
    const folder = folderForAttempt(attempt);
    return this.enqueue(async () => {
      if (snapshot.before !== undefined) await this.writeText(`${folder}/source.ts`, snapshot.before);
      if (snapshot.after !== undefined) await this.writeText(`${folder}/normalized-source.ts`, snapshot.after);
      await this.writeJson(`${folder}/errors.json`, { errors: snapshot.errors });
      await this.writeJson(`validation/attempt-${attempt}.json`, { attempt, folder, errors: snapshot.errors });
      await this.mark(`${folder}:source`);
    });
  }

  testing(result: { attempt: number; passed: boolean; errors: readonly string[] }): Promise<void> {
    const folder = folderForAttempt(result.attempt);
    return this.enqueue(async () => {
      const body = { ...result, source: `${folder}/normalized-source.ts` };
      await this.writeJson('testing/result.json', body);
      await this.writeJson(`testing/attempt-${result.attempt}.json`, body);
      await this.mark('testing');
    });
  }

  checkedProgress(attempt: number, progress: { errors: readonly string[]; fingerprintBefore: string; fingerprintAfter: string; progress: RepairProgress }): Promise<void> {
    const folder = folderForAttempt(attempt);
    return this.enqueue(async () => {
      await this.writeJson(`${folder}/errors.json`, progress);
      await this.writeJson('validation/result.json', { attempt, folder, ...progress });
      await this.mark(`${folder}:progress`);
    });
  }

  repairInput(index: 1 | 2, input: { source: string; diagnostics: readonly string[]; fingerprintBefore: string; maxOutputTokens: number }): Promise<void> {
    return this.enqueue(async () => {
      await this.writeText(`repair-${index}/input-source.ts`, input.source);
      await this.writeJson(`repair-${index}/request.json`, input);
      await this.mark(`repair-${index}:input`);
    });
  }

  stageError(failure: RecordedFailure): Promise<void> {
    const stage = this.stage;
    return this.enqueue(async () => {
      const prior = this.last.get(stage);
      const file = stage === 'planning' ? 'planning/error.json' : `${stage}/error.json`;
      await this.writeJson(file, { ...(prior ?? {}), ...defined(failure) });
      await this.mark(`${stage}:error`);
    });
  }

  summary(summary: RunSummary): Promise<void> {
    return this.enqueue(async () => {
      await this.writeJson('final-summary.json', {
        runId: this.runId,
        ...defined(summary),
        previewReady: summary.outcome === 'completed',
        finishedAt: new Date().toISOString(),
      });
      await this.mark('final');
    });
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    const run = this.tail.then(task, task);
    this.tail = run.then(() => undefined, () => undefined);
    return run.catch(() => undefined);
  }

  private async writeManifest(): Promise<void> {
    await this.writeJson('manifest.json', {
      runId: this.runId, startedAt: this.startedAt, providerId: this.providerId, modelId: this.modelId, stages: this.stages,
    });
  }

  private async writeLatest(): Promise<void> {
    await this.io.writeFile(path.join(this.root, 'latest-advanced.txt'), `${this.runId}\n`);
  }

  private async mark(stage: string): Promise<void> {
    if (!this.stages.includes(stage)) this.stages.push(stage);
    await this.writeManifest();
  }

  private async writeJson(relative: string, value: unknown): Promise<void> {
    await this.writeText(relative, JSON.stringify(redactDiagnostics(value), null, 2));
  }

  private async writeText(relative: string, text: string): Promise<void> {
    const file = this.resolve(relative);
    await mkdir(path.dirname(file), { recursive: true });
    await this.io.writeFile(file, redactDiagnostics(text));
  }

  private resolve(relative: string): string {
    const root = path.resolve(this.directory);
    const full = path.resolve(root, relative);
    const delta = path.relative(root, full);
    if (delta.startsWith('..') || path.isAbsolute(delta)) throw new Error('diagnostics path');
    return full;
  }
}

export function createRunDiagnostics(request: AgentRequest, root: string, io?: DiagnosticIO): Promise<RunDiagnostics> {
  return FileRunDiagnostics.create(request, root, io);
}

export function openRunDiagnostics(request: AgentRequest): Promise<RunDiagnostics> {
  if (!diagnosticsEnabled()) return Promise.resolve(new NullRunDiagnostics());
  return createRunDiagnostics(request, diagnosticsRoot()).catch(() => new NullRunDiagnostics());
}
