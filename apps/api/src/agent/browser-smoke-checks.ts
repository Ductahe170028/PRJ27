import { randomUUID } from 'node:crypto';
import type { Frame, Locator, Page } from 'playwright';
import { createCodeDocument, type GamePlan } from '@game-creator/contracts';
import { GAMEPLAY_PROBE } from './gameplay-probe.js';
import { controlMapping, type ControlMapping } from './control-mapping.js';
import { runGameplayChecks } from './browser-gameplay-checks.js';

interface Telemetry { frames: number; restarts: number; score: number; objects: number; ended: boolean; playerX: number | null; playerY: number | null }
interface Actor { id: number; x: number; y: number; vx: number; vy: number; hp: number; alive: boolean }
interface Sample { time: number; ended: boolean; playerId: number; births: number; entities: Actor[]; player: Actor | null }

const HOLD_MS = 200;
const RELEASE_MS = 260;
const FIRST_INPUT_SECONDS = 0.5;

/** Preview-ready, then the requested controls. Arrow keys are not a default.
 * A sample taken after win/lose is never used as proof that a control failed.
 */
export async function runSmokeChecks(page: Page, javascript: string, runtime: string, plan: GamePlan, add: (message: string) => void, request = ''): Promise<void> {
  const sessionId = randomUUID();
  const sandboxDocument = createCodeDocument(javascript, `data:text/javascript;base64,${Buffer.from(runtime).toString('base64')}`, sessionId);
  const boundary = sandboxDocument.lastIndexOf('return {create,update};');
  if (boundary < 0) throw new Error('Missing sandbox factory boundary');
  const observedDocument = sandboxDocument.slice(0, boundary) + GAMEPLAY_PROBE + sandboxDocument.slice(boundary + 'return {create,update};'.length);
  await page.setContent('<html><body style="margin:0"><iframe title="test" sandbox="allow-scripts" style="border:0;width:960px;height:540px"></iframe></body></html>');
  await page.evaluate(({ doc, id }) => {
    const frame = document.querySelector('iframe')!;
    const inbox: unknown[] = [];
    Object.assign(window, { agentTestInbox: inbox });
    window.addEventListener('message', (event: MessageEvent<{ channel?: string; sessionId?: string }>) => {
      if (event.source === frame.contentWindow && event.origin === 'null' && event.data?.channel === 'code-runtime' && event.data.sessionId === id && inbox.length < 100) inbox.push(event.data);
    });
    frame.srcdoc = doc;
  }, { doc: observedDocument, id: sessionId });
  const messages = () => page.evaluate(() => (window as unknown as { agentTestInbox: Array<{ type: string; message?: string; stats?: Telemetry }> }).agentTestInbox);
  await page.waitForFunction(() => (window as unknown as { agentTestInbox: Array<{ type: string }> }).agentTestInbox.some((message) => message.type === 'started' || message.type === 'error'));
  const frame = page.frames().find((candidate) => candidate.parentFrame() === page.mainFrame());
  const canvas = page.frameLocator('iframe').locator('canvas');
  if (frame && await canvas.count()) await exercise(page, frame, canvas, controlMapping(plan, request), add);
  else add('Preview chưa sẵn sàng: iframe chưa có canvas.');
  if (!(await messages()).some((message) => message.type === 'error')) await runGameplayChecks(page, plan, request, add);
  for (const message of await messages()) if (message.type === 'error') add(message.message ?? 'Runtime error');
}

