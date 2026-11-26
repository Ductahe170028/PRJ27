import { CircleAlert, Gamepad2, Layers2, RefreshCw } from 'lucide-react';

export type Health = 'checking' | 'online' | 'offline';

/** The top bar. */
export function AppHeader({ health, badge, home = '/' }: { health: Health; badge: string; home?: string }) {
  return <header className="topbar">
    <a className="brand" href={home} aria-label="AI Game Creator — trang chủ">
      <span className="brand-icon"><Gamepad2 size={23} strokeWidth={1.8}/></span>
      <span>Game<span className="brand-light">Creator</span><span className="brand-ai">AI</span></span>
    </a>
    <div className="workspace-label"><span className="topbar-divider"/><Layers2 size={15}/> Creator workspace</div>
    <div className="topbar-right">
      <span className={`connection connection-${health}`} role="status">
        <span className="small-dot"/>
        {health === 'online' ? 'Backend đã kết nối' : health === 'checking' ? 'Đang kết nối backend' : 'Backend chưa kết nối'}
      </span>
      <span className="phase-badge">{badge}</span>
    </div>
  </header>;
}

/** Shown when the backend cannot be reached, with a button to try again. */
export function ConnectionAlert({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div className="connection-alert" role="alert">
    <CircleAlert size={17}/><span>{message}</span>
    <button type="button" onClick={onRetry}><RefreshCw size={13}/> Kiểm tra lại</button>
  </div>;
}
