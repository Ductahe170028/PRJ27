import { useCallback, useEffect, useMemo, useState } from 'react';
import { SHOOTER_LEVEL_NAMES, shooterLevel } from '@game-creator/contracts';
import { loadArtIndex } from '../lib/art-fetch';
import { hasOverrides, variantFromParams, type KnownIds } from '../lib/shooter-variants';
import { levelInfo } from '../lib/shooter-text';
import { GamePreview } from './GamePreview';
import { LevelInfoCard } from './LevelInfoCard';

type Phase = 'loading' | 'playing' | 'error';

/** The ids of the art packs the playground may switch to: those drawn by code and those PNG packs in public/art/index.json. */
async function knownPacks(): Promise<KnownIds> {
  const { PROCEDURAL_PACKS } = await import('../game/art/registry');
  const index = await loadArtIndex();
  const ids = (kind: keyof KnownIds | 'pickup' | 'fx') => [...new Set([...Object.keys(PROCEDURAL_PACKS[kind]), ...index.filter((entry) => entry.kind === kind).map((entry) => entry.id)])];
  return { biome: ids('biome'), hero: ids('hero'), family: ids('family'), base: ids('base'), weapon: ids('weapon') };
}

/** Developer page for the hand-made shooter levels: /?shooter=<name>. It calls
 * no API and needs no backend. The main UI does not link here. The address can also change how the level looks and what is in it:
 * &biome=ice-base&hero=armor&family=robot&base=outpost&weapon=shotgun, &boss=crusher|gunner, &stress=120, &loadout=single (an id or value it does not know is ignored). */
export function ShooterPlayground({ name }: { name: string }) {
  const base = shooterLevel(name);
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const asked = hasOverrides(params);
  const [known, setKnown] = useState<KnownIds | undefined>();
  useEffect(() => {
    if (!asked) return undefined;
    let alive = true;
    knownPacks().then((ids) => { if (alive) setKnown(ids); }, () => undefined);
    return () => { alive = false; };
  }, [asked]);
  const level = useMemo(() => (!base ? undefined : !asked ? base : known ? variantFromParams(base, params, known) : undefined), [base, asked, known, params]);
  const [phase, setPhase] = useState<Phase>('loading');
  const [message, setMessage] = useState('');
  const onStarted = useCallback(() => setPhase('playing'), []);
  const onError = useCallback((text: string) => { setPhase('error'); setMessage(text); }, []);
  const info = useMemo(() => (level ? levelInfo(level) : undefined), [level]);
  const source = useMemo(() => (level ? { id: `shooter-${name}-${params.toString()}`, title: level.title, game: level } : undefined), [level, name, params]);

  return <main className="shooter-playground">
    <header>
      <h1>Survival Shooter · chơi thử</h1>
      <nav aria-label="Chọn level">
        {SHOOTER_LEVEL_NAMES.map((levelName) => <a key={levelName} href={`?shooter=${levelName}`} aria-current={levelName === name ? 'page' : undefined}>{levelName}</a>)}
      </nav>
    </header>
    {base && !source ? <p className="shooter-meta" role="status">Đang tải…</p> : !level || !source ? <div className="shooter-unknown" role="alert">
      <strong>Không có level “{name}”.</strong>
      <span>Level hợp lệ: {SHOOTER_LEVEL_NAMES.join(', ')}.</span>
    </div> : <>
      <p className="shooter-meta"><strong>{level.title}</strong> <span>{phase === 'playing' ? 'Đang chạy' : phase === 'error' ? 'Lỗi' : 'Đang tải…'}</span></p>
      <div className="shooter-stage">
        <GamePreview key={name} source={source} onStarted={onStarted} onError={onError}/>
      </div>
      {info && <LevelInfoCard info={info}/>}
      {phase === 'error' && <p role="alert" className="shooter-error">{message}</p>}
      <p className="shooter-help">
        <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> hoặc phím mũi tên: di chuyển · chuột: ngắm · giữ chuột trái: bắn · <kbd>R</kbd>: chơi lại.
        Bấm vào khung game trước để nhận phím.
      </p>
    </>}
  </main>;
}
