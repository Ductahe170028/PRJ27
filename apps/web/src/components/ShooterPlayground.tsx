import { useCallback, useMemo, useState } from 'react';
import { SHOOTER_LEVEL_NAMES, shooterLevel } from '@game-creator/contracts';
import { GamePreview } from './GamePreview';

type Phase = 'loading' | 'playing' | 'error';

/** Developer page for the hand-made shooter levels: /?shooter=<name>. It calls
 * no API and needs no backend. The main UI does not link here. */
export function ShooterPlayground({ name }: { name: string }) {
  const level = shooterLevel(name);
  const [phase, setPhase] = useState<Phase>('loading');
  const [message, setMessage] = useState('');
  const onStarted = useCallback(() => setPhase('playing'), []);
  const onError = useCallback((text: string) => { setPhase('error'); setMessage(text); }, []);
  const source = useMemo(() => (level ? { id: `shooter-${name}`, title: level.title, game: level } : undefined), [level, name]);

  return <main className="shooter-playground">
    <header>
      <h1>Survival Shooter · chơi thử</h1>
      <nav aria-label="Chọn level">
        {SHOOTER_LEVEL_NAMES.map((levelName) => <a key={levelName} href={`?shooter=${levelName}`} aria-current={levelName === name ? 'page' : undefined}>{levelName}</a>)}
      </nav>
    </header>
    {!level || !source ? <div className="shooter-unknown" role="alert">
      <strong>Không có level “{name}”.</strong>
      <span>Level hợp lệ: {SHOOTER_LEVEL_NAMES.join(', ')}.</span>
    </div> : <>
      <p className="shooter-meta"><strong>{level.title}</strong> <span>{phase === 'playing' ? 'Đang chạy' : phase === 'error' ? 'Lỗi' : 'Đang tải…'}</span></p>
      <div className="shooter-stage">
        <GamePreview key={name} source={source} onStarted={onStarted} onError={onError}/>
      </div>
      {phase === 'error' && <p role="alert" className="shooter-error">{message}</p>}
      <p className="shooter-help">
        <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> hoặc phím mũi tên: di chuyển · chuột: ngắm · giữ chuột trái: bắn · <kbd>R</kbd>: chơi lại.
        Bấm vào khung game trước để nhận phím.
      </p>
    </>}
  </main>;
}
