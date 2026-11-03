import { z } from 'zod';
import { ProviderRequestSchema } from './ai.js';

import { CODE_MAX_BYTES, CODE_MAX_REPAIRS } from './code-limits.js';
export * from './code-limits.js';
export const AgentRequestSchema = ProviderRequestSchema.extend({ prompt: z.string().trim().min(1).max(2000) }).strict();
export const GamePlanSchema = z.object({
  title: z.string().min(1).max(80),
  summary: z.string().min(1).max(500),
  mechanics: z.array(z.string().min(1).max(160)).min(2).max(8),
  movement: z.enum(['horizontal', 'vertical', 'free', 'none']),
  action: z.enum(['space', 'pointer', 'none']),
  objective: z.string().min(1).max(200),
}).strict();
export const CodeSourceSchema = z.object({ source: z.string().min(1).max(CODE_MAX_BYTES) }).strict();
export const CodeProjectSchema = z.object({
  id: z.string().uuid(), mode: z.literal('advanced'), provider: z.string().max(40), modelId: z.string().max(120),
  plan: GamePlanSchema, javascript: z.string().min(1).max(65_536), repairs: z.number().int().min(0).max(CODE_MAX_REPAIRS),
}).strict();
export const AgentStageSchema = z.enum(['Planning', 'Coding', 'Validating', 'Testing', 'Repairing', 'Completed', 'Failed']);
export const AgentEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('status'), stage: AgentStageSchema, message: z.string().max(500), attempt: z.number().int().min(0).max(2) }).strict(),
  z.object({ type: z.literal('plan'), plan: GamePlanSchema }).strict(),
  z.object({ type: z.literal('log'), lines: z.array(z.string().max(500)).max(10) }).strict(),
  z.object({ type: z.literal('completed'), project: CodeProjectSchema }).strict(),
  z.object({ type: z.literal('failed'), error: z.object({ code: z.string(), message: z.string().max(1000), retryAfterSeconds: z.number().positive().optional() }).strict() }).strict(),
]);
export type AgentRequest = z.infer<typeof AgentRequestSchema>;
export type GamePlan = z.infer<typeof GamePlanSchema>;
export type CodeProject = z.infer<typeof CodeProjectSchema>;
export type AgentEvent = z.infer<typeof AgentEventSchema>;
export type AgentStage = z.infer<typeof AgentStageSchema>;

// The model receives this exact contract; the compiler uses it as its ONLY lib.
// No DOM, Node, module loader, Phaser internals, arbitrary timers or host objects.
export const GAME_CODE_API = `
interface Entity { readonly id: number; kind: string; x: number; y: number; width: number; height: number; color: number; vx: number; vy: number; hp: number; alive: boolean; }
interface GameAPI {
  readonly width: number; readonly height: number; readonly time: number;
  readonly input: { readonly left: boolean; readonly right: boolean; readonly up: boolean; readonly down: boolean; readonly action: boolean; readonly pointerDown: boolean; readonly pointerX: number; readonly pointerY: number; };
  readonly state: { [key: string]: number };
  readonly entities: Entity[];
  spawn(kind: string, x: number, y: number, width: number, height: number, color: number): Entity;
  remove(entity: Entity): void;
  get(id: number): Entity | undefined;
  setPlayer(entity: Entity): void;
  overlaps(a: Entity, b: Entity): boolean;
  addScore(points: number): void;
  status(text: string): void;
  win(): void; lose(): void;
}
// Required entrypoints: function create(api: GameAPI): void;
// function update(api: GameAPI, dt: number): void;
// dt is seconds, capped at 0.05. Engine draws entities; YOUR update moves them.
// World: 960x540, HUD at y<60. R restarts via the trusted host.
`;

const attribute = (value: string) => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
// Both the tester and preview execute the SAME compiled artifact and document.
// Only a nonce-bearing trusted runtime and the validated script can execute.
export function createCodeDocument(javascript: string, runtimeUrl: string, sessionId: string): string {
  if (!/^[a-f0-9-]{36}$/.test(sessionId)) throw new Error('Invalid sandbox session');
  const script = javascript.replace(/<\/script/gi, '<\\/script');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${sessionId}'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; worker-src 'none'; child-src 'none'; frame-src 'none'; media-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
<style>html,body,#game{margin:0;width:100%;height:100%;overflow:hidden;background:#0b1321;color:#e3eaf4;font:14px system-ui}canvas{display:block}#code-hud{position:absolute;top:10px;left:16px;right:90px;pointer-events:none}#code-restart{position:absolute;right:12px;top:8px;background:#24334b;color:white;border:1px solid #607187;border-radius:7px;padding:8px;cursor:pointer}#code-result{position:absolute;inset:40% 10%;text-align:center;font-size:25px;pointer-events:none}[hidden]{display:none!important}</style>
</head><body><div id="game"></div><div id="code-hud" role="status">Đang khởi tạo…</div><button id="code-restart">Chơi lại (R)</button><div id="code-result" role="status" hidden></div>
<script nonce="${sessionId}" id="code-runtime" data-session="${sessionId}" src="${attribute(runtimeUrl)}"></script>
<script nonce="${sessionId}">globalThis.__gameAgentBoot((__budget)=>{ "use strict"; ${script}\nreturn {create,update}; });</script></body></html>`;
}
