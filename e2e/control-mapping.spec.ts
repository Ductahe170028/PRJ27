import { test, expect } from '@playwright/test';
import type { GamePlan } from '@game-creator/contracts';
import { CodeValidator } from '../apps/api/src/agent/code-validator.js';
import { PlaywrightGameTester } from '../apps/api/src/agent/game-tester.js';
import { flapSource, paddlePlan, paddleSource, platformerSource, shooterPlan, shooterSource, topDownSource } from '../apps/api/test/agent-fixtures.js';

// Fixture tests. They run the real preview runtime in Chromium. They are not live AI generations.
const plan = (movement: GamePlan['movement'], action: GamePlan['action'], mechanics: string[], objective: string): GamePlan => ({
  title: 'Fixture', summary: 'Fixture kiểm thử điều khiển.', mechanics, movement, action, objective,
});

const loseImmediately = `function create(api: GameAPI): void {
  const bird = api.spawn("bird", 160, 220, 28, 28, 16766720);
  api.setPlayer(bird); api.state.player = bird.id; api.lose();
}
function update(api: GameAPI, dt: number): void {
  const bird = api.get(api.state.player ?? 0); if (!bird) { return; }
  if (api.input.action || api.input.pointerDown) { bird.y -= 40; }
}`;

async function play(source: string, game: GamePlan, request: string) {
  const compiled = new CodeValidator().validate(source);
  expect(compiled.errors).toEqual([]);
  return new PlaywrightGameTester().test(compiled.javascript!, game, new AbortController().signal, request);
}

test('platformer fixture moves, jumps, falls and collects from the requested controls', async () => {
  const result = await play(platformerSource, plan('horizontal', 'space', ['Di chuyển trái phải', 'Nhảy và trọng lực'], 'Thu thập xu.'),
    'Di chuyển trái phải bằng phím mũi tên. Space để nhảy. Có trọng lực. Thu thập xu.');
  expect(result.errors).toEqual([]);
});

test('top-down fixture moves on the requested arrows, collects and loses on contact', async () => {
  const result = await play(topDownSource, plan('free', 'none', ['Đi bốn hướng', 'Chạm kẻ địch thì thua'], 'Thu thập vật phẩm.'),
    'Di chuyển bốn hướng bằng phím mũi tên. Thu thập vật phẩm. Chạm kẻ địch thì thua.');
  expect(result.errors).toEqual([]);
});

test('shooter fixture moves and fires without treating Space as a jump', async () => {
  const result = await play(shooterSource, shooterPlan, 'Di chuyển trái phải bằng phím mũi tên. Space bắn đạn lên trên.');
  expect(result.errors).toEqual([]);
});

test('breakout fixture keeps the ball moving and steers the paddle', async () => {
  const result = await play(paddleSource, paddlePlan, 'Bóng tự di chuyển và nảy. Thanh đỡ di chuyển trái phải bằng phím mũi tên.');
  expect(result.errors).toEqual([]);
});

test('flappy with a negated arrow sentence still flaps, falls, scrolls, collides and restarts', async () => {
  const request = 'Tạo game Flappy Bird 2D. Nhấn Space hoặc click chuột trái để chim bay lên, có trọng lực khi thả phím. Các cặp ống di chuyển liên tục từ phải sang trái. Không yêu cầu phím R hoặc phím mũi tên. Vượt qua mỗi cặp ống được 1 điểm. Va chạm với ống hoặc biên màn hình thì thua. Đạt 10 điểm thì thắng.';
  const result = await play(flapSource, plan('horizontal', 'space', ['Space or left click makes bird flap upward', 'Pipes move left continuously', 'Gravity pulls bird down'], 'Survive by passing pipe pairs.'), request);
  expect(result.errors).toEqual([]);
});

test('flappy fixture flaps on Space and click, falls, scrolls, collides and restarts', async () => {
  const result = await play(flapSource, plan('free', 'space', ['Space hoặc click để bay lên', 'Ống di chuyển liên tục', 'Va chạm thì thua'], 'Đạt 10 điểm.'),
    'Tạo game Flappy Bird 2D. Nhấn Space hoặc click để chim bay lên, có trọng lực khi thả phím. Các cặp ống di chuyển liên tục từ phải sang trái. Vượt qua mỗi cặp ống được 1 điểm. Va chạm với ống hoặc biên màn hình thì thua. Đạt 10 điểm thì thắng. Có nút Restart.');
  expect(result.errors).toEqual([]);
});

test('a game that is already over is not reported as a broken Space key, and the next fixture still runs', async () => {
  const ended = await play(loseImmediately, plan('free', 'space', ['Space để bay lên', 'Có trọng lực'], 'Va chạm thì thua.'),
    'Nhấn Space hoặc click để chim bay lên, có trọng lực. Va chạm thì thua.');
  expect(ended.errors.join('\n')).toContain('trước input đầu tiên');
  expect(ended.errors.join('\n')).not.toContain('không đi lên');
  expect(ended.errors.join('\n')).not.toContain('Phím di chuyển');
  expect(ended.errors.join('\n')).not.toContain('không tạo thay đổi hiển thị');
  const next = await play(flapSource, plan('free', 'space', ['Space hoặc click để bay lên', 'Ống di chuyển liên tục', 'Va chạm thì thua'], 'Đạt 10 điểm.'),
    'Nhấn Space hoặc click để chim bay lên, có trọng lực khi thả phím. Các cặp ống di chuyển liên tục từ phải sang trái. Va chạm với ống thì thua.');
  expect(next.errors).toEqual([]);
});
