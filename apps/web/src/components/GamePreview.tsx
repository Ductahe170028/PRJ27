import { useEffect, useMemo, useRef } from 'react';
import { RuntimeEventSchema, type RuntimeGame } from '@game-creator/contracts';
import { createPreviewDocument } from '../lib/preview-document';
import { randomUuid } from '../lib/uuid';

/** What the preview needs of a game: an id to key the session, a title for the frame, and the game data. */
export interface GameSource { id: string; title: string; game: RuntimeGame }

interface GamePreviewProps {
  source: GameSource;
  onStarted: () => void;
  onError: (message: string) => void;
}

export function GamePreview({ source, onStarted, onError }: GamePreviewProps) {
  const frame = useRef<HTMLIFrameElement>(null);
  const sessionId = useMemo(() => randomUuid(), [source.id]);
  const document = useMemo(() => createPreviewDocument(sessionId), [sessionId]);
  // What the effect reads when a message arrives. A parent that re-renders (typing in a
  // prompt box, a state change) hands over a new `source` object or new callbacks; that
  // must never restart the session: the iframe would not send `ready`/`started` again,
  // and the 15 second timer would report a game that is running as not started.
  const latest = useRef({ game: source.game, onStarted, onError });
  latest.current = { game: source.game, onStarted, onError };

  // One preview session = one effect run: it depends on the session identity only.
  useEffect(() => {
    let started = false;
    let initialized = false;
    const timer = window.setTimeout(() => {
      if (!started) latest.current.onError('Game chưa khởi chạy sau 15 giây. Hãy nhấn Generate Game để thử lại.');
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
            channel: 'game-creator', type: 'runtime:init', sessionId, game: latest.current.game,
          }, '*');
          break;
        case 'runtime:started':
          if (started || !initialized) return;
          started = true;
          window.clearTimeout(timer);
          latest.current.onStarted();
          break;
        case 'runtime:error':
          window.clearTimeout(timer);
          latest.current.onError('Game gặp lỗi khi chạy. Hãy nhấn Generate Game để tạo lại preview.');
          break;
      }
    };
    window.addEventListener('message', onMessage);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('message', onMessage);
    };
  }, [sessionId, source.id]);

  return <iframe
    ref={frame}
    title={`Game preview — ${source.title}`}
    sandbox="allow-scripts"
    referrerPolicy="no-referrer"
    srcDoc={document}
    className="game-frame"
  />;
}
