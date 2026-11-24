import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ArrowDown, ArrowUpRight, Check, CircleAlert, Code2, Crosshair, Gamepad2, LoaderCircle, MonitorPlay, Sparkles, Terminal } from 'lucide-react';
import { PROMPT_MAX_LENGTH, type ShooterProject } from '@game-creator/contracts';
import { checkHealth, describeError, generateShooter, type ApiIssue } from './lib/api';
import { promptLimitWarning, promptToSend } from './lib/prompt-draft';
import { levelInfo } from './lib/shooter-text';
import { AppHeader, ConnectionAlert, type Health } from './components/AppHeader';
import { EmptyPreview } from './components/EmptyPreview';
import { GamePreview } from './components/GamePreview';
import { ProviderSettings, useProviderSettings } from './components/ProviderSettings';

type Phase = 'idle' | 'generating' | 'booting' | 'playing' | 'error';

const phaseCopy: Record<Phase, { title: string; description: string }> = {
  idle: { title: 'Sẵn sàng cho ý tưởng của bạn', description: 'Mô tả bối cảnh, quái và độ khó của một trận sinh tồn.' },
  generating: { title: 'Đang dựng màn chơi…', description: 'AI chọn bối cảnh, bản đồ, quái và độ khó; engine dựng và kiểm tra màn. Có thể mất đến 50 giây.' },
  booting: { title: 'Đang khởi chạy preview…', description: 'Đang tải Phaser và khởi tạo màn chơi trong iframe.' },
  playing: { title: 'Game đã sẵn sàng!', description: 'Bấm vào khung preview để chơi.' },
  error: { title: 'Chưa thể khởi chạy game', description: 'Hãy kiểm tra kết nối và thử tạo lại.' },
};

