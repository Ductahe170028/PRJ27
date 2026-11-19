import { useEffect, useMemo, useRef } from 'react';
import { RuntimeEventSchema, type GameProject } from '@game-creator/contracts';
import { createPreviewDocument } from '../lib/preview-document';
import { randomUuid } from '../lib/uuid';

interface GamePreviewProps {
  project: GameProject;
  onStarted: () => void;
  onError: (message: string) => void;
}

export function GamePreview({ project, onStarted, onError }: GamePreviewProps) {
  const frame = useRef<HTMLIFrameElement>(null);
  const sessionId = useMemo(() => randomUuid(), [project.id]);
  const document = useMemo(() => createPreviewDocument(sessionId), [sessionId]);

  useEffect(() => {
    let started = false;
    let initialized = false;
    const timer = window.setTimeout(() => {
      if (!started) onError('Game chưa khởi chạy sau 15 giây. Hãy nhấn Generate Game để thử lại.');
    }, 15_000);
    const onMessage = (event: MessageEvent<unknown>) => {
      // Opaque-origin iframe: identify the sender by its Window and session ID.
      if (event.source !== frame.current?.contentWindow || event.origin !== 'null') return;
      const result = RuntimeEventSchema.safeParse(event.data);
      if (!result.success || result.data.sessionId !== sessionId) return;
      switch (result.data.type) {
        case 'runtime:ready':
          if (initialized) return;
          initialized = true;
          // '*' is required for a sandboxed recipient with an opaque origin.
          frame.current?.contentWindow?.postMessage({
            channel: 'game-creator', type: 'runtime:init', sessionId, game: project.game,
          }, '*');
          break;
        case 'runtime:started':
          if (started || !initialized) return;
          started = true;
          window.clearTimeout(timer);
          onStarted();
          break;
        case 'runtime:error':
          window.clearTimeout(timer);
          onError('Game gặp lỗi khi chạy. Hãy nhấn Generate Game để tạo lại preview.');
          break;
      }
    };
    window.addEventListener('message', onMessage);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('message', onMessage);
    };
  }, [project, sessionId, onStarted, onError]);

  return <iframe
    ref={frame}
    title={`Game preview — ${project.title}`}
    sandbox="allow-scripts"
    referrerPolicy="no-referrer"
    srcDoc={document}
    className="game-frame"
  />;
}
