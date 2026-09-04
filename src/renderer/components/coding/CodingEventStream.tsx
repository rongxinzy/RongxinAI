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
import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import type { CodingEvent } from '../../../shared/codingAgent';
import { detectArtifactsFromMessages } from '../../services/artifactParser';
import { i18nService } from '../../services/i18n';
import type { RootState } from '../../store';
import { addArtifact, selectSessionArtifacts } from '../../store/slices/artifactSlice';
import { isBinaryArtifactFile, type Artifact } from '../../types/artifact';
import type { CoworkMessage } from '../../types/cowork';
import { CodingConversationTurn } from './CodingConversationTurn';
import {
  collectCodingFileArtifacts,
  resolveArtifactFilePath,
} from './codingArtifacts';
import {
  projectCodingEvents,
  type CodingConversationTurn as TurnModel,
} from './codingEventProjection';

interface CodingEventStreamProps {
  events: CodingEvent[];
  isStreaming: boolean;
  scrollAreaRef: RefObject<HTMLDivElement | null>;
  onScrollPositionChange: (scrollPosition: number) => void;
  emptyDescription?: string;
  /**
   * Artifact store key for the active lane. When set, assistant messages are
   * scanned for previewable artifacts (HTML/SVG/Mermaid/code) and rendered as
   * cards that open the artifact panel.
   */
  artifactSessionKey?: string | null;
  /** Base directory used to resolve relative artifact paths for disk reads. */
  artifactBaseDir?: string | null;
}

const toDetectableMessages = (turns: TurnModel[]): CoworkMessage[] =>
  turns.flatMap(turn =>
    turn.assistantMessages
      .filter(message => message.content.trim())
      .map(message => ({
        id: message.id,
        type: 'assistant' as const,
        content: message.content,
        timestamp: message.createdAt,
      })),
  );

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

const loadCodingArtifactContent = async (
  artifact: Artifact,
  baseDir: string | null | undefined,
): Promise<Artifact | null> => {
  if (!artifact.filePath) return null;
  const absPath = resolveArtifactFilePath(artifact.filePath, baseDir);
  try {
    const result = await window.electron.dialog.readFileAsDataUrl(absPath);
    if (!result?.success || !result.dataUrl) return null;
    let content = result.dataUrl;
    if (!isBinaryArtifactFile(absPath)) {
      try {
        const base64 = result.dataUrl.split(',')[1] || '';
        const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
        content = new TextDecoder('utf-8').decode(bytes);
      } catch {
        content = result.dataUrl;
      }
    }
    return { ...artifact, content, filePath: absPath };
  } catch {
    return null;
  }
};

export const CodingEventStream = ({
  events,
  isStreaming,
  scrollAreaRef,
  onScrollPositionChange,
  emptyDescription,
  artifactSessionKey = null,
  artifactBaseDir = null,
}: CodingEventStreamProps) => {
  const dispatch = useDispatch();
  const turns = useMemo(() => projectCodingEvents(events), [events]);
  const artifacts = useSelector((state: RootState) =>
    artifactSessionKey ? selectSessionArtifacts(state, artifactSessionKey) : undefined,
  );
  // Tracks the latest loaded write per artifact so a file is re-read from disk
  // after a rewrite, but not on every render.
  const loadedFileVersionsRef = useRef<Map<string, string>>(new Map());

  // Artifact detection runs on the settled transcript only — scanning on every
  // streamed chunk would redo the whole parse per token.
  const detectableMessages = useMemo(
    () => (isStreaming ? [] : toDetectableMessages(turns)),
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
    if (!artifactSessionKey || isStreaming) return;
    for (const { artifact } of detectArtifactsFromMessages(
      detectableMessages,
      artifactSessionKey,
    )) {
      dispatch(addArtifact({ sessionId: artifactSessionKey, artifact }));
    }
    for (const { artifact, needsFileLoad, version } of fileArtifacts) {
      dispatch(addArtifact({ sessionId: artifactSessionKey, artifact }));
      if (!needsFileLoad) continue;
      const loadKey = `${artifactSessionKey}:${artifact.id}`;
      if (loadedFileVersionsRef.current.get(loadKey) === version) continue;
      loadedFileVersionsRef.current.set(loadKey, version);
      void loadCodingArtifactContent(artifact, artifactBaseDir).then(loaded => {
        if (loaded) dispatch(addArtifact({ sessionId: artifactSessionKey, artifact: loaded }));
      });
    }
  }, [artifactSessionKey, artifactBaseDir, isStreaming, detectableMessages, fileArtifacts, dispatch]);

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

  const artifactsByMessageId = useMemo(
    () => groupArtifactsByMessage(artifacts ?? []),
    [artifacts],
  );

  return (
    <div
      ref={scrollAreaRef}
      className="min-h-0 flex-1"
      onScrollCapture={event => {
        if (event.target instanceof HTMLElement) onScrollPositionChange(event.target.scrollTop);
      }}
    >
      <Conversation
        className="h-full"
        initial="instant"
        resize={isStreaming ? 'smooth' : 'instant'}
      >
        <ConversationContent
          reverse={false}
          scrollClassName="coding-conversation-scroll"
          className="mx-auto min-h-full w-full max-w-5xl gap-6 px-4 py-4"
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
                  turn.assistantMessages.length === 0 &&
                  turn.status === null
                }
                artifactsByMessageId={artifactsByMessageId}
                artifactsByToolCallId={artifactsByToolCallId}
              />
            ))
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>
    </div>
  );
};
