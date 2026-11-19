import { useEffect, useMemo, useRef } from 'react';
import { createCodeDocument, type CodeProject } from '@game-creator/contracts';
import { randomUuid } from '../lib/uuid';

export function CodePreview({ project, onStarted, onError }: { project: CodeProject; onStarted: () => void; onError: (message: string) => void }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const id = useMemo(() => randomUuid(), [project.id]);
  const doc = useMemo(() => createCodeDocument(project.javascript, new URL(`${import.meta.env.BASE_URL}runtime/advanced.js`, window.location.origin).href, id), [project.javascript, id]);
  useEffect(() => {
    let lastHeartbeat = Date.now(), started = false, failed = false;
    const fail = (message: string) => { if (!failed) { failed = true; onError(message); } };
    const listener = (event: MessageEvent<unknown>) => {
      if (event.source !== frame.current?.contentWindow || event.origin !== 'null' || !event.data || typeof event.data !== 'object') return;
      const data = event.data as { channel?: unknown; sessionId?: unknown; type?: unknown; message?: unknown };
      if (data.channel !== 'code-runtime' || data.sessionId !== id) return;
      if (data.type === 'error') fail(typeof data.message === 'string' ? data.message.slice(0, 400) : 'Game gặp lỗi runtime.');
      if (data.type === 'heartbeat' || data.type === 'started') lastHeartbeat = Date.now();
      if (data.type === 'started' && !started && !failed) { started = true; onStarted(); }
    };
    window.addEventListener('message', listener);
    // Hidden tabs may suspend both interval callbacks and iframe heartbeats.
    // Give the runtime its normal response window when the tab becomes visible.
    const resume = () => { if (!document.hidden) lastHeartbeat = Date.now(); };
    document.addEventListener('visibilitychange', resume);
    const timer = window.setInterval(() => {
      if (document.hidden) { lastHeartbeat = Date.now(); return; }
      if (Date.now() - lastHeartbeat > (started ? 6000 : 15000)) fail('Preview không phản hồi trong thời hạn. Game đã dừng; nhấn Retry để thử lại.');
    }, 1000);
    return () => {
      window.removeEventListener('message', listener);
      document.removeEventListener('visibilitychange', resume);
      window.clearInterval(timer);
    };
  }, [id, onStarted, onError]);
  return <iframe ref={frame} title={`Advanced game — ${project.plan.title}`} sandbox="allow-scripts" referrerPolicy="no-referrer"
    allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'; usb 'none'; payment 'none'" srcDoc={doc} className="game-frame"/>;
}
