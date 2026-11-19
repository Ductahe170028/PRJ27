import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ArrowDown, ArrowLeft, ArrowRight, ArrowUpRight, Check, CircleAlert, Code2,
  Gamepad2, Layers2, LoaderCircle, MonitorPlay, RefreshCw, Sparkles, Terminal,
} from 'lucide-react';
import { PROMPT_MAX_LENGTH, type GameProject } from '@game-creator/contracts';
import { checkHealth, describeError, generateGame, type ApiIssue } from './lib/api';
import { promptLimitWarning, promptToSend } from './lib/prompt-draft';
import { EmptyPreview } from './components/EmptyPreview';
import { GamePreview } from './components/GamePreview';
import { ProviderSettings, useProviderSettings } from './components/ProviderSettings';
import { AdvancedWorkspace } from './components/AdvancedWorkspace';

type Phase = 'idle' | 'generating' | 'booting' | 'playing' | 'error';
type Health = 'checking' | 'online' | 'offline';

const phaseCopy: Record<Phase, { title: string; description: string }> = {
  idle: { title: 'Sẵn sàng cho ý tưởng của bạn', description: 'Bắt đầu bằng một mô tả ngắn về game bạn muốn tạo.' },
  generating: { title: 'Đang tạo dữ liệu game…', description: 'Backend đang tạo và kiểm tra màn chơi. Có thể mất đến 50 giây.' },
  booting: { title: 'Đang khởi chạy preview…', description: 'Đang tải Phaser và khởi tạo màn chơi trong iframe.' },
  playing: { title: 'Game đã sẵn sàng!', description: 'Bấm vào khung preview để điều khiển nhân vật.' },
  error: { title: 'Chưa thể khởi chạy game', description: 'Hãy kiểm tra kết nối và thử tạo lại.' },
};

