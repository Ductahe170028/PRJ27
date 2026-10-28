import { useCallback, useEffect, useRef, useState } from 'react';
import { Settings2, LoaderCircle } from 'lucide-react';
import { SelectionPreferenceSchema, type ProviderInfo, type ProviderSelection } from '@game-creator/contracts';
import { getProviders, testConnection } from '../lib/api';

const STORAGE_KEY = 'game-creator.provider.v1';
const DEMO: ProviderSelection = { providerId: 'demo', modelId: 'platformer-v1' };
const reasonCopy: Record<NonNullable<ProviderInfo['reason']>, string> = {
  missing_key: 'Chưa có API key. Bổ sung trong apps/api/.env rồi khởi động lại backend.',
  models_unconfigured: 'Chưa cấu hình ALLOWED_MODELS trong .env của backend.',
  free_tier_unconfirmed: 'Chưa xác nhận model dùng được trong free tier của tài khoản ở .env.',
  invalid_model: 'Allowlist chứa model không được hỗ trợ. Kiểm tra cấu hình backend.',
};

function loadSelection(): ProviderSelection {
  try {
    const parsed = SelectionPreferenceSchema.safeParse(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null'));
    return parsed.success ? parsed.data : DEMO;
  } catch { return DEMO; }
}

export function useProviderSettings() {
  const [selection, setSelection] = useState(loadSelection);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [testMessage, setTestMessage] = useState('');
  const [testError, setTestError] = useState(false);
  const [testing, setTesting] = useState(false);
  const loadRequest = useRef<AbortController | null>(null);
  const testRequest = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    loadRequest.current?.abort();
    const controller = new AbortController();
    loadRequest.current = controller;
    setLoading(true);
    setLoadError('');
    try {
      const data = await getProviders(controller.signal);
      if (!controller.signal.aborted) setProviders(data);
    } catch (error) {
      if (!controller.signal.aborted) setLoadError(error instanceof Error ? error.message : 'Không tải được cấu hình.');
    } finally { if (!controller.signal.aborted) setLoading(false); }
  }, []);

  useEffect(() => {
    void refresh();
    return () => { loadRequest.current?.abort(); testRequest.current?.abort(); };
  }, [refresh]);

  function select(next: ProviderSelection) {
    testRequest.current?.abort();
    setTesting(false);
    setTestMessage('');
    setSelection(next);
    // Only these two IDs are persisted. No API keys or generated content.
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* Storage may be disabled. */ }
  }

  async function test() {
    testRequest.current?.abort();
    const controller = new AbortController();
    testRequest.current = controller;
    setTesting(true);
    setTestMessage('');
    try {
      const result = await testConnection(selection, controller.signal);
      if (!controller.signal.aborted) { setTestMessage(result.message); setTestError(false); }
    } catch (error) {
      if (!controller.signal.aborted) {
        setTestMessage(error instanceof Error ? error.message : 'Không kiểm tra được kết nối.');
        setTestError(true);
      }
    } finally { if (!controller.signal.aborted) setTesting(false); }
  }

  const provider = providers.find((item) => item.id === selection.providerId);
  const model = provider?.models.find((item) => item.id === selection.modelId);
  const isDemo = selection.providerId === 'demo' && selection.modelId === 'platformer-v1';
  const available = isDemo || Boolean(!loading && !loadError && provider?.available && model);
  const message = isDemo ? 'Demo cục bộ · Không gọi AI'
    : loading ? 'Đang đọc cấu hình backend…' : loadError || (!provider ? 'Provider đã lưu không còn được hỗ trợ.'
      : provider.reason ? reasonCopy[provider.reason] : !model ? 'Hãy chọn model trong allowlist hiện tại.' : 'Đã cấu hình · Chưa kiểm tra kết nối');
  return { selection, providers, provider, model, available, isDemo, message, loading, loadError, testing, testMessage, testError, select, refresh, test };
}

export function ProviderSettings({ settings, disabled }: { settings: ReturnType<typeof useProviderSettings>; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const { selection, provider, model, providers, isDemo } = settings;
  return <section className="panel settings-panel" aria-label="AI Settings">
    <button className="settings-toggle" type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-controls="provider-settings">
      <Settings2 size={17}/><span>Settings</span><span className="settings-current">{isDemo ? 'Demo' : provider?.name ?? selection.providerId}</span>
    </button>
    <p className="settings-summary">{isDemo ? 'Moonlight Run' : model?.id ?? 'Chưa chọn model'}<span className={settings.available ? 'available' : 'unavailable'}>{settings.available ? 'Sẵn sàng' : 'Unavailable'}</span></p>
    {open && <div id="provider-settings" className="settings-content">
      <label className="field-label" htmlFor="provider">AI Provider</label>
      <select id="provider" value={selection.providerId} disabled={disabled || settings.loading} onChange={(event) => {
        const id = event.target.value;
        settings.select(id === 'demo' ? DEMO : { providerId: id, modelId: providers.find((item) => item.id === id)?.models[0]?.id ?? '' });
      }}>
        <option value="demo">Demo — không gọi AI</option>
        {providers.map((item) => <option key={item.id} value={item.id}>{item.name}{item.available ? '' : ' — unavailable'}</option>)}
        {!isDemo && !provider && <option value={selection.providerId}>{selection.providerId} — unavailable</option>}
      </select>
      <label className="field-label" htmlFor="model">Model</label>
      <select id="model" value={selection.modelId} disabled={disabled || isDemo || !provider?.models.length} onChange={(event) => settings.select({ ...selection, modelId: event.target.value })}>
        {isDemo ? <option value="platformer-v1">Moonlight Run (demo)</option> : <>
          {!model && <option value={selection.modelId}>{selection.modelId || 'Chưa có model trong allowlist'}</option>}
          {provider?.models.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.id})</option>)}
        </>}
      </select>
      <p className="settings-info">{settings.message}</p>
      {!isDemo && model && <p className="settings-info">Output: {model.capabilities.outputMode === 'json_schema' ? 'Structured JSON' : 'JSON mode + validation'} · Platformer / Top-down</p>}
      <div className="settings-actions">
        <button type="button" onClick={() => void settings.test()} disabled={disabled || settings.testing || !settings.available || isDemo}>
          {settings.testing && <LoaderCircle size={13} className="spin"/>}{settings.testing ? 'Đang kiểm tra…' : 'Test connection'}
        </button>
        <button type="button" onClick={() => void settings.refresh()} disabled={disabled || settings.loading || settings.testing}>Tải lại cấu hình</button>
      </div>
      <p className="settings-info">Test connection chỉ kiểm tra quyền truy cập model, không sinh game. Tạo game sử dụng quota của provider bạn chọn.</p>
      {settings.testMessage && <p className={settings.testError ? 'field-error' : 'settings-success'} role={settings.testError ? 'alert' : 'status'}>{settings.testMessage}</p>}
    </div>}
  </section>;
}
