export type InferenceOptions = {
  temperature: number;
  top_p: number;
  top_k: number;
  num_predict: number;
  repeat_penalty: number;
  seed: number;
  stop: string;
  min_p: number;
  presence_penalty: number;
  thinking_budget_tokens: number;
};

export const DEFAULT_INFERENCE_OPTIONS: InferenceOptions = {
  temperature: 0.7,
  top_p: 0.9,
  top_k: 40,
  num_predict: 1024,
  repeat_penalty: 1.1,
  seed: -1,
  stop: '',
  min_p: 0.05,
  presence_penalty: 0,
  thinking_budget_tokens: -1,
};

const QWEN35_08B_INFERENCE_OPTIONS: InferenceOptions = {
  temperature: 0.3,
  top_p: 0.8,
  top_k: 20,
  num_predict: 1024,
  repeat_penalty: 1.05,
  seed: -1,
  stop: '',
  min_p: 0.05,
  presence_penalty: 0.6,
  thinking_budget_tokens: 1024,
};

export function loadInferenceOptions(): InferenceOptions {
  try {
    const raw = localStorage.getItem('lobsterai:llamacpp-inference-options');
    if (!raw) return DEFAULT_INFERENCE_OPTIONS;
    return { ...DEFAULT_INFERENCE_OPTIONS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_INFERENCE_OPTIONS;
  }
}

export function normalizeOptions(options: InferenceOptions): Record<string, unknown> {
  const stop = options.stop
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  return {
    temperature: options.temperature,
    top_p: options.top_p,
    top_k: options.top_k,
    num_predict: options.num_predict,
    repeat_penalty: options.repeat_penalty,
    min_p: options.min_p,
    presence_penalty: options.presence_penalty,
    ...(options.seed >= 0 ? { seed: options.seed } : {}),
    ...(stop.length > 0 ? { stop } : {}),
    ...(options.thinking_budget_tokens >= 0 ? { thinking_budget_tokens: options.thinking_budget_tokens } : {}),
  };
}

export function areInferenceOptionsEqual(left: InferenceOptions, right: InferenceOptions): boolean {
  return left.temperature === right.temperature
    && left.top_p === right.top_p
    && left.top_k === right.top_k
    && left.num_predict === right.num_predict
    && left.repeat_penalty === right.repeat_penalty
    && left.seed === right.seed
    && left.stop === right.stop
    && left.min_p === right.min_p
    && left.presence_penalty === right.presence_penalty
    && left.thinking_budget_tokens === right.thinking_budget_tokens;
}

export function isDefaultInferenceOptions(options: InferenceOptions): boolean {
  return areInferenceOptionsEqual(options, DEFAULT_INFERENCE_OPTIONS);
}

export function isQwen35_08BModel(modelName: string): boolean {
  const normalized = modelName.toLowerCase();
  return normalized.includes('qwen3.5-0.8b') || normalized.includes('qwen3-0.8b');
}

export function getRecommendedInferenceOptions(modelName: string): InferenceOptions {
  return isQwen35_08BModel(modelName)
    ? QWEN35_08B_INFERENCE_OPTIONS
    : DEFAULT_INFERENCE_OPTIONS;
}

export function shouldApplyModelPreset(options: InferenceOptions): boolean {
  return isDefaultInferenceOptions(options) || areInferenceOptionsEqual(options, QWEN35_08B_INFERENCE_OPTIONS);
}