async function exercise(page: Page, frame: Frame, canvas: Locator, mapping: ControlMapping, add: (message: string) => void): Promise<void> {
  const held = new Set<string>();
  const releaseKeys = async () => {
    for (const key of held) await page.keyboard.up(key).catch(() => undefined);
    held.clear();
    await page.mouse.up().catch(() => undefined);
  };
  try {
    try {
      await frame.waitForFunction(() => { try { return window.__agentGameplayProbe.read().entities.length > 0; } catch { return false; } }, undefined, { timeout: 2000 });
    } catch {
      add('Preview chưa chạy frame đầu tiên.');
      return;
    }
    if (await runtimeFailed(page)) return;
    await canvas.focus();
    const opened = await sample(frame);
    if (!opened.player) { add('Game chưa gọi setPlayer nên không quan sát được điều khiển.'); return; }
    if (opened.ended) {
      add('Game đã thắng hoặc thua trước input đầu tiên.');
      if (!await restart(page, frame, canvas, add)) return;
    }
    let timed = false;
    const noteTiming = (state: Sample) => {
      if (timed || !mapping.lift) return;
      timed = true;
      if (state.time > FIRST_INPUT_SECONDS) add(`Input điều khiển được gửi quá muộn (${state.time.toFixed(2)}s sau khi game bắt đầu).`);
    };
    for (let index = 0; index < mapping.actions.length; index += 1) {
      const action = mapping.actions[index]!;
      if ((await sample(frame)).ended && !await restart(page, frame, canvas, add)) return;
      noteTiming(await sample(frame));
      if (mapping.lift) await testLift(page, frame, canvas, action, add, held);
      else await testAction(page, frame, canvas, action, add, held);
      await releaseKeys();
      if (index < mapping.actions.length - 1 && !await restart(page, frame, canvas, add)) return;
    }
    if (mapping.axis !== 'none') {
      if ((await sample(frame)).ended && !await restart(page, frame, canvas, add)) return;
      noteTiming(await sample(frame));
      await testAxis(page, frame, mapping, add, held);
      await releaseKeys();
    }
    if (mapping.autonomous) {
      if ((await sample(frame)).ended && !await restart(page, frame, canvas, add)) return;
      await testAutonomous(page, frame, mapping, add, held);
      await releaseKeys();
    }
    if (mapping.pickup) {
      if ((await sample(frame)).ended && !await restart(page, frame, canvas, add)) return;
      await testPickup(page, frame, add);
    }
    if (mapping.lossOnContact) {
      if ((await sample(frame)).ended && !await restart(page, frame, canvas, add)) return;
      if (await testContact(page, frame, add)) await assertStopped(page, frame, add);
    }
    await restart(page, frame, canvas, add);
  } finally { await releaseKeys(); }
}

async function testLift(page: Page, frame: Frame, canvas: Locator, action: 'space' | 'pointer', add: (message: string) => void, held: Set<string>): Promise<void> {
  const label = action === 'space' ? 'Space' : 'Click';
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt === 1) {
      try {
        await frame.waitForFunction(() => {
          const state = window.__agentGameplayProbe.read();
          if (state.ended) return true;
          const player = state.entities.find((entity) => entity.id === state.playerId);
          return !!player && Math.abs(player.vy ?? 0) < 50;
        }, undefined, { timeout: 1200 });
      } catch { /* Still airborne: the second press is the last chance. */ }
    }
    const before = await sample(frame);
    if (before.ended || !before.player) {
      add(`${label} được nhấn khi đang chơi nhưng nhân vật không đi lên trước khi trò chơi kết thúc.`);
      return;
    }
    await press(page, canvas, action, held);
    await page.waitForTimeout(HOLD_MS);
    const rising = await sample(frame);
    await release(page, action, held);
    if (!rising.ended && rising.time <= before.time) add('Game ngừng cập nhật sau thao tác.');
    if (rose(before, rising)) {
      await page.waitForTimeout(RELEASE_MS);
      const dropped = await sample(frame);
      if (!dropped.ended && dropped.player && rising.player
        && !(dropped.player.vy > rising.player.vy + 30 || dropped.player.y > rising.player.y + 4)) {
        add(`Sau khi thả ${label}, nhân vật không chịu trọng lực.`);
      }
      return;
    }
    if (rising.ended) {
      add(`${label} được nhấn khi đang chơi nhưng nhân vật không đi lên trước khi trò chơi kết thúc.`);
      return;
    }
  }
  add(`${label} không làm nhân vật đi lên khi trò chơi còn đang chơi.`);
}

