export const TOKENS_PER_K = 1024;

export const formatTokenK = (tokens?: number): string => {
  if (!tokens || !Number.isFinite(tokens) || tokens <= 0) return '';
  return String(Number((tokens / TOKENS_PER_K).toFixed(2)));
};

/** 探测到的 token 上限：到达 1K 以上用 K 表示，否则原样显示。 */
export const formatDetectedTokenLimit = (tokens: number): string =>
  tokens >= TOKENS_PER_K ? `${formatTokenK(tokens)}K` : String(tokens);
