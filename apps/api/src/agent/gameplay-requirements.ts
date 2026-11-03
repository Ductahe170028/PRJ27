import type { GamePlan } from '@game-creator/contracts';

export interface ProjectileRequirement { direction?: { x: number; y: number }; pointer: boolean }
const normalize = (text: string) => text.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replaceAll('đ', 'd');

/** Internal acceptance checks, derived from the request/plan, not a game title or entity kind. */
export function projectileRequirement(plan: GamePlan, request = ''): ProjectileRequirement | undefined {
  const text = normalize([request, ...plan.mechanics, plan.objective].join('\n'));
  if (!/\b(shoot(?:ing)?|fir(?:e|ing)|projectiles?|bullets?|ban (?:dan|ten|ha|trung|sung|len|xuong|sang)|dan (?:bay|va cham))\b/.test(text)) return;
  // An explicit direction in the original request takes precedence over the plan.
  const direction = (value: string) => {
    if (/\b(up(?:ward(?:s)?)?|len(?: tren)?)\b/.test(value)) return { x: 0, y: -1 };
    if (/\b(down(?:ward(?:s)?)?|xuong(?: duoi)?)\b/.test(value)) return { x: 0, y: 1 };
    if (/\b(rightward(?:s)?|sang phai|to the right)\b/.test(value)) return { x: 1, y: 0 };
    if (/\b(leftward(?:s)?|sang trai|to the left)\b/.test(value)) return { x: -1, y: 0 };
    return undefined;
  };
  // Only inspect shooting clauses: movement/enemy directions must not become the firing direction.
  const clauses = (value: string) => normalize(value).split(/[.;,\n]/).map((line) => {
    const start = /\b(shoot(?:ing)?|fir(?:e|ing)|projectiles?|bullets?|ban|dan)\b/.exec(line)?.index;
    return start === undefined ? '' : line.slice(start);
  }).join('\n');
  const aim = direction(clauses(request)) ?? direction(clauses(plan.mechanics.join('. ')));
  return { ...(aim ? { direction: aim } : {}), pointer: plan.action === 'pointer' };
}
