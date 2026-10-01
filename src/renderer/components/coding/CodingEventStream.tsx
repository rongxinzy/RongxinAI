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
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import type { CodingElicitation, CodingEvent } from '../../../shared/codingAgent';
import { detectArtifactsFromMessages } from '../../services/artifactParser';
import { loadArtifactFileWithRetry } from '../../services/artifactFileLoader';
import { i18nService } from '../../services/i18n';
import type { RootState } from '../../store';
import { addArtifact, selectSessionArtifacts } from '../../store/slices/artifactSlice';
import type { Artifact } from '../../types/artifact';
import { CodingConversationTurn } from './CodingConversationTurn';
import { CodingElicitationCard } from './CodingElicitationCard';
import { toDetectableCodingMessages } from './codingArtifactMessages';
import { collectCodingFileArtifacts } from './codingArtifacts';
import { projectCodingEvents } from './codingEventProjection';

interface CodingEventStreamProps {
  events: CodingEvent[];
  isStreaming: boolean;
  scrollAreaRef: RefObject<HTMLDivElement | null>;
  onScrollPositionChange: (scrollPosition: number) => void;
  onLoadOlderEvents?: () => void;
  onReEditUserMessage: (content: string) => void;
  emptyDescription?: string;
  headerActions?: ReactNode;
  /**
   * Artifact store key for the active lane. When set, assistant messages are
   * scanned for previewable artifacts (HTML/SVG/Mermaid/code) and rendered as
   * cards that open the artifact panel.
   */
  artifactSessionKey?: string | null;
  /** Base directory used to resolve relative artifact paths for disk reads. */
  artifactBaseDir?: string | null;
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
  emptyDescription,
  headerActions,
  artifactSessionKey = null,
  artifactBaseDir = null,
  elicitation = null,
  onRespondElicitation,
  onCancelElicitation,
}: CodingEventStreamProps) => {
  const dispatch = useDispatch();
  const turns = useMemo(() => projectCodingEvents(events), [events]);
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
  // Tracks the latest loaded write per artifact so a file is re-read from disk
  // after a rewrite, but not on every render.
  const loadedFileVersionsRef = useRef<Map<string, string>>(new Map());
  const loadingFileVersionsRef = useRef<Map<string, string>>(new Map());
  const [loadingArtifactIds, setLoadingArtifactIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  // Artifact detection runs on the settled transcript only — scanning on every
  // streamed chunk would redo the whole parse per token.
  const detectableMessages = useMemo(
    () => (isStreaming ? [] : toDetectableCodingMessages(turns)),
    [turns, isStreaming],
  );
  const fileArtifacts = useMemo(
    () =>
      artifactSessionKey
        ? collectCodingFileArtifacts(events, artifactSessionKey, artifactBaseDir)
        : [],
    [events, artifactSessionKey, artifactBaseDir],
  );
  useEffect(() => {
    if (!artifactSessionKey) return;
    if (!isStreaming) {
      for (const { artifact } of detectArtifactsFromMessages(
        detectableMessages,
        artifactSessionKey,
      )) {
        // The coding page keeps revealing its own stream artifacts; the cowork
        // panel only opens for live declared deliverables.
        dispatch(addArtifact({ sessionId: artifactSessionKey, artifact, reveal: true }));
      }
    }
    for (const { artifact, needsFileLoad, version } of fileArtifacts) {
      // The coding page keeps revealing its own stream artifacts; the cowork
      // panel only opens for live declared deliverables.
      dispatch(addArtifact({ sessionId: artifactSessionKey, artifact, reveal: true }));
      if (!needsFileLoad) continue;
      const loadKey = `${artifactSessionKey}:${artifact.id}`;
      if (loadedFileVersionsRef.current.get(loadKey) === version) continue;
      loadedFileVersionsRef.current.set(loadKey, version);
      loadingFileVersionsRef.current.set(loadKey, version);
      setLoadingArtifactIds(current => new Set(current).add(artifact.id));
      void loadArtifactFileWithRetry(artifact, artifactBaseDir)
        .then(loaded => {
          if (!loaded) return;
          dispatch(
            addArtifact({
              sessionId: artifactSessionKey,
              artifact: { ...artifact, content: loaded.content, filePath: loaded.filePath },
              reveal: true,
            }),
          );
        })
        .finally(() => {
          if (loadingFileVersionsRef.current.get(loadKey) !== version) return;
          loadingFileVersionsRef.current.delete(loadKey);
          setLoadingArtifactIds(current => {
            const next = new Set(current);
            next.delete(artifact.id);
            return next;
          });
        });
    }
  }, [
    artifactSessionKey,
    artifactBaseDir,
    isStreaming,
    detectableMessages,
    fileArtifacts,
    dispatch,
  ]);

  // Anchor preview cards to the tool call that wrote the file. Store artifacts
  // win over collector output because they may carry disk-loaded content.
  const artifactsByToolCallId = useMemo(() => {
    const grouped = new Map<string, Artifact[]>();
    const storedById = new Map((artifacts ?? []).map(artifact => [artifact.id, artifact]));
    for (const { artifact, toolCallId } of fileArtifacts) {
      if (!toolCallId) continue;
      const list = grouped.get(toolCallId) ?? [];
      list.push(storedById.get(artifact.id) ?? artifact);
      grouped.set(toolCallId, list);
    }
    return grouped;
  }, [fileArtifacts, artifacts]);

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
      <Conversation
        className="h-full"
        initial="instant"
        resize={isStreaming ? 'smooth' : 'instant'}
      >
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
                loadingArtifactIds={loadingArtifactIds}
                expandedActivityIds={expandedActivityIds}
                onActivityOpenChange={setActivityOpen}
                onReEditUserMessage={onReEditUserMessage}
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
