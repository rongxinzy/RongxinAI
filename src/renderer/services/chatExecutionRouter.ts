/**
 * Chat execution routing.
 *
 * Chat-mode sessions use the Pi agent runtime while staying tagged as chat
 * sessions so they remain in the Chat sidebar list. Keeping one execution
 * kernel makes tools, permissions, ordering, and terminal states observable
 * through the same event protocol as Work sessions.
 */

export const ChatExecution = {
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
 * The runtime is the source of truth for every Chat turn, including plain
 * text turns without attached skills.
 */
export const resolveChatExecution = ({
  activeSkillIds,
  session,
}: ChatExecutionContext): ChatExecution => {
  void activeSkillIds;
  void session;
  return ChatExecution.Agent;
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
