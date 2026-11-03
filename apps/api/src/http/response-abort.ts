import type { Response } from 'express';

/** Keep upstream work tied to the response, including streamed responses. */
export async function withResponseAbort<T>(response: Response, task: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const disconnect = () => { if (!response.writableEnded) controller.abort(); };
  response.on('close', disconnect);
  if (response.destroyed) disconnect();
  try { return await task(controller.signal); }
  finally { response.off('close', disconnect); }
}
