import { useCallback, useEffect, useRef, useState } from 'react';
import { checkHealth } from './api';
import type { Health } from '../components/AppHeader';

/** Whether the backend answers. Checked once when the page opens, and again whenever `refresh` is called. */
export function useHealth() {
  const [health, setHealth] = useState<Health>('checking');
  const [healthError, setHealthError] = useState('');
  const request = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setHealth('checking');
    setHealthError('');
    try {
      await checkHealth(controller.signal);
      if (!controller.signal.aborted) setHealth('online');
    } catch (cause) {
      if (controller.signal.aborted) return;
      setHealth('offline');
      setHealthError(cause instanceof Error ? cause.message : 'Không kết nối được backend.');
    }
  }, []);

  useEffect(() => {
    void refresh();
    return () => request.current?.abort();
  }, [refresh]);

  /** A generation reached the backend, so it is online whatever the last check said. */
  const confirmOnline = useCallback(() => {
    request.current?.abort();
    setHealth('online');
    setHealthError('');
  }, []);

  return { health, healthError, refresh, confirmOnline };
}
