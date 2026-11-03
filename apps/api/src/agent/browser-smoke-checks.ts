import { randomUUID } from 'node:crypto';
import type { Page } from 'playwright';
import { createCodeDocument, type GamePlan } from '@game-creator/contracts';
import { GAMEPLAY_PROBE } from './gameplay-probe.js';
import { runGameplayChecks } from './browser-gameplay-checks.js';

interface Telemetry { frames: number; restarts: number; score: number; objects: number; ended: boolean; playerX: number | null; playerY: number | null }

/** Exercise the existing input/restart checks inside the isolated browser. */
export async function runSmokeChecks(page: Page, javascript: string, runtime: string, plan: GamePlan, add: (message: string) => void, request = ''): Promise<void> {
  const sessionId = randomUUID();
  const sandboxDocument = createCodeDocument(javascript, `data:text/javascript;base64,${Buffer.from(runtime).toString('base64')}`, sessionId);
  // Replace the trusted factory return at the end, never text inside model source.
  const boundary = sandboxDocument.lastIndexOf('return {create,update};');
  if (boundary < 0) throw new Error('Missing sandbox factory boundary');
  const observedDocument = sandboxDocument.slice(0, boundary) + GAMEPLAY_PROBE + sandboxDocument.slice(boundary + 'return {create,update};'.length);
  // The outside page is a blank harness, not the app and has no secrets.
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
  const latest = async () => (await messages()).filter((m) => m.stats).at(-1)?.stats;
  await page.waitForFunction(() => (window as unknown as { agentTestInbox: Array<{ type: string }> }).agentTestInbox.some((m) => m.type === 'started' || m.type === 'error'));
  await page.waitForTimeout(600);
  const before = await latest();
  if (!before || before.frames < 1 || before.objects < 1) add('Game không tạo vật thể hoặc không chạy update().');
  const canvas = page.frameLocator('iframe').locator('canvas');
  if (await canvas.count()) {
    await canvas.click({ position: { x: 450, y: 400 } });
    if (plan.movement !== 'none') {
      const key = plan.movement === 'vertical' ? 'ArrowDown' : 'ArrowRight';
      await page.keyboard.down(key); await page.waitForTimeout(700); await page.keyboard.up(key);
      const after = await latest();
      if (before?.playerX === null || before?.playerY === null || !after
        || (Math.abs((after.playerX ?? 0) - (before?.playerX ?? 0)) < 3 && Math.abs((after.playerY ?? 0) - (before?.playerY ?? 0)) < 3)) add('Player không di chuyển khi nhận phím; kiểm tra setPlayer và input.');
    }
    if (plan.action !== 'none') {
      const imageBefore = await canvas.screenshot();
      const hudBefore = await page.frameLocator('iframe').locator('#code-hud').textContent();
      if (plan.action === 'space') { await page.keyboard.down('Space'); await page.waitForTimeout(600); await page.keyboard.up('Space'); }
      if (plan.action === 'pointer') { await canvas.click({ position: { x: 500, y: 200 }, delay: 100 }); await page.waitForTimeout(600); }
      const imageAfter = await canvas.screenshot();
      if (imageBefore.equals(imageAfter) && hudBefore === await page.frameLocator('iframe').locator('#code-hud').textContent()) {
        add('Space/click không tạo thay đổi hiển thị hoặc điểm trong smoke test.');
      }
    }
    const running = await latest();
    if (!running || running.frames <= (before?.frames ?? 0)) add('Game ngừng cập nhật sau thao tác.');
    await page.keyboard.press('r'); await page.waitForTimeout(600);
    const restarted = await latest();
    if (!restarted || restarted.restarts < 1 || restarted.score !== 0) add('Restart không đưa game về trạng thái ban đầu.');
  }
  if (!(await messages()).some((message) => message.type === 'error')) await runGameplayChecks(page, plan, request, add);
  for (const message of await messages()) if (message.type === 'error') add(message.message ?? 'Runtime error');
}