async function testAction(page: Page, frame: Frame, canvas: Locator, action: 'space' | 'pointer', add: (message: string) => void, held: Set<string>): Promise<void> {
  const label = action === 'space' ? 'Space' : 'Click';
  const before = await sample(frame);
  const beforeScore = await score(page);
  if (before.ended) {
    add(`Trò chơi đã kết thúc trước khi kiểm tra ${label}.`);
    return;
  }
  await press(page, canvas, action, held);
  await page.waitForTimeout(HOLD_MS + 100);
  const after = await sample(frame);
  await release(page, action, held);
  const moved = before.player && after.player && Math.hypot(after.player.x - before.player.x, after.player.y - before.player.y) >= 3;
  const changed = after.births > before.births || moved || await score(page) > beforeScore;
  if (!changed) add(after.ended
    ? `${label} được nhấn khi đang chơi nhưng không tạo vật thể, điểm hoặc chuyển động trước khi trò chơi kết thúc.`
    : `${label} không tạo vật thể, điểm hoặc chuyển động.`);
}

async function testAxis(page: Page, frame: Frame, mapping: ControlMapping, add: (message: string) => void, held: Set<string>): Promise<void> {
  const keys = mapping.axis === 'vertical' ? ['ArrowDown'] : mapping.axis === 'horizontal' ? ['ArrowRight'] : ['ArrowRight', 'ArrowDown'];
  for (const key of keys) {
    const before = await sample(frame);
    if (before.ended || !before.player) {
      add('Trò chơi đã kết thúc trước khi phím di chuyển đổi vị trí.');
      return;
    }
    held.add(key);
    await page.keyboard.down(key);
    await page.waitForTimeout(HOLD_MS + 80);
    const after = await sample(frame);
    held.delete(key);
    await page.keyboard.up(key);
    const delta = key === 'ArrowDown' ? (after.player?.y ?? 0) - before.player.y : (after.player?.x ?? 0) - before.player.x;
    if (delta < 3) add(after.ended ? 'Trò chơi đã kết thúc trước khi phím di chuyển đổi vị trí.' : 'Phím di chuyển không đổi vị trí nhân vật.');
    if (after.ended) return;
  }
}

async function testAutonomous(page: Page, frame: Frame, mapping: ControlMapping, add: (message: string) => void, held: Set<string>): Promise<void> {
  let previous = await sample(frame);
  const deadline = Date.now() + 1200;
  let saw = false;
  while (Date.now() < deadline) {
    const now = await sample(frame);
    if (!now.ended && displaced(previous, now)) { saw = true; break; }
    if (now.ended) break;
    if (mapping.lift && mapping.actions.includes('space') && now.player && now.player.y > 430) {
      held.add('Space');
      await page.keyboard.down('Space');
      await page.waitForTimeout(70);
      held.delete('Space');
      await page.keyboard.up('Space');
    }
    previous = now;
    await page.waitForTimeout(80);
  }
  if (!saw) add((await sample(frame)).ended
    ? 'Trò chơi kết thúc trước khi quan sát được vật thể di chuyển liên tục.'
    : 'Vật thể được mô tả là di chuyển liên tục không đổi vị trí.');
}

async function testPickup(page: Page, frame: Frame, add: (message: string) => void): Promise<void> {
  const start = await sample(frame);
  let picked = false;
  for (const other of start.entities.filter((entity) => entity.id !== start.playerId && entity.alive)) {
    if ((await sample(frame)).ended) break;
    const beforeScore = await score(page);
    const beforeIds = new Set((await sample(frame)).entities.map((entity) => entity.id));
    await position(frame, [{ id: start.playerId, x: other.x, y: other.y }]);
    await page.waitForTimeout(100);
    const after = await sample(frame);
    await position(frame, []);
    if (after.ended) break;
    if (await score(page) > beforeScore || [...beforeIds].some((id) => id !== start.playerId && !after.entities.some((entity) => entity.id === id))) {
      picked = true;
      break;
    }
  }
  if (!picked) add('Thu thập vật phẩm không tăng điểm hoặc không xóa vật phẩm.');
}

