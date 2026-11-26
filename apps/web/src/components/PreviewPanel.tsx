import { ArrowDown, Crosshair, Gamepad2, LoaderCircle, MonitorPlay } from 'lucide-react';
import type { ShooterProject } from '@game-creator/contracts';
import type { Phase } from '../lib/use-generate';
import { EmptyPreview } from './EmptyPreview';
import { GamePreview, type GameSource } from './GamePreview';

interface PreviewPanelProps {
  phase: Phase;
  busy: boolean;
  project: ShooterProject | null;
  source: GameSource | null;
  onStarted: () => void;
  onError: (message: string) => void;
}

/** The right-hand side: the game in its frame (or the empty stage), the loading veil, the controls and the footer. */
export function PreviewPanel({ phase, busy, project, source, onStarted, onError }: PreviewPanelProps) {
  return <section className="panel preview-panel" aria-label="Xem và chơi game" aria-busy={busy}>
    <div className="preview-heading">
      <div className="preview-heading-title"><MonitorPlay size={18}/><h2>Game preview</h2><span className="preview-type">TOP-DOWN SHOOTER</span></div>
      <div className={`preview-state ${phase === 'playing' ? 'is-live' : ''}`}><span className="small-dot"/>{phase === 'playing' ? 'Đang chạy' : busy ? 'Đang tải' : 'Chờ khởi tạo'}</div>
    </div>
    <div className="preview-viewport">
      {project && source ? <GamePreview key={project.id} source={source} onStarted={onStarted} onError={onError}/> : <EmptyPreview/>}
      {busy && <div className="preview-loading" role="status"><LoaderCircle className="spin" size={27}/><strong>{phase === 'generating' ? 'Đang dựng màn chơi' : 'Đang khởi chạy game'}</strong><span>Chỉ một chút nữa thôi…</span></div>}
    </div>
    <div className="preview-controls">
      <div className="controls-label"><Gamepad2 size={17}/><span>Điều khiển</span></div>
      <div className="control-group"><span>WASD / mũi tên</span><span>Di chuyển</span></div>
      <span className="controls-divider"/>
      <div className="control-group"><span><Crosshair size={13}/> Chuột</span><span>Ngắm · giữ chuột trái để bắn</span></div>
      <div className="control-group control-reset"><kbd>R</kbd><span>Chơi lại</span></div>
    </div>
    <div className="preview-footer"><span><span className="small-dot"/> Phaser 3 <span className="footer-separator">/</span> Mô phỏng thuần</span><span>960 × 540 <span className="footer-separator">·</span> Sandbox preview</span></div>
  </section>;
}

/** The line under the two columns. */
export function WorkspaceCaption() {
  return <div className="workspace-caption"><span><ArrowDown size={13}/> Nhập ý tưởng. Tạo game. Bấm vào preview để chơi.</span><span>MỘT ENGINE. NHIỀU TRẬN SINH TỒN.</span></div>;
}
