/** Model triage routing: classifies prompts and switches the session model. */
import {
  chooseTriageModelSwitch,
  classifyMessage,
  createTriageState,
} from '../libs/agentEngine/modelTriage';
import { DEFAULT_TRIAGE_CONFIG, type TriageConfig, type TriageState } from '../../shared/triage';
import { getCoworkStore, getLlamaCppManager, getStore } from './runtimeServices';
import { getPiRuntimeAdapter } from './sessionServices';

export const resolveDefaultAgentModelRef = (): string => {
  return getStore().get<string>('magpie_default_model_id')?.trim() || '';
};

const triageStatesBySession = new Map<string, TriageState>();

/** Read the triage config from the sqlite kv store (same key as the IPC handlers). */
const readTriageConfig = (): TriageConfig => {
  try {
    const stored = getStore().get<TriageConfig>('model_triage_config');
    if (stored && typeof stored === 'object' && typeof stored.enabled === 'boolean') {
      return stored;
    }
  } catch {
    // fall through to defaults
  }
  return DEFAULT_TRIAGE_CONFIG;
};

/** classifier URL: explicit config first, then the local inference service endpoint. */
const resolveTriageClassifierBaseUrl = (config: TriageConfig): string => {
  if (config.rules.classifierBaseUrl) return config.rules.classifierBaseUrl;
  return getLlamaCppManager().getBaseUrl();
};

/**
 * Classify the incoming prompt and switch the session model when the triage
 * decision says so. Runs before the prompt is sent; failures never block the
 * turn — the rule result and hysteresis keep routing conservative.
 */
export const applyMessageTriageRouting = async (
  sessionId: string,
  prompt: string,
): Promise<void> => {
  const config = readTriageConfig();
  if (!config.enabled || !prompt.trim()) return;

  // The triage decision needs the message count and the session's model
  // override, not the transcript: one metadata read includes the count and
  // avoids materializing every message of a long session on each prompt.
  const store = getCoworkStore();
  const session = store.getSession(sessionId, 0, { includeArtifacts: false });
  const messageCount = session?.totalMessages ?? 0;
  const classifierBaseUrl = resolveTriageClassifierBaseUrl(config);
  const effectiveConfig: TriageConfig = {
    ...config,
    rules: { ...config.rules, classifierBaseUrl },
  };
  const result = await classifyMessage(prompt, messageCount, effectiveConfig);
  const state = triageStatesBySession.get(sessionId) ?? createTriageState();
  const sessionOverride = session?.modelOverride?.trim() || '';
  const currentModelRef = sessionOverride || resolveDefaultAgentModelRef();
  const decision = chooseTriageModelSwitch(
    currentModelRef,
    result,
    state,
    config,
    Math.max(1, messageCount),
  );
  triageStatesBySession.set(sessionId, decision.state);
  if (decision.modelRef) {
    await getPiRuntimeAdapter().patchSession(sessionId, { model: decision.modelRef });
    console.log(`[Triage] session ${sessionId} routed to ${decision.modelRef} (${result.reason})`);
  }
};
