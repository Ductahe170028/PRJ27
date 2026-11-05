import type { GamePlan } from '@game-creator/contracts';
import type { AIRequest } from '../src/providers/ai-provider.js';

export const shooterPlan: GamePlan = { title: 'Sky Defender', summary: 'Lái máy bay, bắn địch và đánh boss.', mechanics: ['Máy bay di chuyển ngang', 'Đạn va chạm kẻ địch', 'Boss xuất hiện sau 6 giây'], movement: 'horizontal', action: 'space', objective: 'Bắn hạ boss để thắng; tránh va chạm.' };
// Fixtures belong ONLY to tests. Production has no fallback/template source.
export const shooterSource = `
function create(api: GameAPI): void {
  const p = api.spawn("player", 480, 470, 36, 28, 12972663);
  api.setPlayer(p); api.state.player = p.id; api.state.shot = 0; api.state.wave = 0; api.state.boss = 0;
  api.status("Space: ban dan. Ha boss de thang.");
}
function update(api: GameAPI, dt: number): void {
  const p = api.get(api.state.player!); if (!p) { return; }
  if (api.input.left) { p.x -= 280 * dt; } if (api.input.right) { p.x += 280 * dt; }
  p.x = Math.max(20, Math.min(940, p.x));
  api.state.shot = api.state.shot! - dt; api.state.wave = api.state.wave! - dt;
  if (api.input.action && api.state.shot! <= 0) { api.spawn("bullet", p.x, p.y - 25, 7, 18, 16774000); api.state.shot = 0.2; }
  if (api.state.wave! <= 0 && api.time < 6) { api.spawn("enemy", 250 + Math.random() * 460, 75, 30, 30, 15825600); api.state.wave = 1.2; }
  if (api.time >= 6 && api.state.boss! === 0) { const boss = api.spawn("boss", 480, 110, 130, 60, 16735080); boss.hp = 6; api.state.boss = 1; }
  const items = api.entities;
  for (const e of items) {
    if (!e.alive) { continue; }
    if (e.kind === "bullet") { e.y -= 480 * dt; if (e.y < 55) { api.remove(e); } }
    if (e.kind === "enemy") { e.y += 65 * dt; if (e.y > 560) { api.remove(e); } if (api.overlaps(e, p)) { api.lose(); } }
    if (e.kind === "boss") { e.x = 480 + Math.sin(api.time) * 90; }
    if (e.kind === "bullet" && e.alive) {
      for (const enemy of items) {
        if (enemy.alive && (enemy.kind === "enemy" || enemy.kind === "boss") && api.overlaps(e, enemy)) {
          api.remove(e); enemy.hp -= 1; api.addScore(10);
          if (enemy.hp <= 0) { api.remove(enemy); if (enemy.kind === "boss") { api.win(); } } break;
        }
      }
    }
  }
}
`;
export const paddlePlan: GamePlan = { title: 'Neon Paddle', summary: 'Đỡ bóng và phá gạch.', mechanics: ['Thanh đỡ di chuyển', 'Bóng bật vào tường và gạch', 'Phá hết gạch để thắng'], movement: 'horizontal', action: 'none', objective: 'Phá 6 viên gạch, không để bóng rơi.' };
export const paddleSource = `
function create(api: GameAPI): void {
  const p = api.spawn("paddle", 480, 490, 120, 18, 12972663); api.setPlayer(p); api.state.player = p.id;
  const ball = api.spawn("ball", 480, 300, 16, 16, 16774000); ball.vx = 120; ball.vy = -160; api.state.ball = ball.id;
  api.state.bricks = 6;
  for (let i = 0; i < 6; i++) { api.spawn("brick", 230 + i * 100, 130, 80, 25, 7659020); }
  api.status("Do bong va pha het gach.");
}
function update(api: GameAPI, dt: number): void {
  const p = api.get(api.state.player!); const ball = api.get(api.state.ball!); if (!p || !ball) { return; }
  if (api.input.left) { p.x -= 300 * dt; } if (api.input.right) { p.x += 300 * dt; }
  p.x = Math.max(60, Math.min(900, p.x)); ball.x += ball.vx * dt; ball.y += ball.vy * dt;
  if (ball.x < 10 || ball.x > 950) { ball.vx = -ball.vx; } if (ball.y < 70) { ball.vy = Math.abs(ball.vy); }
  if (ball.vy > 0 && api.overlaps(ball, p)) { ball.vy = -Math.abs(ball.vy); }
  for (const e of api.entities) { if (e.kind === "brick" && api.overlaps(ball, e)) { api.remove(e); ball.vy = -ball.vy; api.addScore(10); api.state.bricks = api.state.bricks! - 1; break; } }
  if (api.state.bricks === 0) { api.win(); } if (ball.y > 550) { api.lose(); }
}
`;
export const runtimeErrorSource = 'function create(api: GameAPI): void { api.get(-1)!.x = 5; } function update(api: GameAPI, dt: number): void {}';
export const platformerSource = `
function create(api: GameAPI): void {
  const p = api.spawn("player", 80, 180, 28, 28, 12972663);
  api.setPlayer(p); api.state.player = p.id; api.state.grounded = 0;
  api.spawn("ground", 160, 430, 200, 24, 3289920);
  api.spawn("coin", 220, 390, 16, 16, 16766720);
}
function update(api: GameAPI, dt: number): void {
  const p = api.get(api.state.player ?? 0); if (!p) { return; }
  if (api.input.left) { p.x -= 180 * dt; } if (api.input.right) { p.x += 180 * dt; }
  p.vy += 1100 * dt;
  if (api.input.action && (api.state.grounded ?? 0) === 1) { p.vy = -340; api.state.grounded = 0; }
  p.y += p.vy * dt; api.state.grounded = 0;
  for (const e of api.entities) {
    if (e.kind === "ground" && p.vy >= 0 && api.overlaps(p, e)) { p.y = e.y - (e.height + p.height) / 2; p.vy = 0; api.state.grounded = 1; }
    if (e.kind === "coin" && api.overlaps(p, e)) { api.remove(e); api.addScore(1); }
  }
  if (p.y > 530) { api.lose(); }
}
`;
export const topDownSource = `
function create(api: GameAPI): void {
  const p = api.spawn("player", 120, 200, 28, 28, 5298687);
  api.setPlayer(p); api.state.player = p.id;
  api.spawn("item", 280, 200, 16, 16, 16766720);
  api.spawn("enemy", 520, 200, 28, 28, 16711724);
}
function update(api: GameAPI, dt: number): void {
  const p = api.get(api.state.player ?? 0); if (!p) { return; }
  if (api.input.left) { p.x -= 200 * dt; } if (api.input.right) { p.x += 200 * dt; }
  if (api.input.up) { p.y -= 200 * dt; } if (api.input.down) { p.y += 200 * dt; }
  for (const e of api.entities) {
    if (e.kind === "item" && api.overlaps(p, e)) { api.remove(e); api.addScore(1); }
    if (e.kind === "enemy" && api.overlaps(p, e)) { api.lose(); }
  }
}
`;
export const flapSource = `
function create(api: GameAPI): void {
  const bird = api.spawn("bird", 160, 220, 28, 28, 16766720);
  api.setPlayer(bird); api.state.player = bird.id; api.state.scored = 0; api.state.score = 0;
  api.spawn("pipe", 520, 80, 70, 160, 52940);
  api.spawn("pipe", 520, 440, 70, 200, 52940);
}
function update(api: GameAPI, dt: number): void {
  const bird = api.get(api.state.player ?? 0); if (!bird) { return; }
  bird.vy += 900 * dt;
  if (api.input.action || api.input.pointerDown) { bird.vy = -280; }
  bird.y += bird.vy * dt;
  for (const e of api.entities) {
    if (e.kind !== "pipe") { continue; }
    e.x -= 140 * dt;
    if (e.x < bird.x && (api.state.scored ?? 0) === 0) { api.state.scored = 1; api.state.score = (api.state.score ?? 0) + 1; api.addScore(1); }
    if (api.overlaps(bird, e)) { api.lose(); }
  }
  if (bird.y < 70 || bird.y > 520) { api.lose(); }
  if ((api.state.score ?? 0) >= 10) { api.win(); }
}
`;
export async function agentFixture(request: AIRequest): Promise<string> {
  const properties = request.jsonSchema.properties as Record<string, unknown> | undefined;
  if (properties?.mechanics) return JSON.stringify(request.prompt.includes('paddle') ? paddlePlan : shooterPlan);
  if (request.prompt.includes('[agent-quota]')) throw Object.assign(new Error('quota'), { status: 429 });
  if (request.prompt.includes('[agent-fail]')) return JSON.stringify({ source: runtimeErrorSource });
  if (request.prompt.includes('[agent-budget]') && !request.prompt.toLowerCase().includes('diagnostics')) return JSON.stringify({ source: 'function create(api: GameAPI): void { while (true) {} } function update(api: GameAPI, dt: number): void {}' });
  if (request.prompt.includes('[agent-repair]') && !request.prompt.toLowerCase().includes('diagnostics')) return JSON.stringify({ source: runtimeErrorSource });
  if (request.prompt.includes('[agent-stationary]') && !request.prompt.toLowerCase().includes('diagnostics')) return JSON.stringify({ source: shooterSource.replace('e.y -= 480 * dt;', 'e.vy = -480;') });
  return JSON.stringify({ source: request.prompt.includes('paddle') ? paddleSource : shooterSource });
}
