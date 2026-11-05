import type { GamePlan } from '@game-creator/contracts';
import { projectileRequirement } from './gameplay-requirements.js';

export type ControlAxis = 'horizontal' | 'vertical' | 'free' | 'none';
export interface ControlMapping {
  axis: ControlAxis;
  actions: Array<'space' | 'pointer'>;
  lift: boolean;
  autonomous: boolean;
  lossOnContact: boolean;
  pickup: boolean;
}

const normalize = (text: string) => text.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replaceAll('đ', 'd');
const STEERING = /\b(wasd|arrow keys?|arrows?|mui ten|phim trai|phim phai|phim len|phim xuong|bon huong|4 huong|a\/d|trai phai|len xuong)\b/;
const SPACE = /\b(space|phim cach)\b/;
const POINTER = /\b(click|chuot|pointer|mouse)\b/;
const LIFT = /\b(trong luc|gravity|nhay|jump|flap|bay len)\b/;
const AUTO = /\b(di chuyen lien tuc|tu di chuyen|moves continuously|keeps moving)\b/;
const LOSS = /\b(?:va cham|cham|collision|overlap)\b[\s\S]{0,80}\b(?:thua|lose|game over)\b|\b(?:thua|lose|game over)\b[\s\S]{0,80}\b(?:va cham|cham|collision|overlap)\b/;
const PICKUP = /\b(thu thap|collect|pick up)\b/;

function axisFromText(text: string): ControlAxis | undefined {
  if (!STEERING.test(text)) return undefined;
  if (/\b(bon huong|4 huong|wasd)\b/.test(text)) return 'free';
  const vertical = /\b(phim len|phim xuong|len xuong|up|down|vertical)\b/.test(text);
  const horizontal = /\b(phim trai|phim phai|trai phai|a\/d|left|right|horizontal)\b/.test(text);
  if (vertical && horizontal) return 'free';
  if (vertical) return 'vertical';
  if (horizontal) return 'horizontal';
  return 'free';
}

/** Controls come from the structured plan plus the requested input words.
 * The game title is ignored. `free` is not steering unless the text asks for it,
 * so a flap/click game is not exercised with arrow keys.
 */
export function controlMapping(plan: GamePlan, request = ''): ControlMapping {
  const text = normalize([request, plan.objective, ...plan.mechanics].join('\n'));
  const inferred = axisFromText(text);
  let axis: ControlAxis = plan.movement;
  if (axis === 'free') axis = inferred ?? 'none';
  // A plan can label gravity or a pipe's direction as vertical/horizontal.
  // Arrow keys are only tested when the request or the mechanics name them.
  if (axis !== 'none' && !STEERING.test(text)) axis = 'none';
  if (axis === 'none' && inferred) axis = inferred;
  const actions: Array<'space' | 'pointer'> = [];
  if (plan.action === 'space' || SPACE.test(text)) actions.push('space');
  if (plan.action === 'pointer' || POINTER.test(text)) actions.push('pointer');
  const lift = LIFT.test(text) && actions.length > 0 && !projectileRequirement(plan, request);
  return { axis, actions, lift, autonomous: AUTO.test(text), lossOnContact: LOSS.test(text), pickup: PICKUP.test(text) };
}
