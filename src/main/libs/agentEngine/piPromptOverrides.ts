import { getBranding } from '../../../shared/branding';

function getChatIdentityPrompt(): string {
  const branding = getBranding();
  return `你的产品身份是${branding.productName}（${branding.englishName}）。被问到“你是谁”时，以这一身份简洁介绍自己；不要主动把内部运行框架当作产品身份，也不要主动列出工具或工作目录。用户明确询问底层模型或技术时，如实回答。`;
}

export const CHAT_IDENTITY_PROMPT = getChatIdentityPrompt();

/** Preserve Pi's native tool descriptions and guidelines in every session. */
export function createPiPromptOverrides(
  state: { chatMode: boolean; systemPrompt: string },
  contributions: () => string[],
) {
  return {
    systemPromptOverride: (_base: string | undefined): undefined => undefined,
    appendSystemPromptOverride: (base: string[] = []): string[] => [
      ...base,
      ...contributions(),
      ...[state.systemPrompt.trim(), ...(state.chatMode ? [CHAT_IDENTITY_PROMPT] : [])].filter(
        Boolean,
      ),
    ],
  };
}
