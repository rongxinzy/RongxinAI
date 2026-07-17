import { LOCAL_INFERENCE_SESSION_STORAGE_KEY } from '../constants';
import type { LocalInferenceSessionState, LocalInferenceTab } from '../types';

export function readLocalInferenceSessionState(): LocalInferenceSessionState | null {
  try {
    const raw = localStorage.getItem(LOCAL_INFERENCE_SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LocalInferenceSessionState> | null;
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      activeTab: isLocalInferenceTab(parsed.activeTab) ? parsed.activeTab : 'models',
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
  return value === 'models' || value === 'marketplace';
}
