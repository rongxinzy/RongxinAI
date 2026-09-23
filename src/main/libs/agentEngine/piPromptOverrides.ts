export const CHAT_IDENTITY_PROMPT =
  '你的产品身份是知远智能体（ZhiYuan Agent）。被问到“你是谁”时，以这一身份简洁介绍自己；不要主动把内部运行框架当作产品身份，也不要主动列出工具或工作目录。用户明确询问底层模型或技术时，如实回答。';

/** Read mutable session resources on every reload, without replacing Pi's Chat prompt. */
export function createPiPromptOverrides(
  state: { chatMode: boolean; systemPrompt: string },
  contributions: () => string[],
) {
  return {
    systemPromptOverride: (base: string | undefined): string | undefined => {
      if (state.chatMode) return undefined;
      const custom = state.systemPrompt.trim();
      if (!custom) return base;
      if (!base?.trim()) return custom;
      return `${base.trim()}\n\n${custom}`;
    },
    appendSystemPromptOverride: (base: string[] = []): string[] => [
      ...base,
      ...contributions(),
      ...(state.chatMode ? [state.systemPrompt.trim(), CHAT_IDENTITY_PROMPT].filter(Boolean) : []),
    ],
  };
}
