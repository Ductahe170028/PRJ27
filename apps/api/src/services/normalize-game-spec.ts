// Normalize numeric fields whose semantics are inactive, plus the bounded patrol
// radius and block dimensions. Positions and physics are never adjusted.
// Do not drop fields, coerce strings, invent missing objects or run code.
// The complete strict GameSpec schema remains authoritative after this step.
export function normalizeGeneratedSpec(value: unknown): unknown {
  const record = (item: unknown): Record<string, unknown> | undefined =>
    item !== null && typeof item === 'object' && !Array.isArray(item) ? item as Record<string, unknown> : undefined;
  const game = record(value);
  if (!game) return value;
  const clampInteger = (target: Record<string, unknown> | undefined, key: string, min: number, max: number) => {
    const current = target?.[key];
    if (target && typeof current === 'number' && Number.isSafeInteger(current)) target[key] = Math.min(max, Math.max(min, current));
  };
  if (game.genre === 'top-down') {
    clampInteger(record(game.player), 'jumpSpeed', 350, 600);
    clampInteger(record(game.difficulty), 'gravity', 800, 1600);
  }
  const win = record(game.win);
  if (win?.type === 'collect_all' || win?.type === 'reach_score') clampInteger(win, 'surviveSeconds', 10, 120);
  if (win?.type === 'collect_all' || win?.type === 'survive') clampInteger(win, 'scoreTarget', 1, 2400);
  if (Array.isArray(game.enemies)) {
    for (const enemy of game.enemies) clampInteger(record(enemy), 'range', 0, 160);
  }
  for (const blocks of [game.platforms, game.obstacles]) {
    if (!Array.isArray(blocks)) continue;
    for (const block of blocks) {
      clampInteger(record(block), 'width', 20, 920);
      clampInteger(record(block), 'height', 16, 100);
    }
  }
  return value;
}