async function testContact(page: Page, frame: Frame, add: (message: string) => void): Promise<boolean> {
  const start = await sample(frame);
  for (const other of start.entities.filter((entity) => entity.id !== start.playerId && entity.alive)) {
    if ((await sample(frame)).ended) break;
    await position(frame, [{ id: start.playerId, x: other.x, y: other.y }]);
    await page.waitForTimeout(100);
    const after = await sample(frame);
    await position(frame, []);
    if (after.ended) return true;
  }
  add('Va chạm được yêu cầu không làm trò chơi thua.');
  return false;
}

async function assertStopped(page: Page, frame: Frame, add: (message: string) => void): Promise<void> {
  await position(frame, []);
  const frozen = await sample(frame);
  if (!frozen.ended) return;
  await page.waitForTimeout(180);
  const later = await sample(frame);
  if (later.time > frozen.time + 0.04) add('Sau khi thắng hoặc thua, gameplay vẫn được cập nhật.');
}

async function restart(page: Page, frame: Frame, canvas: Locator, add: (message: string) => void): Promise<boolean> {
  const previous = await page.evaluate(() => (window as unknown as { agentTestInbox: Array<{ stats?: Telemetry }> }).agentTestInbox.filter((message) => message.stats).at(-1)?.stats?.restarts ?? 0);
  await canvas.focus();
  await page.keyboard.press('r');
  try {
    await page.waitForFunction((before) => (window as unknown as { agentTestInbox: Array<{ stats?: Telemetry }> }).agentTestInbox
      .some((message) => message.stats !== undefined && message.stats.restarts > before && message.stats.score === 0 && message.stats.ended === false), previous, { timeout: 1500 });
    await frame.waitForFunction(() => {
      const state = window.__agentGameplayProbe.read();
      return state.ended !== true && state.entities.some((entity) => entity.id === state.playerId);
    }, undefined, { timeout: 1500 });
    return true;
  } catch {
    add('Restart không đưa game về trạng thái ban đầu.');
    return false;
  }
}

async function press(page: Page, canvas: Locator, action: 'space' | 'pointer', held: Set<string>): Promise<void> {
  if (action === 'space') { held.add('Space'); await page.keyboard.down('Space'); return; }
  const box = await canvas.boundingBox();
  if (!box) return;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
}

async function release(page: Page, action: 'space' | 'pointer', held: Set<string>): Promise<void> {
  if (action === 'space') { held.delete('Space'); await page.keyboard.up('Space'); return; }
  await page.mouse.up();
}

function rose(before: Sample, after: Sample): boolean {
  return !!before.player && !!after.player && (before.player.y - after.player.y >= 8 || after.player.vy < -40);
}

function displaced(before: Sample, after: Sample): boolean {
  return after.entities.some((entity) => {
    if (entity.id === after.playerId) return false;
    const previous = before.entities.find((item) => item.id === entity.id);
    return previous !== undefined && Math.hypot(entity.x - previous.x, entity.y - previous.y) > 3;
  });
}

const runtimeFailed = (page: Page) => page.evaluate(() => (window as unknown as { agentTestInbox: Array<{ type: string }> }).agentTestInbox.some((message) => message.type === 'error'));

async function sample(frame: Frame): Promise<Sample> {
  return frame.evaluate(() => {
    const state = window.__agentGameplayProbe.read();
    const entities = state.entities.map((entity) => ({ id: entity.id, x: entity.x, y: entity.y, vx: entity.vx ?? 0, vy: entity.vy ?? 0, hp: entity.hp, alive: entity.alive }));
    return { time: state.time, ended: state.ended === true, playerId: state.playerId, births: state.births.length, entities, player: entities.find((entity) => entity.id === state.playerId) ?? null };
  });
}

async function score(page: Page): Promise<number> {
  const text = await page.frameLocator('iframe').locator('#code-hud').textContent() ?? '';
  return Number(/Điểm\s+(-?\d+)/.exec(text)?.[1] ?? 0);
}

const position = (frame: Frame, values: Array<{ id: number; x: number; y: number }>) => frame.evaluate((values) => window.__agentGameplayProbe.position(values), values);
