import { LOCAL_INFERENCE_SESSION_STORAGE_KEY } from '../constants';
import type {
  InferenceMessage,
  LocalInferenceSessionState,
  LocalInferenceTab,
} from '../types';

export function readLocalInferenceSessionState(): LocalInferenceSessionState | null {
  try {
    const raw = localStorage.getItem(LOCAL_INFERENCE_SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LocalInferenceSessionState> | null;
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      activeTab: isLocalInferenceTab(parsed.activeTab) ? parsed.activeTab : 'inference',
      selectedModel: typeof parsed.selectedModel === 'string' ? parsed.selectedModel : '',
      systemPrompt: typeof parsed.systemPrompt === 'string' ? parsed.systemPrompt : '',
      prompt: typeof parsed.prompt === 'string' ? parsed.prompt : '',
      messages: Array.isArray(parsed.messages) ? parsed.messages.filter(isInferenceMessage) : [],
    };
  } catch {
    return null;
  }
}

export function writeLocalInferenceSessionState(state: LocalInferenceSessionState): void {
  try {
    localStorage.setItem(LOCAL_INFERENCE_SESSION_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage failures and keep the live session usable.
  }
}

export function isLocalInferenceTab(value: unknown): value is LocalInferenceTab {
  return value === 'inference' || value === 'models' || value === 'marketplace';
}

export function isInferenceMessage(value: unknown): value is InferenceMessage {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<InferenceMessage>;
  return (
    (candidate.role === 'user' || candidate.role === 'assistant') &&
    typeof candidate.content === 'string' &&
    typeof candidate.createdAt === 'number'
  );
}

