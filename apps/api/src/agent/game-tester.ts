import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { chromium, type BrowserServer } from 'playwright';
import { createCodeDocument, type GamePlan } from '@game-creator/contracts';
import { AIError } from '../providers/errors.js';

export interface TestResult { errors: string[] }
export interface GameTester { test(javascript: string, plan: GamePlan, signal: AbortSignal): Promise<TestResult> }
interface Telemetry { frames: number; restarts: number; score: number; objects: number; ended: boolean; playerX: number | null; playerY: number | null }

/** A fresh Chromium process/profile, no credentials, no external network.
 * Only the browser executes generated code. Never Node vm/eval/import/require.
 */
export class PlaywrightGameTester implements GameTester {
  async test(javascript: string, plan: GamePlan, signal: AbortSignal): Promise<TestResult> {
    if (signal.aborted) throw signal.reason;
    let runtime: string;
    try { runtime = await readFile(new URL('../../../web/public/runtime/advanced.js', import.meta.url), 'utf8'); }
    catch { throw new AIError('tester_unavailable', 'Chưa có runtime Advanced. Chạy npm run build hoặc npm run dev tại root.', 503); }
    // src/agent and dist/agent have the same depth relative to apps/web.
    let server: BrowserServer;
    try {
      const env: Record<string, string> = {};
      for (const name of ['SYSTEMROOT', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'PATH', 'HOME', 'USERPROFILE', 'LOCALAPPDATA']) {
        if (process.env[name]) env[name] = process.env[name]!;
      }
      server = await chromium.launchServer({ headless: true, chromiumSandbox: true, timeout: 15_000, env,
        args: ['--js-flags=--max-old-space-size=128', '--disable-extensions'] });
    } catch { throw new AIError('tester_unavailable', 'Không khởi chạy được Chromium sandbox. Chạy npx playwright install chromium rồi thử lại; không tắt sandbox.', 503); }
    const errors: string[] = [];
    const add = (message: string) => { if (errors.length < 10) errors.push(message.slice(0, 500)); };
    const kill = () => { server.process().kill(); };
    const timeout = setTimeout(() => { add('Browser test vượt thời hạn 15 giây.'); kill(); }, 15_000);
    signal.addEventListener('abort', kill, { once: true });
    try {
      if (signal.aborted) throw signal.reason;
      const browser = await chromium.connect(server.wsEndpoint());
      const context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: false, permissions: [], viewport: { width: 960, height: 540 } });
      await context.route('**/*', (route) => { add('Game cố truy cập network bị cấm.'); return route.abort(); });
      const page = await context.newPage();
      page.setDefaultTimeout(5000);
      page.on('console', (message) => { if (message.type() === 'error') add(message.text()); });
      page.on('pageerror', (error) => add(error.message));
      const sessionId = randomUUID();
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
      }, { doc: createCodeDocument(javascript, `data:text/javascript;base64,${Buffer.from(runtime).toString('base64')}`, sessionId), id: sessionId });
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
      for (const message of await messages()) if (message.type === 'error') add(message.message ?? 'Runtime error');
      await context.close();
      await browser.close();
    } catch {
      if (signal.aborted) throw signal.reason;
      add('Game không hoàn thành smoke test trong thời hạn; kiểm tra create/update và lỗi runtime.');
    } finally {
      clearTimeout(timeout); signal.removeEventListener('abort', kill);
      // kill remains the fallback if a renderer hangs during graceful close.
      const fallback = setTimeout(kill, 1000);
      await server.close().catch(() => {});
      clearTimeout(fallback);
    }
    return { errors: [...new Set(errors)] };
  }
}
