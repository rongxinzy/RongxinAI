/**
 * Message-tier classification through pi 1.0's classifier models.
 *
 * llama.cpp chat models answer classifications from next-token label
 * probabilities (pi's `llama-cpp-classify` API), so a router-grade question
 * costs one short forward pass instead of a full generation. The classifier
 * runtime is created once per server/model pair and reused; every failure
 * path returns null so callers fall back to the rule-based result.
 */
import type { TriageTier } from '../../../shared/triage';

/** pi modules injected by the caller (ESM dynamic import; test-mockable). */
export interface PiClassifierDeps {
  ModelRuntime: {
    create(options?: { allowModelNetwork?: boolean }): Promise<PiClassifierRuntime>;
  };
  llamaCppClassifyApi: () => unknown;
}

/** Minimal structural type of pi's ModelRuntime for classifier calls. */
export interface PiClassifierRuntime {
  registerProvider(
    providerId: string,
    config: {
      name?: string;
      baseUrl: string;
      classifiers?: Record<string, unknown>;
      models: Array<Record<string, unknown>>;
    },
  ): void;
  setRuntimeApiKey?(providerId: string, apiKey: string): Promise<void>;
  getModel(providerId: string, modelId: string): unknown;
  classify(
    model: unknown,
    context: {
      state: Record<string, unknown>;
      questions: Record<string, unknown>;
    },
    options?: { temperature?: number },
  ): Promise<{
    stopReason: string;
    errorMessage?: string;
    answers?: Record<string, { type: string; choice?: string; confidence?: number }>;
  }>;
}

export interface PiClassifierTriageOptions {
  /** llama.cpp server root, e.g. http://172.18.5.123:8000 (no /v1 suffix). */
  baseUrl: string;
  /** Chat model id served by that server, e.g. Qwen3.6-35B-A3B. */
  modelName: string;
  /** Answers below this confidence fall back to the rule result. */
  minConfidence?: number;
}

const PROVIDER_ID = 'zhiyuan-triage';
const DEFAULT_MIN_CONFIDENCE = 0.55;

const TRIAGE_QUESTION = {
  type: 'choice',
  instructions:
    'Classify the user message by the amount of model work it needs. Answer with exactly one label.',
  criteria: {
    light: 'greeting, thanks, goodbye, small talk, simple factual question, short translation',
    standard: 'normal conversation, general question, moderate instruction',
    heavy: 'complex coding task, architecture design, debugging, long analysis, refactoring',
  },
} as const;

const runtimeCache = new Map<string, { runtime: PiClassifierRuntime; model: unknown }>();

let triageDeps: PiClassifierDeps | null = null;

/** Wire the pi modules once at app startup (dynamic import); null disables. */
export function setTriageClassifierDeps(deps: PiClassifierDeps | null): void {
  triageDeps = deps;
  runtimeCache.clear();
}

const serverRoot = (baseUrl: string): string => baseUrl.replace(/\/v1\/?$/, '').replace(/\/+$/, '');

async function getClassifier(deps: PiClassifierDeps, options: PiClassifierTriageOptions) {
  const root = serverRoot(options.baseUrl);
  const cacheKey = `${root}|${options.modelName}`;
  const cached = runtimeCache.get(cacheKey);
  if (cached) return cached;

  const runtime = await deps.ModelRuntime.create({ allowModelNetwork: false });
  runtime.registerProvider(PROVIDER_ID, {
    name: PROVIDER_ID,
    baseUrl: root,
    classifiers: { 'llama-cpp-classify': deps.llamaCppClassifyApi() },
    models: [
      {
        type: 'classifier',
        id: options.modelName,
        name: options.modelName,
        api: 'llama-cpp-classify',
        provider: PROVIDER_ID,
        baseUrl: `${root}/v1`,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 8_192,
      },
    ],
  });
  const model = runtime.getModel(PROVIDER_ID, options.modelName);
  if (!model) {
    throw new Error(`classifier model ${options.modelName} did not register`);
  }
  const entry = { runtime, model };
  runtimeCache.set(cacheKey, entry);
  return entry;
}

/** Classify a message into a triage tier; null means "use the rule result". */
export async function classifyTierWithPi(
  prompt: string,
  options: PiClassifierTriageOptions,
  deps: PiClassifierDeps,
): Promise<{ tier: TriageTier; confidence: number } | null> {
  if (!options.baseUrl || !options.modelName) return null;
  try {
    const { runtime, model } = await getClassifier(deps, options);
    const result = await runtime.classify(
      model,
      {
        state: { message: prompt.replace(/\n/g, ' ').trim().slice(0, 400) },
        questions: { tier: TRIAGE_QUESTION },
      },
      { temperature: 1 },
    );
    if (result.stopReason !== 'stop' || result.errorMessage) return null;
    const answer = result.answers?.tier;
    const choice = answer?.choice;
    const confidence = answer?.confidence ?? 0;
    if (choice !== 'light' && choice !== 'standard' && choice !== 'heavy') return null;
    if (confidence < (options.minConfidence ?? DEFAULT_MIN_CONFIDENCE)) return null;
    return { tier: choice, confidence };
  } catch {
    return null;
  }
}

/** Thin wrapper for modelTriage: null when deps are absent or classification failed. */
export async function classifyTierForTriage(
  prompt: string,
  baseUrl: string,
  modelName: string,
): Promise<{ tier: TriageTier; confidence: number } | null> {
  if (!triageDeps) return null;
  return classifyTierWithPi(prompt, { baseUrl, modelName }, triageDeps);
}

/** Test hook: drop cached classifier runtimes. */
export function resetPiClassifierCache(): void {
  runtimeCache.clear();
}