export function App() {
  const settings = useProviderSettings();
  const [advanced, setAdvanced] = useState(false);
  const [advancedBusy, setAdvancedBusy] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [project, setProject] = useState<GameProject | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [health, setHealth] = useState<Health>('checking');
  const [error, setError] = useState('');
  const [errorCode, setErrorCode] = useState('');
  const [specIssues, setSpecIssues] = useState<ApiIssue[]>([]);
  const [fieldError, setFieldError] = useState('');
  const [healthError, setHealthError] = useState('');
  const generationRequest = useRef<AbortController | null>(null);
  const healthRequest = useRef<AbortController | null>(null);
  const busy = phase === 'generating' || phase === 'booting';

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
    return () => {
      healthRequest.current?.abort();
      generationRequest.current?.abort();
    };
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
    setFieldError('');
    setError('');
    setErrorCode('');
    setSpecIssues([]);
    setProject(null);
    setPhase('generating');
    try {
      const result = await generateGame(outgoing, settings.selection, controller.signal);
      if (controller.signal.aborted) return;
      healthRequest.current?.abort();
      setHealth('online');
      setHealthError('');
      setProject(result);
      setPhase('booting');
    } catch (cause) {
      if (controller.signal.aborted) return;
      const described = describeError(cause, 'Không thể tạo game. Hãy thử lại.');
      setError(described.message);
      setErrorCode(described.code);
      setSpecIssues(described.issues);
      setPhase('error');
    }
  }

  const onStarted = useCallback(() => setPhase('playing'), []);
  const onRuntimeError = useCallback((message: string) => {
    setError(message);
    setErrorCode('');
    setSpecIssues([]);
    setProject(null);
    setPhase('error');
  }, []);
  const limitWarning = promptLimitWarning(prompt);
  const completedSteps = phase === 'playing' ? 3 : phase === 'booting' ? 2 : phase === 'generating' ? 1 : 0;

  return <div className="app-shell">
    <header className="topbar">
      <a className="brand" href="/" aria-label="AI Game Creator — trang chủ">
        <span className="brand-icon"><Gamepad2 size={23} strokeWidth={1.8}/></span>
        <span>Game<span className="brand-light">Creator</span><span className="brand-ai">AI</span></span>
      </a>
      <div className="workspace-label"><span className="topbar-divider"/><Layers2 size={15}/> Creator workspace</div>
      <div className="topbar-right">
        <span className={`connection connection-${health}`} role="status">
          <span className="small-dot"/>
          {health === 'online' ? 'Backend đã kết nối' : health === 'checking' ? 'Đang kết nối backend' : 'Backend chưa kết nối'}
        </span>
        <span className="phase-badge">PHASE 03</span>
      </div>
    </header>

    <main>
      <div className="page-intro">
        <div>
          <div className="eyebrow intro-eyebrow"><span className="small-dot"/> IDEA TO PLAY</div>
          <h1>Ý tưởng của bạn. <span>Sân chơi tiếp theo.</span></h1>
          <p>Chọn AI, mô tả ý tưởng và chơi màn game của bạn.</p>
        </div>
        <div className="demo-mode"><span className="demo-mode-icon"><Code2 size={17}/></span><div><strong>{advanced ? 'Advanced AI Mode' : settings.isDemo ? 'Demo mode' : settings.provider?.name ?? settings.selection.providerId}</strong><span>{advanced ? 'Code Agent · Local preview' : settings.isDemo ? 'Game mẫu · Không gọi AI' : 'AI generation · GameSpec v1'}</span></div></div>
      </div>

      <div className="generation-mode" role="group" aria-label="Chế độ tạo game">
        <button type="button" aria-pressed={!advanced} disabled={busy || advancedBusy} onClick={() => setAdvanced(false)}>Standard Mode <span>GameSpec · nhanh và ổn định</span></button>
        <button type="button" aria-pressed={advanced} disabled={busy || advancedBusy} onClick={() => setAdvanced(true)}>Advanced AI Mode <span>Code mới · kiểm tra và sửa lỗi</span></button>
      </div>
      {health === 'offline' && <div className="connection-alert" role="alert">
        <CircleAlert size={17}/><span>{healthError}</span>
        <button type="button" onClick={() => void refreshHealth()}><RefreshCw size={13}/> Kiểm tra lại</button>
      </div>}

      {advanced ? <AdvancedWorkspace settings={settings} onBusy={setAdvancedBusy}/> : <div className="workspace-grid">
        <aside className="creator-column" aria-label="Tạo game">
          <ProviderSettings settings={settings} disabled={busy}/>
          <section className="panel prompt-panel">
            <div className="panel-heading"><span className="section-number">01</span><h2>Mô tả game của bạn</h2><Sparkles size={16} className="muted-icon"/></div>
            <p className="panel-description">Mọi thế giới đều bắt đầu từ một ý tưởng.</p>
            <form onSubmit={(event) => void handleGenerate(event)}>
              <label htmlFor="prompt" className="field-label">Bạn muốn tạo game gì?</label>
              <div className={`prompt-input-wrap ${limitWarning || fieldError ? 'has-error' : ''}`}>
                <textarea
                  id="prompt"
                  name="prompt"
                  value={prompt}
                  onChange={(event) => { setPrompt(event.target.value); setFieldError(''); }}
                  placeholder="Ví dụ: Một game platformer 2D, nơi phi hành gia nhỏ khám phá thành phố dưới ánh trăng, nhảy qua các nền tảng…"
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
              <p id="prompt-hint" className="demo-note">{!settings.available ? settings.message : settings.isDemo ? 'Demo luôn chạy Moonlight Run. Vào Settings để chọn Gemini hoặc Groq.' : `Tạo game bằng ${settings.provider?.name} · ${settings.model?.name ?? settings.selection.modelId}${settings.automatic ? ' (tự động)' : ''}. Hỗ trợ tiếng Việt và tiếng Anh.`}</p>
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
                {phase === 'error' && specIssues.length > 0 && <ul className="spec-issues" aria-label="Chi tiết GameSpec">
                  {specIssues.map((issue, index) => {
                    const field = typeof issue === 'string' ? issue || 'GameSpec' : issue.path || 'GameSpec';
                    const code = typeof issue === 'string' ? '' : issue.code;
                    const message = typeof issue === 'string' ? '' : issue.message;
                    return <li key={`${field}-${index}`}>
                      <code>{field}</code>
                      {code ? <span className="issue-code">{code}</span> : null}
                      {message ? <span>{message}</span> : null}
                    </li>;
                  })}
                </ul>}
              </div>
            </div>
            <div className="generation-steps" aria-label="Tiến trình">
              {['Mô tả', settings.isDemo ? 'Demo API' : 'AI + Kiểm tra', 'Preview'].map((label, index) => <div key={label} className={index < completedSteps ? 'step-complete' : ''}>
                <span>{index < completedSteps ? <Check size={10}/> : `0${index + 1}`}</span>{label}
              </div>)}
            </div>
          </section>
        </aside>

        <section className="panel preview-panel" aria-label="Xem và chơi game" aria-busy={busy}>
          <div className="preview-heading">
            <div className="preview-heading-title"><MonitorPlay size={18}/><h2>Game preview</h2><span className="preview-type">{project && 'genre' in project.game ? project.game.genre.toUpperCase() : '2D PLATFORMER'}</span></div>
            <div className={`preview-state ${phase === 'playing' ? 'is-live' : ''}`}><span className="small-dot"/>{phase === 'playing' ? 'Đang chạy' : busy ? 'Đang tải' : 'Chờ khởi tạo'}</div>
          </div>
          <div className="preview-viewport">
            {project ? <GamePreview key={project.id} project={project} onStarted={onStarted} onError={onRuntimeError}/> : <EmptyPreview/>}
            {busy && <div className="preview-loading" role="status"><LoaderCircle className="spin" size={27}/><strong>{phase === 'generating' ? 'Đang chuẩn bị màn chơi' : 'Đang khởi chạy game'}</strong><span>Chỉ một chút nữa thôi…</span></div>}
          </div>
          <div className="preview-controls">
            <div className="controls-label"><Gamepad2 size={17}/><span>Điều khiển</span></div>
            <div className="control-group"><span>{project && 'controls' in project.game ? project.game.controls.movement === 'wasd' ? 'W A S D' : project.game.controls.movement === 'arrows' ? 'Phím mũi tên' : 'WASD / Mũi tên' : <><kbd>A</kbd> <kbd>D</kbd> / <kbd><ArrowLeft size={11}/></kbd> <kbd><ArrowRight size={11}/></kbd></>}</span><span>Di chuyển</span></div>
            <span className="controls-divider"/>
            {!(project && 'genre' in project.game && project.game.genre === 'top-down') && <div className="control-group"><kbd className="key-space">{project && 'controls' in project.game && project.game.controls.jump === 'up' ? '↑ / W' : project && 'controls' in project.game && project.game.controls.jump === 'both' ? 'Space / ↑ / W' : 'Space'}</kbd><span>Nhảy</span></div>}
            <div className="control-group control-reset"><kbd>R</kbd><span>Chơi lại</span></div>
          </div>
          <div className="preview-footer"><span><span className="small-dot"/> Phaser 3 <span className="footer-separator">/</span> Arcade Physics</span><span>960 × 540 <span className="footer-separator">·</span> Sandbox preview</span></div>
        </section>
      </div>}

      <div className="workspace-caption"><span><ArrowDown size={13}/> Nhập ý tưởng. Tạo game. Bấm vào preview để chơi.</span><span>NỀN TẢNG HÔM NAY. SÁNG TẠO NGÀY MAI.</span></div>
    </main>
    <footer className="site-footer"><span>AI Game Creator <span className="footer-separator">/</span> Giai đoạn 3</span><span>Built for your next idea<span className="footer-spark">✦</span></span></footer>
  </div>;
}
