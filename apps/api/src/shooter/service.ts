// POST /api/shooter/generate: prompt -> brief (AI) -> level (compiler) -> bot gate -> project.
// The provider is called once. There is no retry, no second call, and no
// fallback to another game when something fails.
import { randomInt, randomUUID } from 'node:crypto';
import {
  SHOOTER_LEVELS, ShooterProjectSchema, type GenerateGameRequest, type ShooterProject,
} from '@game-creator/contracts';
import { AIError, type SpecIssue } from '../providers/errors.js';
import { diagnosticSink } from '../providers/diagnostic-sink.js';
import type { AiGateway } from '../services/ai-gateway.js';
import { openRunDiagnostics, type RunDiagnostics, type DiagnosticsFinish, type DiagnosticsRequest } from '../services/run-diagnostics.js';
import { normalizeBrief, ShooterBriefSchema, type ShooterBrief } from './brief.js';
import { compileInWorker, type CompileRunner } from './isolated-compile.js';
import { collectNotices, guardUnrequested } from './notices.js';
import { guardWeapons } from './weapon-guard.js';
import { SHOOTER_BRIEF_SYSTEM_PROMPT, briefJsonSchema } from './prompt.js';
import type { CompiledShooter } from './compile-job.js';

/** The model's answer is a few hundred characters; anything past this is not a brief. */
const BRIEF_MAX_BYTES = 16_384;
export const BRIEF_MAX_OUTPUT_TOKENS = 700;
export const INVALID_BRIEF_MESSAGE = 'Mô hình trả về mô tả game không hợp lệ. Hãy thử lại hoặc diễn đạt lại ý tưởng.';
export const NOT_JSON_MESSAGE = 'Mô hình không trả về JSON hợp lệ. Hãy thử lại hoặc diễn đạt lại ý tưởng.';

/** One short reason from the FIRST failing path, through a fixed table: nothing
 * from Zod, the prompt or the model's text is ever copied. */
export function briefReason(path: string | undefined): string {
  const head = (path ?? '').split('.')[0];
  switch (head) {
    case 'theme': case 'map': case 'weapon': case 'playerHealth':
      return `Mô hình chọn một giá trị không hỗ trợ cho ${head}.`;
    case 'enemies': return 'Danh sách quái không hợp lệ.';
    case 'goal': return 'Mục tiêu không hợp lệ.';
    default: return 'Bản mô tả game không đúng khuôn dạng.';
  }
}

interface Capture {
  stage: 'provider' | 'parse' | 'normalize' | 'schema' | 'repair' | 'ok';
  parsed?: unknown;
  normalized?: unknown;
  validationSuccess: boolean;
  issues: SpecIssue[];
  report?: unknown;
}

const cancelled = () => new AIError('cancelled', 'Yêu cầu đã bị hủy.', 499);

export interface ShooterServiceOptions {
  compile?: CompileRunner;
  openDiagnostics?: (input: DiagnosticsRequest) => Promise<RunDiagnostics>;
  /** Test seam: the seed of the compiler (the server draws a random one). */
  seed?: () => number;
}

export class ShooterService {
  private readonly compile: CompileRunner;
  private readonly openDiagnostics: (input: DiagnosticsRequest) => Promise<RunDiagnostics>;
  private readonly seed: () => number;

  constructor(private readonly gateway: AiGateway, options: ShooterServiceOptions = {}) {
    this.compile = options.compile ?? compileInWorker;
    this.openDiagnostics = options.openDiagnostics ?? openRunDiagnostics;
    this.seed = options.seed ?? (() => randomInt(2_147_483_648));
  }

  /** No AI: the hand-made arena. */
  demo(prompt: string): ShooterProject {
    return ShooterProjectSchema.parse({
      id: randomUUID(), title: SHOOTER_LEVELS.arena.title, prompt, provider: 'demo', modelId: 'shooter-arena',
      createdAt: new Date().toISOString(), level: SHOOTER_LEVELS.arena, notices: [],
    });
  }

