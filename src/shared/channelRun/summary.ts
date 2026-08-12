import type { ChannelRunStatus, ChannelRunSummary, ChannelRunTrigger } from './constants';

const PREVIEW_MAX_LENGTH = 80;

const toPreview = (text: string | undefined): string | undefined => {
  if (!text) return undefined;
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (!collapsed) return undefined;
  return collapsed.length > PREVIEW_MAX_LENGTH
    ? `${collapsed.slice(0, PREVIEW_MAX_LENGTH)}…`
    : collapsed;
};

export type BuildChannelRunSummaryInput = {
  runId: string;
  sessionId: string;
  platform: string;
  conversationId: string;
  trigger: ChannelRunTrigger;
  status: ChannelRunStatus;
  input?: string;
  reply?: string;
  error?: string;
};

/** Pure summary builder for Channel/Cron run lifecycle events (issue #225). */
export const buildChannelRunSummary = (input: BuildChannelRunSummaryInput): ChannelRunSummary => ({
  runId: input.runId,
  sessionId: input.sessionId,
  platform: input.platform,
  conversationId: input.conversationId,
  trigger: input.trigger,
  status: input.status,
  timestamp: Date.now(),
  inputPreview: toPreview(input.input),
  replyPreview: toPreview(input.reply),
  errorMessage: input.error,
});
