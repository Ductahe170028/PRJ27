// What one generation leaves on the developer's disk (off in production and in tests): the request, the provider's output
// (redacted), what was parsed, the validation result and a summary. The names below are kept as they were so that nobody
// has to change a habit: the variables STANDARD_DIAGNOSTICS (0 turns it off, 1 turns it on in tests) and
// STANDARD_DIAGNOSTICS_DIR, the folder .local-diagnostics/, the run folders called standard-<time>-<id> and the file names.
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { redactDiagnostics, type DiagnosticIO } from './redact.js';
import type { DiagnosticSink, ProviderExchange } from '../providers/diagnostic-sink.js';
import type { SpecIssue } from '../providers/errors.js';

export type DiagnosticStage = 'provider' | 'parse' | 'normalize' | 'schema' | 'repair' | 'response';
export type DiagnosticReason = 'completed' | 'schema_mismatch' | 'schema_rejected' | 'no_content'
  | 'invalid_json' | 'normalize' | 'game_spec' | 'repair' | 'response' | 'provider_error';

/** Provider output kept for one run. Larger generations are truncated before redaction. */
const OUTPUT_LIMIT = 65_536;

export interface DiagnosticsRequest {
  prompt: string;
  provider: string;
  model: string;
}

export type DiagnosticsValidation =
  | { status: 'not_reached' }
  | { status: 'checked'; schema: 'ShooterBriefSchema'; success: boolean; issues: SpecIssue[] };

export interface DiagnosticsFinish {
  stage: DiagnosticStage;
  outcome: 'completed' | 'failed';
  raw?: string;
  parsed: unknown;
  normalized: unknown;
  validation: DiagnosticsValidation;
  issues: SpecIssue[];
  errorCode?: string;
  errorMessage?: string;
  /** The shooter's compile report (map, gate wins, density steps): numbers and names only. */
  report?: unknown;
}

export interface RunDiagnostics extends DiagnosticSink {
  raw(text: string): Promise<void>;
  finish(record: DiagnosticsFinish): Promise<void>;
}

const silentDiagnostics: RunDiagnostics = {
  async note() {},
  async raw() {},
  async finish() {},
};

export function diagnosticReason(stage: DiagnosticStage, outcome: 'completed' | 'failed', exchange?: ProviderExchange): DiagnosticReason {
  if (outcome === 'completed') return 'completed';
  if (stage === 'parse') return 'invalid_json';
  if (stage === 'normalize') return 'normalize';
  if (stage === 'schema') return 'game_spec';
  if (stage === 'repair') return 'repair';
  if (stage === 'response') return 'response';
  if (exchange?.errorCode === 'json_validate_failed' && exchange.failedGenerationPresent) return 'schema_mismatch';
  if (exchange?.errorCode === 'json_validate_failed') return 'schema_rejected';
  if (exchange && !exchange.contentPresent && !exchange.failedGenerationPresent && exchange.errorCode === undefined) return 'no_content';
  return 'provider_error';
}

function capped(text: string): string {
  return text.length > OUTPUT_LIMIT ? text.slice(0, OUTPUT_LIMIT) : text;
}

function exchangeMetadata(exchange: ProviderExchange): Record<string, unknown> {
  const format = exchange.responseFormat && typeof exchange.responseFormat === 'object'
    ? exchange.responseFormat as Record<string, unknown> : undefined;
  const metadata: Record<string, unknown> = {
    provider: exchange.provider,
    model: exchange.model,
    contentPresent: exchange.contentPresent,
    failedGenerationPresent: exchange.failedGenerationPresent === true,
  };
  if (exchange.httpStatus !== undefined) metadata.httpStatus = exchange.httpStatus;
  if (exchange.errorCode !== undefined) metadata.schemaCode = exchange.errorCode;
  if (exchange.schemaPath !== undefined) metadata.schemaPath = exchange.schemaPath;
  if (exchange.errorMessage !== undefined) metadata.errorMessage = exchange.errorMessage;
  if (exchange.usage) metadata.usage = exchange.usage;
  if (format) {
    metadata.responseFormat = {
      ...(typeof format.type === 'string' ? { type: format.type } : {}),
      ...(typeof format.name === 'string' ? { name: format.name } : {}),
      ...(typeof format.strict === 'boolean' ? { strict: format.strict } : {}),
      ...(Array.isArray(format.unsupportedKeywords) ? { unsupportedKeywords: format.unsupportedKeywords } : {}),
    };
  }
  return metadata;
}

export function diagnosticsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_ENV === 'production' || env.STANDARD_DIAGNOSTICS === '0') return false;
  if (env.NODE_ENV === 'test') return env.STANDARD_DIAGNOSTICS === '1';
  return true;
}

