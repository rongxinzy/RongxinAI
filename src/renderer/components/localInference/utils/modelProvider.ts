import type { LlamaCppModel } from '../../../../shared/llamacpp';
import { ProviderName, type ProviderName as ProviderNameType } from '../../../../shared/providers';

export type LocalModelProvider = Extract<
  ProviderNameType,
  | typeof ProviderName.Anthropic
  | typeof ProviderName.DeepSeek
  | typeof ProviderName.Gemini
  | typeof ProviderName.Minimax
  | typeof ProviderName.Moonshot
  | typeof ProviderName.OpenAI
  | typeof ProviderName.Qianfan
  | typeof ProviderName.Qwen
  | typeof ProviderName.StepFun
  | typeof ProviderName.Volcengine
  | typeof ProviderName.Xiaomi
  | typeof ProviderName.Zhipu
>;

type ModelProviderMatcher = {
  provider: LocalModelProvider;
  pattern: RegExp;
};

const MODEL_PROVIDER_MATCHERS: readonly ModelProviderMatcher[] = [
  { provider: ProviderName.DeepSeek, pattern: /deepseek/i },
  { provider: ProviderName.Qwen, pattern: /(?:qwen|qwq)/i },
  { provider: ProviderName.Zhipu, pattern: /(?:chat)?glm|zhipu/i },
  { provider: ProviderName.Gemini, pattern: /(?:gemini|gemma|paligemma)/i },
  { provider: ProviderName.Anthropic, pattern: /claude/i },
  { provider: ProviderName.OpenAI, pattern: /(?:openai|chatgpt|gpt|codex)/i },
  { provider: ProviderName.Moonshot, pattern: /(?:moonshot|kimi)/i },
  { provider: ProviderName.Minimax, pattern: /minimax/i },
  { provider: ProviderName.Qianfan, pattern: /(?:ernie|baidu)/i },
  { provider: ProviderName.Volcengine, pattern: /(?:doubao|volcengine)/i },
  { provider: ProviderName.StepFun, pattern: /stepfun/i },
  { provider: ProviderName.Xiaomi, pattern: /(?:xiaomi|mimo)/i },
];

export function resolveLocalModelProvider(model: LlamaCppModel): LocalModelProvider | null {
  for (const candidate of getModelProviderCandidates(model)) {
    const match = MODEL_PROVIDER_MATCHERS.find(({ pattern }) => pattern.test(candidate));
    if (match) return match.provider;
  }
  return null;
}

function getModelProviderCandidates(model: LlamaCppModel): string[] {
  return [model.details?.family, model.name, model.model, model.id, getFileName(model.path)].filter(
    (value): value is string => Boolean(value?.trim()),
  );
}

function getFileName(path?: string): string | undefined {
  if (!path) return undefined;
  return path.split(/[\\/]/).at(-1);
}
