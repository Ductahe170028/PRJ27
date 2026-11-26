import { Code2 } from 'lucide-react';
import { useGenerate } from './lib/use-generate';
import { useHealth } from './lib/use-health';
import { AppHeader, ConnectionAlert } from './components/AppHeader';
import { LevelInfoCard } from './components/LevelInfoCard';
import { NoticesList } from './components/NoticesList';
import { PreviewPanel, WorkspaceCaption } from './components/PreviewPanel';
import { PromptForm } from './components/PromptForm';
import { ProviderSettings, useProviderSettings } from './components/ProviderSettings';
import { StatusPanel } from './components/StatusPanel';

/** The app: a prompt becomes a top-down survival shooter. */
export function App() {
  const settings = useProviderSettings();
  const { health, healthError, refresh, confirmOnline } = useHealth();
  const generate = useGenerate(settings, confirmOnline);

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

      {health === 'offline' && <ConnectionAlert message={healthError} onRetry={() => void refresh()}/>}

      <div className="workspace-grid">
        <aside className="creator-column" aria-label="Tạo game">
          <ProviderSettings settings={settings} disabled={generate.busy}/>
          <PromptForm settings={settings} prompt={generate.prompt} onChange={generate.edit} onSubmit={(event) => void generate.submit(event)}
            busy={generate.busy} limitWarning={generate.limitWarning} fieldError={generate.fieldError}/>
          <StatusPanel phase={generate.phase} busy={generate.busy} isDemo={settings.isDemo} error={generate.error} errorCode={generate.errorCode} issues={generate.issues}/>
          {generate.project && generate.info && <LevelInfoCard info={generate.info}/>}
          {generate.project && <NoticesList notices={generate.project.notices}/>}
        </aside>
        <PreviewPanel phase={generate.phase} busy={generate.busy} project={generate.project} source={generate.source} onStarted={generate.onStarted} onError={generate.onRuntimeError}/>
      </div>

      <WorkspaceCaption/>
    </main>
    <footer className="site-footer"><span>AI Game Creator <span className="footer-separator">/</span> Top-down Shooter</span><span>Built for your next idea<span className="footer-spark">✦</span></span></footer>
  </div>;
}
