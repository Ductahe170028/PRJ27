import { z } from 'zod';
import { errorSchema, lessonResultSchema, metaSchema, reopenResultSchema, searchResultSchema, submissionDetailSchema, type ReopenInput } from '../../shared/contracts.js';

export class ApiError extends Error {
  constructor(message: string, public code: string, public uncertain = false, public requestId?: string) { super(message); }
}
async function request<T>(url: string, schema: z.ZodType<T>, options: { signal?: AbortSignal; body?: unknown } = {}): Promise<T> {
  const write = options.body !== undefined;
  // A write includes fresh ownership reads, one mutation and its verification read.
  const timeout = AbortSignal.timeout(write ? 90000 : 45000);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  try {
    const response = await fetch(url, { method: write ? 'POST' : 'GET', credentials: 'same-origin', headers: write ? { 'Content-Type': 'application/json' } : {}, ...(write ? { body: JSON.stringify(options.body) } : {}), signal });
    let json: unknown;
    try { json = await response.json(); }
    catch { throw new ApiError('Máy chủ trả phản hồi không hợp lệ.', 'INVALID_RESPONSE', write); }
    if (!response.ok) {
      const parsed = errorSchema.safeParse(json);
      if (parsed.success) throw new ApiError(parsed.data.error.message, parsed.data.error.code, parsed.data.error.uncertain ?? false, parsed.data.error.requestId);
      throw new ApiError('Không thể xử lý yêu cầu. Vui lòng tải lại dữ liệu.', 'HTTP_ERROR', write);
    }
    const result = schema.safeParse(json);
    if (!result.success) throw new ApiError('Dữ liệu từ máy chủ không hợp lệ.', 'INVALID_RESPONSE', write);
    return result.data;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (options.signal?.aborted) throw error;
    throw new ApiError(write ? 'Mất kết nối khi mở lại. Kết quả chưa xác định; không gửi lại thao tác. Hãy tải lại và kiểm tra trên Denise.' : 'Không kết nối được máy chủ hoặc yêu cầu hết thời gian chờ. Vui lòng thử lại.', 'NETWORK_ERROR', write);
  }
}
const segment = encodeURIComponent;
const base = (code: string, enrollment: string) => `/api/students/${segment(code)}/courses/${segment(enrollment)}/lessons`;
export const api = {
  context: (signal?: AbortSignal) => request('/api/context', metaSchema, { signal }),
  search: (code: string, signal?: AbortSignal) => request(`/api/students/${segment(code)}`, searchResultSchema, { signal }),
  lessons: (code: string, enrollment: string, signal?: AbortSignal) => request(base(code, enrollment), lessonResultSchema, { signal }),
  prepare: (code: string, enrollment: string, lessonId: string, submissionId: string, signal?: AbortSignal) => request(`${base(code, enrollment)}/${segment(lessonId)}/submissions/${segment(submissionId)}`, submissionDetailSchema, { signal }),
  reopen: (body: ReopenInput) => request('/api/reopen', reopenResultSchema, { body }),
};
