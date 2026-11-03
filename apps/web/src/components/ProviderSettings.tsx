import { useCallback, useEffect, useRef, useState } from 'react';
import { Settings2, LoaderCircle } from 'lucide-react';
import { AUTO_MODEL_ID, SelectionPreferenceSchema, type ProviderInfo, type ProviderSelection } from '@game-creator/contracts';
import { describeError, getProviders, testConnection } from '../lib/api';

const STORAGE_KEY = 'game-creator.provider.v1';
const DEMO: ProviderSelection = { providerId: 'demo', modelId: 'platformer-v1' };

function reasonCopy(provider: ProviderInfo) {
  const prefix = provider.id.toUpperCase();
  switch (provider.reason) {
    case 'missing_key': return `Chưa có API key. Thêm ${prefix}_API_KEY vào apps/api/.env rồi khởi động lại backend.`;
    case 'models_unconfigured': return `Allowlist model đang trống. Kiểm tra ${prefix}_ALLOWED_MODELS ở backend.`;
    case 'invalid_model': return `${prefix}_ALLOWED_MODELS chứa model không được hỗ trợ. Kiểm tra apps/api/.env.`;
    default: return '';
  }
}

function loadSelection(): ProviderSelection {
  try {
    const parsed = SelectionPreferenceSchema.safeParse(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null'));
    if (!parsed.success) return DEMO;
    // Older versions stored '' when no model was chosen yet.
    return parsed.data.modelId === '' ? { ...parsed.data, modelId: AUTO_MODEL_ID } : parsed.data;
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

  // Reads backend configuration only; never calls an AI provider.
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
        setTestMessage(describeError(error, 'Không kiểm tra được kết nối.').message);
        setTestError(true);
      }
    } finally { if (!controller.signal.aborted) setTesting(false); }
  }

  const provider = providers.find((item) => item.id === selection.providerId);
  const automatic = selection.modelId === AUTO_MODEL_ID;
  const model = provider?.models.find((item) => item.id === (automatic ? provider.defaultModelId : selection.modelId));
  const isDemo = selection.providerId === 'demo' && selection.modelId === 'platformer-v1';
  const available = isDemo || Boolean(!loading && !loadError && provider?.available && model);
  const message = isDemo ? 'Demo cục bộ · Không gọi AI'
    : loading ? 'Đang đọc cấu hình backend…' : loadError || (!provider ? 'Provider đã lưu không còn được hỗ trợ.'
      : provider.reason ? reasonCopy(provider)
      : !model ? `Model đã lưu (${selection.modelId || 'trống'}) không còn trong allowlist. Hãy chọn model khác.`
      : 'Đã cấu hình · Chưa kiểm tra kết nối');
  return { selection, providers, provider, model, automatic, available, isDemo, message, loading, loadError, testing, testMessage, testError, select, refresh, test };
}

export function ProviderSettings({ settings, disabled, advanced = false }: { settings: ReturnType<typeof useProviderSettings>; disabled: boolean; advanced?: boolean }) {
  const [open, setOpen] = useState(false);
  const { selection, provider, model, providers, isDemo } = settings;
  const defaultModel = provider?.models.find((item) => item.id === provider.defaultModelId);
  return <section className="panel settings-panel" aria-label="AI Settings">
    <button className="settings-toggle" type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-controls="provider-settings">
      <Settings2 size={17}/><span>Settings</span><span className="settings-current">{isDemo ? 'Demo' : provider?.name ?? selection.providerId}</span>
    </button>
    <p className="settings-summary">{isDemo ? 'Moonlight Run' : model ? `${model.id}${settings.automatic ? ' · tự động' : ''}` : 'Chưa chọn model'}<span className={settings.available ? 'available' : 'unavailable'}>{settings.available ? 'Sẵn sàng' : 'Unavailable'}</span></p>
    {open && <div id="provider-settings" className="settings-content">
      <label className="field-label" htmlFor="provider">AI Provider</label>
      <select id="provider" value={selection.providerId} disabled={disabled || settings.loading} onChange={(event) => {
        const id = event.target.value;
        settings.select(id === 'demo' ? DEMO : { providerId: id, modelId: AUTO_MODEL_ID });
      }}>
        <option value="demo">Demo — không gọi AI</option>
        {providers.map((item) => <option key={item.id} value={item.id}>{item.name}{item.available ? '' : ' — unavailable'}</option>)}
        {!isDemo && !provider && <option value={selection.providerId}>{selection.providerId} — unavailable</option>}
      </select>
      <label className="field-label" htmlFor="model">Model</label>
      <select id="model" value={selection.modelId} disabled={disabled || isDemo || !provider?.models.length} onChange={(event) => settings.select({ ...selection, modelId: event.target.value })}>
        {isDemo ? <option value="platformer-v1">Moonlight Run (demo)</option> : <>
          <option value={AUTO_MODEL_ID}>{defaultModel ? `Tự động — ${defaultModel.name} (khuyến nghị)` : 'Tự động'}</option>
          {!settings.automatic && !model && <option value={selection.modelId}>{selection.modelId || 'Chưa chọn'} — không còn hỗ trợ</option>}
          {provider?.models.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.id})</option>)}
        </>}
      </select>
      <p className={settings.available ? 'settings-info' : 'settings-info settings-warning'}>{settings.message}</p>
      {!isDemo && model && <p className="settings-info">{advanced ? 'AI viết cơ chế chơi · Kiểm tra và sửa lỗi tự động' : `${model.capabilities.outputMode === 'json_schema' ? 'Structured output (JSON schema)' : 'JSON mode + kiểm tra Zod'} · Platformer / Top-down`}</p>}
      <div className="settings-actions">
        <button type="button" onClick={() => void settings.test()} disabled={disabled || settings.testing || !settings.available || isDemo}>
          {settings.testing && <LoaderCircle size={13} className="spin"/>}{settings.testing ? 'Đang kiểm tra…' : 'Test connection'}
        </button>
        <button type="button" onClick={() => void settings.refresh()} disabled={disabled || settings.loading || settings.testing}>Tải lại cấu hình</button>
      </div>
      {settings.testMessage && <p className={settings.testError ? 'field-error' : 'settings-success'} role={settings.testError ? 'alert' : 'status'}>{settings.testMessage}</p>}
      {providers.length > 0 && <ul className="provider-status" aria-label="Tình trạng cấu hình provider">
        {providers.map((item) => <li key={item.id}>
          <span>{item.name}</span>
          <span className={item.available ? 'available' : 'unavailable'}>{item.available ? `Đã cấu hình · ${item.models.length} model` : reasonCopy(item)}</span>
        </li>)}
      </ul>}
      <p className="settings-info">Test connection chỉ kiểm tra API key và quyền dùng model, không sinh game. Danh sách chỉ gồm model có free tier; nếu tài khoản provider đã bật billing, provider có thể tính phí theo bảng giá của họ.</p>
    </div>}
  </section>;
}
