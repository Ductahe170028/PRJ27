import { Check, CircleAlert, LoaderCircle, Terminal } from 'lucide-react';
import type { ApiIssue } from '../lib/api';
import type { Phase } from '../lib/use-generate';

const phaseCopy: Record<Phase, { title: string; description: string }> = {
  idle: { title: 'Sẵn sàng cho ý tưởng của bạn', description: 'Mô tả bối cảnh, quái và độ khó của một trận sinh tồn.' },
  generating: { title: 'Đang dựng màn chơi…', description: 'AI chọn bối cảnh, bản đồ, quái và độ khó; engine dựng và kiểm tra màn. Có thể mất đến 50 giây.' },
  booting: { title: 'Đang khởi chạy preview…', description: 'Đang tải Phaser và khởi tạo màn chơi trong iframe.' },
  playing: { title: 'Game đã sẵn sàng!', description: 'Bấm vào khung preview để chơi.' },
  error: { title: 'Chưa thể khởi chạy game', description: 'Hãy kiểm tra kết nối và thử tạo lại.' },
};

interface StatusPanelProps {
  phase: Phase;
  busy: boolean;
  isDemo: boolean;
  error: string;
  errorCode: string;
  issues: ApiIssue[];
}

/** "Trạng thái": what the app is doing, the error with its code and the failing fields, and the three steps. */
export function StatusPanel({ phase, busy, isDemo, error, errorCode, issues }: StatusPanelProps) {
  const completedSteps = phase === 'playing' ? 3 : phase === 'booting' ? 2 : phase === 'generating' ? 1 : 0;
  return <section className={`panel status-panel status-${phase}`} aria-label="Trạng thái tạo game">
    <div className="status-heading"><Terminal size={14}/><h2>Trạng thái</h2><span className="status-tiny-label">{phase === 'playing' ? 'COMPLETE' : busy ? 'RUNNING' : phase === 'error' ? 'ERROR' : 'READY'}</span></div>
    <div className="status-message" role={phase === 'error' ? 'alert' : 'status'} aria-live="polite" aria-atomic="true">
      <div className="status-symbol">{busy ? <LoaderCircle size={18} className="spin"/> : phase === 'playing' ? <Check size={18}/> : phase === 'error' ? <CircleAlert size={18}/> : <span className="small-dot"/>}</div>
      <div>
        <h3>{phaseCopy[phase].title}</h3>
        <p>{phase === 'error' ? error : phaseCopy[phase].description}</p>
        {phase === 'error' && errorCode && <p className="error-code">Mã lỗi: <code>{errorCode}</code></p>}
        {phase === 'error' && issues.length > 0 && <ul className="spec-issues" aria-label="Chi tiết lỗi">
          {issues.map((issue, index) => {
            const field = typeof issue === 'string' ? issue || 'brief' : issue.path || 'brief';
            return <li key={`${field}-${index}`}><code>{field}</code></li>;
          })}
        </ul>}
      </div>
    </div>
    <div className="generation-steps" aria-label="Tiến trình">
      {['Mô tả', isDemo ? 'Màn mẫu' : 'AI + Dựng màn', 'Preview'].map((label, index) => <div key={label} className={index < completedSteps ? 'step-complete' : ''}>
        <span>{index < completedSteps ? <Check size={10}/> : `0${index + 1}`}</span>{label}
      </div>)}
    </div>
  </section>;
}
