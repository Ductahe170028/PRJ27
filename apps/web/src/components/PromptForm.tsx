import type { FormEvent } from 'react';
import { ArrowUpRight, LoaderCircle, Sparkles, Terminal } from 'lucide-react';
import { PROMPT_MAX_LENGTH } from '@game-creator/contracts';
import type { ProviderSettingsState } from './ProviderSettings';

interface PromptFormProps {
  settings: ProviderSettingsState;
  prompt: string;
  onChange: (text: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  busy: boolean;
  /** Over the length limit (shown live) and rejected on submit (an empty prompt). */
  limitWarning: string;
  fieldError: string;
}

/** "01 · Mô tả game của bạn": the prompt box, the Generate button and the line about who answers. */
export function PromptForm({ settings, prompt, onChange, onSubmit, busy, limitWarning, fieldError }: PromptFormProps) {
  return <section className="panel prompt-panel">
    <div className="panel-heading"><span className="section-number">01</span><h2>Mô tả game của bạn</h2><Sparkles size={16} className="muted-icon"/></div>
    <p className="panel-description">Một trận sinh tồn bắt đầu từ một ý tưởng.</p>
    <form onSubmit={onSubmit}>
      <label htmlFor="prompt" className="field-label">Bạn muốn tạo game gì?</label>
      <div className={`prompt-input-wrap ${limitWarning || fieldError ? 'has-error' : ''}`}>
        <textarea
          id="prompt"
          name="prompt"
          value={prompt}
          onChange={(event) => onChange(event.target.value)}
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
  </section>;
}