/** The main app: a prompt becomes a top-down survival shooter. */
export function ShooterApp() {
  const settings = useProviderSettings();
  const [prompt, setPrompt] = useState('');
  const [project, setProject] = useState<ShooterProject | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [health, setHealth] = useState<Health>('checking');
  const [error, setError] = useState('');
  const [errorCode, setErrorCode] = useState('');
  const [issues, setIssues] = useState<ApiIssue[]>([]);
  const [fieldError, setFieldError] = useState('');
  const [healthError, setHealthError] = useState('');
  const generationRequest = useRef<AbortController | null>(null);
  const healthRequest = useRef<AbortController | null>(null);
  const busy = phase === 'generating' || phase === 'booting';
  // Stable between renders: a new object here would be a new preview source on every render.
  const source = useMemo(() => (project ? { id: project.id, title: project.title, game: project.level } : null), [project]);
  // The card is read from the level itself, so it can never disagree with the game that is played.
  const info = useMemo(() => (project ? levelInfo(project.level) : null), [project]);

  const refreshHealth = useCallback(async () => {
    healthRequest.current?.abort();
    const controller = new AbortController();
    healthRequest.current = controller;
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
    void refreshHealth();
    return () => { healthRequest.current?.abort(); generationRequest.current?.abort(); };
  }, [refreshHealth]);

  async function handleGenerate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !settings.available || settings.testing) return;
    const outgoing = promptToSend(prompt);
    if (outgoing === null) {
      setFieldError(promptLimitWarning(prompt) || 'Hãy nhập mô tả game.');
      return;
    }
    generationRequest.current?.abort();
    const controller = new AbortController();
    generationRequest.current = controller;
    setFieldError(''); setError(''); setErrorCode(''); setIssues([]); setProject(null);
    setPhase('generating');
    try {
      const result = await generateShooter(outgoing, settings.selection, controller.signal);
      if (controller.signal.aborted) return;
      healthRequest.current?.abort();
      setHealth('online'); setHealthError('');
      setProject(result);
      setPhase('booting');
    } catch (cause) {
      if (controller.signal.aborted) return;
      const described = describeError(cause, 'Không thể tạo game. Hãy thử lại.');
      setError(described.message); setErrorCode(described.code); setIssues(described.issues);
      setPhase('error');
    }
  }

  const onStarted = useCallback(() => setPhase('playing'), []);
  const onRuntimeError = useCallback((message: string) => {
    setError(message); setErrorCode(''); setIssues([]); setProject(null); setPhase('error');
  }, []);
  const limitWarning = promptLimitWarning(prompt);
  const completedSteps = phase === 'playing' ? 3 : phase === 'booting' ? 2 : phase === 'generating' ? 1 : 0;

  return <div className="app-shell">
    <AppHeader health={health} badge="SHOOTER"/>
    <main>
      <div className="page-intro">
        <div>
          <div className="eyebrow intro-eyebrow"><span className="small-dot"/> TOP-DOWN SHOOTER</div>
          <h1>Ý tưởng của bạn. <span>Một trận sinh tồn.</span></h1>
          <p>Mô tả bối cảnh, quái và độ khó. AI chọn, engine dựng màn bắn quái cho bạn chơi.</p>
        </div>
        <div className="demo-mode"><span className="demo-mode-icon"><Code2 size={17}/></span><div><strong>{settings.isDemo ? 'Demo mode' : settings.provider?.name ?? settings.selection.providerId}</strong><span>{settings.isDemo ? 'Màn mẫu · Không gọi AI' : 'AI + engine · Top-down shooter'}</span></div></div>
      </div>

      {health === 'offline' && <ConnectionAlert message={healthError} onRetry={() => void refreshHealth()}/>}

      <div className="workspace-grid">
        <aside className="creator-column" aria-label="Tạo game">
          <ProviderSettings settings={settings} disabled={busy}/>
          <section className="panel prompt-panel">
            <div className="panel-heading"><span className="section-number">01</span><h2>Mô tả game của bạn</h2><Sparkles size={16} className="muted-icon"/></div>
            <p className="panel-description">Một trận sinh tồn bắt đầu từ một ý tưởng.</p>
            <form onSubmit={(event) => void handleGenerate(event)}>
              <label htmlFor="prompt" className="field-label">Bạn muốn tạo game gì?</label>
              <div className={`prompt-input-wrap ${limitWarning || fieldError ? 'has-error' : ''}`}>
                <textarea
                  id="prompt"
                  name="prompt"
                  value={prompt}
                  onChange={(event) => { setPrompt(event.target.value); setFieldError(''); }}
                  placeholder="Ví dụ: Sinh tồn 90 giây trong bệnh viện bỏ hoang, zombie đi chậm nhưng ra liên tục, súng bắn nhanh…"
                  disabled={busy}
                  aria-invalid={Boolean(limitWarning || fieldError)}
                  aria-describedby="prompt-hint prompt-error"
                />
                <div className={`input-bottom${limitWarning ? ' is-over' : ''}`}><span><Terminal size={12}/> GAME PROMPT</span><span>{prompt.length.toLocaleString('vi-VN')} / {PROMPT_MAX_LENGTH.toLocaleString('vi-VN')}</span></div>
              </div>
              <p id="prompt-error" className="field-error" role={limitWarning || fieldError ? 'alert' : undefined}>{limitWarning || fieldError}</p>
              <button className="generate-button" type="submit" disabled={busy || !prompt.trim() || Boolean(limitWarning) || !settings.available || settings.testing}>
                {busy ? <LoaderCircle className="spin" size={18}/> : <Sparkles size={18}/>}
                <span>{busy ? 'Đang tạo game…' : 'Generate Game'}</span>
                {!busy && <ArrowUpRight size={18}/>}
              </button>
              <p id="prompt-hint" className="demo-note">{!settings.available ? settings.message : settings.isDemo ? 'Demo luôn chạy màn Đấu trường. Vào Settings để chọn Gemini hoặc Groq.' : `Tạo game bằng ${settings.provider?.name} · ${settings.model?.name ?? settings.selection.modelId}${settings.automatic ? ' (tự động)' : ''}. Hỗ trợ tiếng Việt và tiếng Anh.`}</p>
            </form>
          </section>

          <section className={`panel status-panel status-${phase}`} aria-label="Trạng thái tạo game">
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
              {['Mô tả', settings.isDemo ? 'Màn mẫu' : 'AI + Dựng màn', 'Preview'].map((label, index) => <div key={label} className={index < completedSteps ? 'step-complete' : ''}>
                <span>{index < completedSteps ? <Check size={10}/> : `0${index + 1}`}</span>{label}
              </div>)}
            </div>
          </section>

          {project && info && <section className="panel status-panel shooter-info" aria-label="Thông tin màn">
            <div className="status-heading"><Gamepad2 size={14}/><h2>Thông tin màn</h2></div>
            <dl>
              <div><dt>Mục tiêu</dt><dd data-info="goal">{info.goal}</dd></div>
              <div><dt>Máu tối đa</dt><dd data-info="health">{info.maxHealth}</dd></div>
              <div><dt>Quái tối đa</dt><dd data-info="enemies">{info.maxEnemies}</dd></div>
              <div><dt>Súng</dt><dd data-info="weapon">{info.weapon}<small>{info.weaponDetail}</small></dd></div>
            </dl>
          </section>}

          {project && project.notices.length > 0 && <section className="panel status-panel shooter-notices" role="status" aria-label="Chưa hỗ trợ và điều chỉnh">
            <div className="status-heading"><CircleAlert size={14}/><h2>Chưa hỗ trợ / điều chỉnh</h2></div>
            <ul>
              {project.notices.map((notice) => <li key={notice}>{notice}</li>)}
            </ul>
          </section>}
        </aside>

        <section className="panel preview-panel" aria-label="Xem và chơi game" aria-busy={busy}>
          <div className="preview-heading">
            <div className="preview-heading-title"><MonitorPlay size={18}/><h2>Game preview</h2><span className="preview-type">TOP-DOWN SHOOTER</span></div>
            <div className={`preview-state ${phase === 'playing' ? 'is-live' : ''}`}><span className="small-dot"/>{phase === 'playing' ? 'Đang chạy' : busy ? 'Đang tải' : 'Chờ khởi tạo'}</div>
          </div>
          <div className="preview-viewport">
            {project && source ? <GamePreview key={project.id} source={source} onStarted={onStarted} onError={onRuntimeError}/> : <EmptyPreview tag="Top-down Shooter" hint="để dựng màn bắn quái đầu tiên."/>}
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
        </section>
      </div>

      <div className="workspace-caption"><span><ArrowDown size={13}/> Nhập ý tưởng. Tạo game. Bấm vào preview để chơi.</span><span>MỘT ENGINE. NHIỀU TRẬN SINH TỒN.</span></div>
    </main>
    <footer className="site-footer"><span>AI Game Creator <span className="footer-separator">/</span> Top-down Shooter</span><span>Built for your next idea<span className="footer-spark">✦</span></span></footer>
  </div>;
}