export function diagnosticsRoot(env: NodeJS.ProcessEnv = process.env): string {
  if (env.STANDARD_DIAGNOSTICS_DIR) return env.STANDARD_DIAGNOSTICS_DIR;
  return fileURLToPath(new URL('../../../../.local-diagnostics/', import.meta.url));
}

function formatStamp(date: Date): string {
  const part = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}${part(date.getMonth() + 1)}${part(date.getDate())}-${part(date.getHours())}${part(date.getMinutes())}${part(date.getSeconds())}`;
}

async function allocateRun(root: string, now = new Date()): Promise<{ runId: string; directory: string }> {
  await mkdir(root, { recursive: true });
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const runId = `standard-${formatStamp(now)}-${randomBytes(2).toString('hex')}`;
    const directory = path.join(root, runId);
    try {
      await mkdir(directory);
      return { runId, directory };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
  const runId = `standard-${formatStamp(now)}-${randomUUID().slice(0, 8)}`;
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

export class DiagnosticsRun implements RunDiagnostics {
  private wroteRaw = false;
  private exchange: ProviderExchange | undefined;

  constructor(
    readonly runId: string,
    readonly directory: string,
    private readonly io: DiagnosticIO = defaultIO,
  ) {}

  static async create(input: DiagnosticsRequest, root = diagnosticsRoot(), io?: DiagnosticIO): Promise<DiagnosticsRun> {
    const allocated = await allocateRun(root);
    const run = new DiagnosticsRun(allocated.runId, allocated.directory, io);
    await run.writeJson('request.json', {
      runId: allocated.runId,
      prompt: input.prompt,
      promptLength: input.prompt.length,
      provider: input.provider,
      model: input.model,
    });
    return run;
  }

  async note(exchange: ProviderExchange): Promise<void> {
    const safe = redactDiagnostics({
      ...exchange,
      ...(exchange.rawContent !== undefined ? { rawContent: capped(exchange.rawContent) } : {}),
    }) as ProviderExchange;
    this.exchange = safe;
    await this.safe(async () => {
      await this.writeJson('provider-exchange.json', exchangeMetadata(safe));
      if (safe.rawContent) {
        await this.writeText('provider-output.txt', safe.rawContent);
        this.wroteRaw = true;
      }
    });
  }

  async raw(text: string): Promise<void> {
    await this.safe(async () => {
      await this.writeText('provider-output.txt', capped(text));
      this.wroteRaw = true;
    });
  }

  async finish(record: DiagnosticsFinish): Promise<void> {
    const retained = record.raw ?? this.exchange?.rawContent;
    if (retained !== undefined && !this.wroteRaw) await this.safe(() => this.writeText('provider-output.txt', capped(retained)));
    await this.safe(() => this.writeJson('parsed.json', record.parsed));
    await this.safe(() => this.writeJson('normalized.json', record.normalized));
    await this.safe(() => this.writeJson('validation.json', record.validation));
    const summary: Record<string, unknown> = {
      runId: this.runId,
      stage: record.stage,
      outcome: record.outcome,
      reason: diagnosticReason(record.stage, record.outcome, this.exchange),
      issues: record.issues,
    };
    if (record.errorCode !== undefined) summary.errorCode = record.errorCode;
    if (record.errorMessage !== undefined) summary.errorMessage = record.errorMessage;
    if (record.report !== undefined) summary.compile = record.report;
    if (this.exchange?.httpStatus !== undefined) summary.httpStatus = this.exchange.httpStatus;
    if (this.exchange?.errorCode !== undefined) summary.schemaCode = this.exchange.errorCode;
    if (this.exchange?.schemaPath !== undefined) summary.schemaPath = this.exchange.schemaPath;
    if (this.exchange) summary.failedGenerationPresent = this.exchange.failedGenerationPresent === true;
    if (this.exchange) summary.contentPresent = this.exchange.contentPresent;
    await this.safe(() => this.writeJson('summary.json', summary));
  }

  private async safe(task: () => Promise<void>): Promise<void> {
    try { await task(); } catch { /* A disk failure must not change the generation result. */ }
  }

  private async writeText(name: string, text: string): Promise<void> {
    await this.io.writeFile(path.join(this.directory, name), redactDiagnostics(text));
  }

  private async writeJson(name: string, value: unknown): Promise<void> {
    await this.writeText(name, `${JSON.stringify(redactDiagnostics(value), null, 2)}\n`);
  }
}

export async function openRunDiagnostics(input: DiagnosticsRequest): Promise<RunDiagnostics> {
  if (!diagnosticsEnabled()) return silentDiagnostics;
  try { return await DiagnosticsRun.create(input); }
  catch { return silentDiagnostics; }
}
