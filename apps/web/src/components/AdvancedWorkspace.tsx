import { useCallback, useEffect, useRef, useState } from 'react';
import { Code2, LoaderCircle, MonitorPlay, RefreshCw, Sparkles } from 'lucide-react';
import { PROMPT_MAX_LENGTH, type AgentStage, type CodeProject, type GamePlan } from '@game-creator/contracts';
import { ProviderSettings, useProviderSettings } from './ProviderSettings';
import { getAgentConfig, generateAdvanced } from '../lib/agent-api';
import { ApiRequestError, describeError } from '../lib/api';
import { CodePreview } from './CodePreview';

type Settings = ReturnType<typeof useProviderSettings>;
const stages: AgentStage[] = ['Planning', 'Coding', 'Validating', 'Testing', 'Repairing', 'Completed'];
export function AdvancedWorkspace({ settings, onBusy }: { settings: Settings; onBusy: (busy: boolean) => void }) {
  const [prompt, setPrompt] = useState('');
  const [config, setConfig] = useState({ enabled: false, message: 'Đang kiểm tra Advanced…' });
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<AgentStage | null>(null);
  const [visited, setVisited] = useState<AgentStage[]>([]);
  const [message, setMessage] = useState('Mô tả cơ chế bạn muốn tạo.');
  const [logs, setLogs] = useState<string[]>([]);
  const [plan, setPlan] = useState<GamePlan | null>(null);
  const [project, setProject] = useState<CodeProject | null>(null);
  const [error, setError] = useState('');
  const [errorCode, setErrorCode] = useState('');
  const [playing, setPlaying] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void getAgentConfig(controller.signal).then(setConfig).catch((cause: unknown) => {
      if (!controller.signal.aborted) setConfig({ enabled: false, message: cause instanceof Error ? cause.message : 'Advanced chưa khả dụng.' });
    });
    return () => { controller.abort(); request.current?.abort(); onBusy(false); };
  }, [onBusy]);
  const runtimeError = useCallback((text: string) => { setProject(null); setPlaying(false); setStage('Failed'); setError(text); setErrorCode('runtime_error'); setLogs((old) => [...old, text].slice(-30)); }, []);
  const started = useCallback(() => setPlaying(true), []);
  const allowed = config.enabled && settings.available && !settings.isDemo && !settings.testing;
  async function run() {
    if (busy || !allowed || !prompt.trim()) return;
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    setBusy(true); onBusy(true); setProject(null); setPlan(null); setLogs([]); setError(''); setErrorCode(''); setPlaying(false); setVisited([]);
    try {
      await generateAdvanced(prompt.trim(), settings.selection, controller.signal, (event) => {
        if (controller.signal.aborted) return;
        if (event.type === 'status') { setStage(event.stage); setMessage(event.message); setVisited((old) => old.includes(event.stage) ? old : [...old, event.stage]); }
        if (event.type === 'plan') setPlan(event.plan);
        if (event.type === 'log') setLogs((old) => [...old, ...event.lines].slice(-30));
        if (event.type === 'completed') setProject(event.project);
        if (event.type === 'failed') {
          const detail = describeError(new ApiRequestError(event.error.message, event.error.code, event.error.retryAfterSeconds), 'Advanced thất bại.');
          setError(detail.message); setErrorCode(detail.code); setStage('Failed');
        }
      });
    } catch (cause) {
      if (!controller.signal.aborted) { const detail = describeError(cause, 'Không kết nối được Advanced.'); setError(detail.message); setErrorCode(detail.code); setStage('Failed'); }
    } finally { if (!controller.signal.aborted) { setBusy(false); onBusy(false); } }
  }
  return <div className="workspace-grid advanced-workspace">
    <aside className="creator-column">
      <ProviderSettings settings={settings} disabled={busy} advanced/>
      <section className="panel prompt-panel">
        <div className="panel-heading"><Code2 size={18}/><h2>Advanced AI Mode</h2><span className="local-badge">LOCAL MVP</span></div>
        <p className="panel-description">AI viết logic chơi mới, chạy thử và tự sửa tối đa 2 lần.</p>
        <form onSubmit={(event) => { event.preventDefault(); void run(); }}>
          <label htmlFor="advanced-prompt" className="field-label">Bạn muốn tạo game gì?</label>
          <textarea id="advanced-prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} maxLength={PROMPT_MAX_LENGTH} disabled={busy}
            placeholder="Tạo game bắn máy bay, có đạn, kẻ địch xuất hiện liên tục, điểm số và boss."/>
          <p className="demo-note">{settings.isDemo ? 'Chọn Gemini hoặc Groq trong Settings để dùng Advanced.' : config.message}</p>
          <button type="submit" className="generate-button" disabled={busy || !allowed || !prompt.trim()}>{busy ? <LoaderCircle size={18} className="spin"/> : <Sparkles size={18}/>}<span>{busy ? 'Agent đang tạo game…' : 'Generate Game'}</span></button>
          {stage === 'Failed' && <button type="button" className="retry-agent" disabled={busy || !allowed || !prompt.trim()} onClick={() => void run()}><RefreshCw size={14}/> Retry</button>}
        </form>
      </section>
      <section className="panel agent-progress" aria-label="Tiến trình AI Agent">
        <h2>AI Code Agent <span>{stage ?? 'Ready'}</span></h2>
        <div className="agent-stages">{stages.map((item) => <span key={item} className={`${visited.includes(item) ? 'visited' : ''} ${stage === item ? 'current' : ''}`}>{item}</span>)}</div>
        <p role="status" aria-live="polite">{message}</p>
        {error && <div role="alert" className="agent-error"><p>{error}</p>{errorCode && <p className="error-code">Mã lỗi: <code>{errorCode}</code></p>}</div>}
        {plan && <div className="agent-plan"><strong>{plan.title}</strong><p>{plan.summary}</p><ul>{plan.mechanics.map((mechanic, i) => <li key={i}>{mechanic}</li>)}</ul><p>Mục tiêu: {plan.objective}</p></div>}
        <details className="agent-logs"><summary>Console / log kiểm tra ({logs.length})</summary><pre>{logs.length ? logs.join('\n\n') : 'Chưa có lỗi kiểm tra.'}</pre></details>
      </section>
    </aside>
    <section className="panel preview-panel" aria-label="Xem và chơi game Advanced">
      <div className="preview-heading"><div className="preview-heading-title"><MonitorPlay size={18}/><h2>Game preview</h2><span className="preview-type">AI CODE</span></div><span className="preview-state">{playing ? 'Đang chạy' : stage ?? 'Sẵn sàng'}</span></div>
      <div className="preview-viewport">{project ? <CodePreview key={project.id} project={project} onStarted={started} onError={runtimeError}/> : <div className="advanced-empty"><Code2 size={36}/><h3>Cơ chế mới bắt đầu từ ý tưởng của bạn.</h3><p>Mô tả game. AI lập kế hoạch, viết code và kiểm tra trước khi mở preview.</p></div>}
        {busy && <div className="preview-loading"><LoaderCircle size={28} className="spin"/><strong>{stage}</strong><span>{message}</span></div>}
      </div>
      <div className="preview-controls"><span>Mũi tên / WASD: di chuyển · Space / chuột: tương tác · R: chơi lại</span></div>
      <div className="preview-footer"><span>{project ? `${project.provider} · ${project.modelId} · ${project.repairs} lần sửa` : 'Phaser 3 · Game code sandbox'}</span><span>960 × 540 · Local only</span></div>
      <p className="advanced-limits">Thử nghiệm local. Kiểm tra tự động xác nhận khởi động và thao tác cơ bản; chưa đánh giá đầy đủ độ khó hoặc mọi cơ chế chơi. Không công khai Advanced lên Internet.</p>
    </section>
  </div>;
}
