import { readFile } from 'node:fs/promises';
import { chromium, type BrowserServer } from 'playwright';
import type { GamePlan } from '@game-creator/contracts';
import { AIError } from '../providers/errors.js';
import { runSmokeChecks } from './browser-smoke-checks.js';

export interface TestResult { errors: string[] }
export interface TesterReadiness { ready: boolean; message: string }
export interface GameTester {
  test(javascript: string, plan: GamePlan, signal: AbortSignal, request?: string): Promise<TestResult>;
  /** Cheap, cached. A tester that cannot currently isolate code reports not ready. */
  readiness?(): TesterReadiness;
  /** Called once after the server starts listening. */
  startup?(): Promise<void>;
  /** Called on shutdown; must stop every browser/container it owns. */
  dispose?(): Promise<void>;
}

export interface PlaywrightTesterOptions {
  /** Chromium's own sandbox. Only a container that already isolates the
   * process (non-root, no capabilities, no network, read-only root) may turn it
   * off; the host process must keep it on. */
  chromiumSandbox?: boolean;
}

/** A fresh Chromium process/profile, no credentials, no external network.
 * Only the browser executes generated code. Never Node vm/eval/import/require.
 * On a host this is a development tester; production code runs it only inside
 * the Docker sandbox (see sandbox/).
 */
export class PlaywrightGameTester implements GameTester {
  private readonly chromiumSandbox: boolean;
  constructor(options: PlaywrightTesterOptions = {}) { this.chromiumSandbox = options.chromiumSandbox ?? true; }

  async test(javascript: string, plan: GamePlan, signal: AbortSignal, request = ''): Promise<TestResult> {
    if (signal.aborted) throw signal.reason;
    let runtime: string;
    try { runtime = await readFile(new URL('../../../web/public/runtime/advanced.js', import.meta.url), 'utf8'); }
    catch { throw new AIError('tester_unavailable', 'Chưa có runtime Advanced. Chạy npm run build hoặc npm run dev tại root.', 503); }
    signal.throwIfAborted();
    // src/agent and dist/agent have the same depth relative to apps/web.
    let server: BrowserServer;
    try {
      const env: Record<string, string> = {};
      for (const name of ['SYSTEMROOT', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'PATH', 'HOME', 'USERPROFILE', 'LOCALAPPDATA']) {
        if (process.env[name]) env[name] = process.env[name]!;
      }
      server = await chromium.launchServer({ headless: true, chromiumSandbox: this.chromiumSandbox, timeout: 15_000, env,
        args: ['--js-flags=--max-old-space-size=128', '--disable-extensions'] });
    } catch {
      signal.throwIfAborted();
      throw new AIError('tester_unavailable', 'Không khởi chạy được Chromium sandbox. Chạy npx playwright install chromium rồi thử lại; không tắt sandbox.', 503);
    }
    const errors: string[] = [];
    const add = (message: string) => { if (errors.length < 10) errors.push(message.slice(0, 500)); };
    const kill = () => { server.process().kill(); };
    const timeout = setTimeout(() => { add('Browser test vượt thời hạn 25 giây.'); kill(); }, 25_000);
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
      await runSmokeChecks(page, javascript, runtime, plan, add, request);
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