  async generate(request: GenerateGameRequest & { providerId: string }, client: string, signal: AbortSignal): Promise<ShooterProject> {
    const { provider, model } = this.gateway.registry.resolve(request.providerId, request.modelId);
    if (signal.aborted) throw cancelled();
    const diag = await this.begin({ prompt: request.prompt, provider: provider.id, model: model.id });
    const capture: Capture = { stage: 'provider', validationSuccess: false, issues: [] };
    let raw: string | undefined;
    try {
      raw = await diagnosticSink.run(diag, () => this.gateway.generateArtifact(
        { providerId: provider.id, modelId: model.id },
        { prompt: request.prompt, systemPrompt: SHOOTER_BRIEF_SYSTEM_PROMPT, jsonSchema: briefJsonSchema(), maxOutputTokens: BRIEF_MAX_OUTPUT_TOKENS },
        client, signal,
      ));
      await this.note(() => diag.raw(raw!));
      // A feature the model added that the text never asked for (health drops, a base) is taken out; the diagnostics say so.
      const unrequested = guardUnrequested(this.parseBrief(raw, capture), request.prompt);
      const { removed } = unrequested;
      // The weapon and the loadout are decided by the user's own words, not by the model (weapon-guard.ts)
      const weapons = guardWeapons(unrequested.brief, request.prompt);
      const { brief } = weapons;
      capture.stage = 'repair';
      const compiled: CompiledShooter = await this.compile({ brief, seed: this.seed() }, signal);
      capture.report = {
        ...compiled.report,
        ...(removed.length > 0 ? { guardRemoved: removed } : {}),
        ...(weapons.changed.length > 0 ? { guardChanged: weapons.changed } : {}),
      };
      const project = ShooterProjectSchema.parse({
        id: randomUUID(), title: compiled.level.title, prompt: request.prompt, provider: provider.id, modelId: model.id,
        createdAt: new Date().toISOString(), level: compiled.level,
        notices: collectNotices({ prompt: request.prompt, unsupported: brief.unsupported, engine: [...compiled.notices, ...weapons.notices] }),
      });
      capture.stage = 'ok';
      await this.note(() => diag.finish(this.finish(capture, 'completed', raw)));
      return project;
    } catch (caught) {
      // An abort that the provider layer raises as a bare AbortError is still a cancellation.
      const error = caught instanceof DOMException && caught.name === 'AbortError' ? cancelled() : caught;
      const stage = capture.stage === 'ok' ? 'repair' : capture.stage;
      await this.note(() => diag.finish(this.finish({ ...capture, stage }, 'failed', raw, error)));
      throw error;
    }
  }

  /** JSON, then normalizeBrief (clamp, do not reject), then the strict schema. */
  private parseBrief(text: string, capture: Capture): ShooterBrief {
    capture.stage = 'parse';
    const fail = (message: string, paths: string[], details: SpecIssue[] = []): never => {
      throw new AIError('invalid_brief', message, 422, undefined, paths, details.length > 0 ? details : undefined);
    };
    if (Buffer.byteLength(text, 'utf8') > BRIEF_MAX_BYTES) fail(INVALID_BRIEF_MESSAGE, []);
    // A single fenced JSON block can be unwrapped safely; nothing is evaluated.
    const clean = text.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i, '$1');
    let data: unknown;
    try { data = JSON.parse(clean); } catch { return fail(NOT_JSON_MESSAGE, []); }
    capture.parsed = structuredClone(data);
    capture.stage = 'normalize';
    const normalized = normalizeBrief(data);
    capture.normalized = structuredClone(normalized);
    capture.stage = 'schema';
    const result = ShooterBriefSchema.safeParse(normalized);
    if (!result.success) {
      // Paths only, never Zod's text: a path is a field name of OUR schema.
      const details: SpecIssue[] = result.error.issues.map((issue) => ({ path: issue.path.map(String).join('.'), code: issue.code, message: 'Giá trị không hợp lệ.' }));
      capture.issues = details;
      return fail(`${INVALID_BRIEF_MESSAGE} Lý do: ${briefReason(details[0]?.path)}`, details.map((issue) => issue.path), details);
    }
    capture.validationSuccess = true;
    return result.data;
  }

  private finish(capture: Capture, outcome: 'completed' | 'failed', raw: string | undefined, error?: unknown): DiagnosticsFinish {
    const stage = capture.stage;
    const record: DiagnosticsFinish = {
      stage: stage === 'ok' ? 'response' : stage,
      outcome,
      parsed: capture.parsed ?? null,
      normalized: capture.normalized ?? null,
      validation: stage === 'provider' || stage === 'parse' || stage === 'normalize'
        ? { status: 'not_reached' }
        : { status: 'checked', schema: 'ShooterBriefSchema', success: capture.validationSuccess, issues: capture.issues },
      issues: outcome === 'completed' ? [] : capture.issues,
    };
    if (raw !== undefined) record.raw = raw;
    if (capture.report !== undefined) record.report = capture.report;
    if (error instanceof AIError) { record.errorCode = error.code; record.errorMessage = error.message; }
    else if (error instanceof Error) record.errorMessage = error.message;
    return record;
  }

  private async note(task: () => Promise<void>): Promise<void> {
    try { await task(); } catch { /* Diagnostics must not change the result. */ }
  }

  private async begin(input: DiagnosticsRequest): Promise<RunDiagnostics> {
    try { return await this.openDiagnostics(input); }
    catch { return { async note() {}, async raw() {}, async finish() {} }; }
  }
}
