/**
 * Chat execution routing.
 *
 * Chat-mode sessions normally stream directly from the configured LLM
 * (ChatChatTransport). When a skill is attached — either on the outgoing
 * submission or persisted on the existing chat session — the session must
 * execute via the agent runtime instead, while staying tagged as a chat
 * session so it remains in the Chat sidebar list.
 */

export const ChatExecution = {
  Direct: 'direct',
  Agent: 'agent',
} as const;

export type ChatExecution = (typeof ChatExecution)[keyof typeof ChatExecution];

export interface ChatExecutionContext {
  /** Skill ids attached to the outgoing submission. */
  activeSkillIds: string[];
  /** Existing chat session being continued, if any. */
  session?: { activeSkillIds?: string[] } | null;
}

/**
 * Returns 'agent' when the submission carries skills or the existing chat
 * session has persisted skill ids; otherwise 'direct'.
 */
export const resolveChatExecution = ({
  activeSkillIds,
  session,
}: ChatExecutionContext): ChatExecution => {
  if (activeSkillIds.length > 0) {
    return ChatExecution.Agent;
  }
  if (session?.activeSkillIds && session.activeSkillIds.length > 0) {
    return ChatExecution.Agent;
  }
  return ChatExecution.Direct;
};

/**
 * Combines the skill prompt with the base system prompt, mirroring the
 * work-branch combine logic in CoworkView. Returns undefined when both
 * parts are empty so callers can omit the field entirely.
 */
export const buildChatAgentSystemPrompt = (
  skillPrompt: string | undefined,
  baseSystemPrompt: string | undefined,
): string | undefined =>
  [skillPrompt, baseSystemPrompt].filter(part => part?.trim()).join('\n\n') || undefined;
