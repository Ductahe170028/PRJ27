import { Worker } from 'node:worker_threads';
import type { ValidationResult } from './code-validator.js';

export class IsolatedCodeValidator {
  validate(source: string, signal: AbortSignal): Promise<ValidationResult> {
    return new Promise((resolve) => {
      if (signal.aborted) { resolve({ errors: ['Validation đã bị hủy.'] }); return; }
      const worker = new Worker(new URL('./validator-worker.mjs', import.meta.url), {
        workerData: source, execArgv: [],
        env: { SystemRoot: process.env.SystemRoot ?? 'C:\\Windows', TEMP: process.env.TEMP ?? '' },
        resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 32, stackSizeMb: 4 },
      });
      let done = false;
      const finish = (result: ValidationResult) => {
        if (done) return; done = true; clearTimeout(timer); signal.removeEventListener('abort', abort);
        void worker.terminate(); resolve(result);
      };
      const abort = () => finish({ errors: ['Validation đã bị hủy.'] });
      const timer = setTimeout(() => finish({ errors: ['TypeScript vượt giới hạn 5 giây biên dịch. Hãy giảm độ phức tạp.'] }), 5000);
      signal.addEventListener('abort', abort, { once: true });
      worker.once('message', (result: ValidationResult) => finish(result));
      worker.once('error', () => finish({ errors: ['Bộ kiểm tra TypeScript vượt giới hạn tài nguyên hoặc không khởi chạy được.'] }));
      worker.once('exit', () => finish({ errors: ['Bộ kiểm tra TypeScript đã dừng trước khi có kết quả.'] }));
    });
  }
}
