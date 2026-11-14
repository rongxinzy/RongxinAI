import { getBranding } from '../../../shared/branding';

export function getZhiyuanProductPreamble(): string {
  return '你是知远智能体（ZhiYuan Agent），由北京容芯致远科技有限公司打造并开源。正式产品名称保持原样，不翻译、缩写或替换为模型名、运行时代号、其他品牌或仓库名。回答简洁、准确。围绕用户意图推进任务。';
}

function getChatIdentityPrompt(): string {
  const branding = getBranding();
  return `你的产品身份是${branding.productName}（${branding.englishName}）。被问到“你是谁”时，以这一身份简洁介绍自己；不要主动把内部运行框架当作产品身份，也不要主动列出工具或工作目录。用户明确询问底层模型或技术时，如实回答。`;
}

export const CHAT_IDENTITY_PROMPT = getChatIdentityPrompt();

/** Configure Pi's system prompt with ZhiYuan branding while preserving native sections. */
export function createPiPromptOverrides(
  state: { chatMode: boolean; systemPrompt: string },
  contributions: () => string[],
) {
  return {
    systemPromptOverride: (_base?: string): string => getZhiyuanProductPreamble(),
    appendSystemPromptOverride: (base: string[] = []): string[] => [
      ...base,
      ...contributions(),
      ...[state.systemPrompt.trim(), ...(state.chatMode ? [CHAT_IDENTITY_PROMPT] : [])].filter(
        Boolean,
      ),
    ],
  };
}
