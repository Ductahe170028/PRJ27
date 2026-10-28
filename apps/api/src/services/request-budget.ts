import { AIError } from '../providers/errors.js';

export interface BudgetOptions {
  requestsPerMinute?: number;
  requestsPerDay?: number;
  maxConcurrent?: number;
  now?: () => number;
}

export class RequestBudget {
  private readonly clients = new Map<string, { start: number; count: number }>();
  private active = 0;
  private dailyCount = 0;
  private day = -1;
  constructor(private readonly options: BudgetOptions = {}) {}

  acquire(client: string): () => void {
    const now = (this.options.now ?? Date.now)();
    const day = Math.floor(now / 86_400_000);
    if (day !== this.day) { this.day = day; this.dailyCount = 0; }
    for (const [id, window] of this.clients) if (now - window.start >= 60_000) this.clients.delete(id);
    const window = this.clients.get(client) ?? { start: now, count: 0 };
    if (window.count >= (this.options.requestsPerMinute ?? 5) || (!this.clients.has(client) && this.clients.size >= 1_000)) {
      throw new AIError('rate_limit', 'Đã đạt giới hạn yêu cầu mỗi phút. Hãy chờ rồi thử lại.', 429, Math.max(1, Math.ceil((60_000 - now + window.start) / 1000)));
    }
    if (this.dailyCount >= (this.options.requestsPerDay ?? 100)) {
      throw new AIError('rate_limit', 'Backend đã đạt giới hạn yêu cầu trong ngày.', 429, Math.ceil(((day + 1) * 86_400_000 - now) / 1000));
    }
    if (this.active >= (this.options.maxConcurrent ?? 2)) {
      throw new AIError('rate_limit', 'Backend đang xử lý tối đa số yêu cầu đồng thời. Hãy thử lại sau.', 429, 5);
    }
    window.count += 1;
    this.clients.set(client, window);
    this.dailyCount += 1;
    this.active += 1;
    let released = false;
    return () => { if (!released) { this.active -= 1; released = true; } };
  }
}
