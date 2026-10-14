import { z } from 'zod';
import { AppError } from '../errors.js';

const envelope = z.object({
  data: z.unknown().optional(),
  errors: z.array(z.object({ message: z.string().optional(), extensions: z.object({ code: z.string().optional() }).passthrough().optional() }).passthrough()).optional(),
});
export class GraphqlClient {
  constructor(
    private options: { url: string; authHeader: string; authValue: string; timeoutMs: number },
    private fetcher: typeof fetch = fetch,
  ) {}

  async execute<T>(document: string, variables: Record<string, unknown>, schema: z.ZodType<T>, write = false): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      // One request only. Never retry a mutation, including on network errors.
      const response = await this.fetcher(this.options.url, {
        method: 'POST',
        redirect: 'error',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', [this.options.authHeader]: this.options.authValue },
        body: JSON.stringify({ query: document, variables }),
        signal: controller.signal,
      });
      if ([401, 403].includes(response.status)) throw new AppError(502, 'UPSTREAM_AUTH', 'API nguồn từ chối quyền truy cập. Kiểm tra credential và quyền Tech.', write);
      if (!response.ok) throw new AppError(502, 'UPSTREAM_HTTP', 'API nguồn trả lỗi HTTP. Vui lòng kiểm tra kết nối.', write);
      let json: unknown;
      try { json = await response.json(); }
      catch {
        if (controller.signal.aborted) throw new AppError(504, 'UPSTREAM_TIMEOUT', 'API nguồn hết thời gian chờ.', write);
        throw new AppError(502, 'UPSTREAM_INVALID_DATA', 'API nguồn trả dữ liệu không hợp lệ.', write);
      }
      const parsed = envelope.safeParse(json);
      if (!parsed.success) throw new AppError(502, 'UPSTREAM_INVALID_DATA', 'Phản hồi GraphQL không hợp lệ.', write);
      if (parsed.data.errors?.length) {
        const auth = parsed.data.errors.some(e => ['UNAUTHENTICATED', 'FORBIDDEN'].includes(e.extensions?.code ?? ''));
        // Do not reflect upstream error text: it can contain sensitive data.
        throw new AppError(502, auth ? 'UPSTREAM_AUTH' : 'UPSTREAM_GRAPHQL', auth ? 'API nguồn từ chối quyền truy cập.' : 'API GraphQL trả lỗi. Cần kiểm tra schema hoặc dữ liệu nguồn.', write);
      }
      const result = schema.safeParse(parsed.data.data);
      if (!result.success) throw new AppError(502, 'UPSTREAM_INVALID_DATA', 'Dữ liệu API không khớp cấu trúc đã khai báo. Cần xác minh schema thật.', write);
      return result.data;
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (controller.signal.aborted) throw new AppError(504, 'UPSTREAM_TIMEOUT', 'API nguồn hết thời gian chờ.', write);
      throw new AppError(502, 'UPSTREAM_NETWORK', 'Không kết nối được API nguồn.', write);
    } finally { clearTimeout(timeout); }
  }
}
