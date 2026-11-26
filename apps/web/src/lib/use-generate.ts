import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { ShooterProject } from '@game-creator/contracts';
import { describeError, generateShooter, type ApiIssue } from './api';
import { promptLimitWarning, promptToSend } from './prompt-draft';
import { levelInfo } from './shooter-text';
import type { ProviderSettingsState } from '../components/ProviderSettings';

export type Phase = 'idle' | 'generating' | 'booting' | 'playing' | 'error';

/** The prompt, the call to the API, and what came back: a project to play, or an error to show. `onReached` is told when the
 * backend answered, whatever the answer was worth. */
export function useGenerate(settings: ProviderSettingsState, onReached: () => void) {
  const [prompt, setPrompt] = useState('');
  const [project, setProject] = useState<ShooterProject | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState('');
  const [errorCode, setErrorCode] = useState('');
  const [issues, setIssues] = useState<ApiIssue[]>([]);
  const [fieldError, setFieldError] = useState('');
  const request = useRef<AbortController | null>(null);
  const busy = phase === 'generating' || phase === 'booting';
  // Stable between renders: a new object here would be a new preview source on every render.
  const source = useMemo(() => (project ? { id: project.id, title: project.title, game: project.level } : null), [project]);
  // The card is read from the level itself, so it can never disagree with the game that is played.
  const info = useMemo(() => (project ? levelInfo(project.level) : null), [project]);

  useEffect(() => () => request.current?.abort(), []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !settings.available || settings.testing) return;
    const outgoing = promptToSend(prompt);
    if (outgoing === null) {
      setFieldError(promptLimitWarning(prompt) || 'Hãy nhập mô tả game.');
      return;
    }
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setFieldError(''); setError(''); setErrorCode(''); setIssues([]); setProject(null);
    setPhase('generating');
    try {
      const result = await generateShooter(outgoing, settings.selection, controller.signal);
      if (controller.signal.aborted) return;
      onReached();
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
  const edit = (text: string) => { setPrompt(text); setFieldError(''); };

  return {
    prompt, edit, submit, phase, busy, project, source, info, error, errorCode, issues, fieldError,
    limitWarning: promptLimitWarning(prompt), onStarted, onRuntimeError,
  };
}
