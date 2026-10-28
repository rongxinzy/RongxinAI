import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@shared/components/ai-elements/conversation';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@shared/components/ui/empty';
import { Code2 } from 'lucide-react';
import { useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useSelector } from 'react-redux';

import type { CodingElicitation, CodingEvent } from '../../../shared/codingAgent';
import { i18nService } from '../../services/i18n';
import type { RootState } from '../../store';
import { selectSessionArtifacts } from '../../store/slices/artifactSlice';
import type { Artifact } from '../../types/artifact';
import { CodingConversationTurn } from './CodingConversationTurn';
import { CodingElicitationCard } from './CodingElicitationCard';
import { toDetectableCodingMessages } from './codingArtifactMessages';
import {
  projectCodingEventsIncremental,
  type CodingProjectionCache,
} from './codingEventProjectionCache';
import { useInlineArtifacts } from '../cowork/sessionDetail/useInlineArtifacts';
import { useLedgerArtifacts } from './useLedgerArtifacts';

interface CodingEventStreamProps {
  events: CodingEvent[];
  isStreaming: boolean;
  scrollAreaRef: RefObject<HTMLDivElement | null>;
  onScrollPositionChange: (scrollPosition: number) => void;
  onLoadOlderEvents?: () => void;
  onReEditUserMessage: (content: string) => void;
  cwd?: string;
  emptyDescription?: string;
  headerActions?: ReactNode;
  /**
   * Artifact store key for the active lane. When set, assistant messages are
   * scanned for previewable artifacts (HTML/SVG/Mermaid/code) and rendered as
   * cards that open the artifact panel.
   */
  artifactSessionKey?: string | null;
  /** A question the agent is waiting on for this lane. */
  elicitation?: CodingElicitation | null;
  onRespondElicitation?: (answer: string) => Promise<boolean>;
  onCancelElicitation?: () => Promise<boolean>;
}

const groupArtifactsByMessage = (artifacts: Artifact[]): Map<string, Artifact[]> => {
  const grouped = new Map<string, Artifact[]>();
  for (const artifact of artifacts) {
    if (!artifact.messageId) continue;
    const list = grouped.get(artifact.messageId) ?? [];
    list.push(artifact);
    grouped.set(artifact.messageId, list);
  }
  return grouped;
};

export const CodingEventStream = ({
  events,
  isStreaming,
  scrollAreaRef,
  onScrollPositionChange,
  onLoadOlderEvents,
  onReEditUserMessage,
  cwd,
  emptyDescription,
  headerActions,
  artifactSessionKey = null,
  elicitation = null,
  onRespondElicitation,
  onCancelElicitation,
}: CodingEventStreamProps) => {
  const projectionCache = useRef<CodingProjectionCache | null>(null);
  const turns = useMemo(() => {
    const projected = projectCodingEventsIncremental(events, projectionCache.current);
    projectionCache.current = projected.cache;
    return projected.turns;
  }, [events]);
  const [expandedActivityIds, setExpandedActivityIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const setActivityOpen = (activityId: string, open: boolean) => {
    setExpandedActivityIds(current => {
      const next = new Set(current);
      if (open) next.add(activityId);
      else next.delete(activityId);
      return next;
    });
  };
  const artifacts = useSelector((state: RootState) =>
    artifactSessionKey ? selectSessionArtifacts(state, artifactSessionKey) : undefined,
  );

  // File-backed artifacts come from the main-process ledger: rows recorded
  // while this lane was not shown are read once per lane, live rows arrive
  // through the shared `artifact:upsert` subscription. Inline code blocks use
  // the same projection as cowork, once the transcript settles.
  useLedgerArtifacts(artifactSessionKey);
  const settledMessages = useMemo(() => toDetectableCodingMessages(turns), [turns]);
  useInlineArtifacts({
    sessionId: artifactSessionKey ?? undefined,
    messages: settledMessages,
    isStreaming,
  });

  // Anchor preview cards to the tool call that wrote the file.
  const artifactsByToolCallId = useMemo(() => {
    const grouped = new Map<string, Artifact[]>();
    for (const artifact of artifacts ?? []) {
      if (!artifact.toolCallId) continue;
      const list = grouped.get(artifact.toolCallId) ?? [];
      list.push(artifact);
      grouped.set(artifact.toolCallId, list);
    }
    return grouped;
  }, [artifacts]);

  const artifactsByMessageId = useMemo(() => groupArtifactsByMessage(artifacts ?? []), [artifacts]);

  return (
    <div
      ref={scrollAreaRef}
      className="relative min-h-0 min-w-0 flex-1 overflow-hidden"
      onScrollCapture={event => {
        // Persist only the conversation viewport's scroll position; inner
        // scrollable previews (diffs, terminal output) must not overwrite it.
        const target = event.target;
        if (
          target instanceof HTMLElement &&
          target.classList.contains('coding-conversation-scroll')
        ) {
          onScrollPositionChange(target.scrollTop);
          if (target.scrollTop <= 24) onLoadOlderEvents?.();
        }
      }}
    >
      {headerActions ? (
        <div className="absolute top-3 right-4 z-10 flex items-center gap-1 rounded-lg border border-border bg-background/80 p-1 shadow-sm backdrop-blur-sm">
          {headerActions}
        </div>
      ) : null}
      <Conversation className="relative h-full" role="log">
        <ConversationContent
          reverse={false}
          scrollClassName="coding-conversation-scroll"
          className="mx-auto min-h-full min-w-0 w-full max-w-5xl gap-6 overflow-x-hidden px-4 py-4"
        >
          {turns.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Code2 />
                </EmptyMedia>
                <EmptyTitle>{i18nService.t('codingAgentEmptyTitle')}</EmptyTitle>
                <EmptyDescription>
                  {emptyDescription ?? i18nService.t('codingAgentEmpty')}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            turns.map((turn, index) => (
              <CodingConversationTurn
                key={turn.id}
                turn={turn}
                isStreaming={isStreaming && index === turns.length - 1}
                showWaitingIndicator={
                  isStreaming &&
                  index === turns.length - 1 &&
                  turn.userMessage !== null &&
                  turn.reasoning === null &&
                  turn.activities.length === 0 &&
                  turn.status === null
                }
                artifactsByMessageId={artifactsByMessageId}
                artifactsByToolCallId={artifactsByToolCallId}
                expandedActivityIds={expandedActivityIds}
                onActivityOpenChange={setActivityOpen}
                onReEditUserMessage={onReEditUserMessage}
                cwd={cwd}
              />
            ))
          )}
          {elicitation && onRespondElicitation && onCancelElicitation ? (
            <CodingElicitationCard
              elicitation={elicitation}
              onRespond={onRespondElicitation}
              onCancel={onCancelElicitation}
            />
          ) : null}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>
    </div>
  );
};
