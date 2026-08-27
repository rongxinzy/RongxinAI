import { Message, MessageContent } from '@shared/components/ai-elements/message';
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from '@shared/components/ai-elements/reasoning';
import { Terminal } from '@shared/components/ai-elements/terminal';
import { Tool, ToolContent, ToolHeader, type ToolPart } from '@shared/components/ai-elements/tool';
import { ScrollArea } from '@shared/components/ui/scroll-area';
import type { RefObject } from 'react';

import { CodingEventKind, type CodingEvent } from '../../../shared/codingAgent';
import { i18nService } from '../../services/i18n';

interface CodingEventStreamProps {
  events: CodingEvent[];
  scrollAreaRef: RefObject<HTMLDivElement | null>;
  onScrollPositionChange: (scrollPosition: number) => void;
}

const eventContent = (event: CodingEvent): string =>
  typeof event.payload.content === 'string'
    ? event.payload.content
    : JSON.stringify(event.payload, null, 2);

const eventLabel = (kind: CodingEvent['kind']): string => {
  const keys: Record<CodingEvent['kind'], string> = {
    [CodingEventKind.Message]: 'codingAgentMessage',
    [CodingEventKind.MessageDelta]: 'codingAgentMessage',
    [CodingEventKind.Reasoning]: 'codingAgentReasoning',
    [CodingEventKind.Plan]: 'codingAgentPlan',
    [CodingEventKind.ToolCall]: 'codingAgentTool',
    [CodingEventKind.Permission]: 'codingAgentPermissionEvent',
    [CodingEventKind.FileChange]: 'codingAgentFileChange',
    [CodingEventKind.Terminal]: 'codingAgentTerminal',
    [CodingEventKind.Usage]: 'codingAgentUsage',
    [CodingEventKind.TurnComplete]: 'codingAgentTurnComplete',
    [CodingEventKind.TurnCancelled]: 'codingAgentTurnCancelled',
    [CodingEventKind.TurnFailed]: 'codingAgentTurnFailed',
  };
  return i18nService.t(keys[kind]);
};

const toolState = (event: CodingEvent): ToolPart['state'] => {
  if (event.kind === CodingEventKind.Permission) return 'approval-requested';
  const status = event.payload.status;
  if (status === 'failed') return 'output-error';
  if (status === 'completed') return 'output-available';
  if (status === 'pending') return 'input-streaming';
  return 'input-available';
};

const EventCard = ({ event }: { event: CodingEvent }) => {
  const content = eventContent(event);
  if (event.kind === CodingEventKind.Reasoning) {
    return (
      <Reasoning defaultOpen={false} autoClose={false} className="mb-0">
        <ReasoningTrigger>{eventLabel(event.kind)}</ReasoningTrigger>
        <ReasoningContent>{content}</ReasoningContent>
      </Reasoning>
    );
  }
  if (event.kind === CodingEventKind.Terminal) {
    const output = typeof event.payload.output === 'string' ? event.payload.output : content;
    return <Terminal output={output} className="rounded-lg border border-border" />;
  }
  if (
    event.kind === CodingEventKind.ToolCall ||
    event.kind === CodingEventKind.Permission ||
    event.kind === CodingEventKind.FileChange
  ) {
    return (
      <Tool defaultOpen={event.kind === CodingEventKind.Permission}>
        <ToolHeader
          type="dynamic-tool"
          toolName="coding-agent"
          state={toolState(event)}
          title={eventLabel(event.kind)}
        />
        <ToolContent>
          <pre className="whitespace-pre-wrap break-words font-mono text-xs">{content}</pre>
        </ToolContent>
      </Tool>
    );
  }
  const isUser = event.kind === CodingEventKind.Message && event.payload.role === 'user';
  return (
    <Message
      from={isUser ? 'user' : 'assistant'}
      className="max-w-full rounded-xl border border-border p-3"
    >
      <p className="text-xs font-medium text-muted-foreground">{eventLabel(event.kind)}</p>
      <MessageContent className="max-w-full">
        <pre className="whitespace-pre-wrap break-words font-sans">{content}</pre>
      </MessageContent>
    </Message>
  );
};

export const CodingEventStream = ({
  events,
  scrollAreaRef,
  onScrollPositionChange,
}: CodingEventStreamProps) => (
  <div
    ref={scrollAreaRef}
    className="min-h-0 flex-1"
    onScrollCapture={event => {
      if (event.target instanceof HTMLElement) onScrollPositionChange(event.target.scrollTop);
    }}
  >
    <ScrollArea className="size-full p-4">
      <div className="mx-auto max-w-3xl space-y-3">
        {events.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            {i18nService.t('codingAgentEmpty')}
          </div>
        ) : (
          events.map(event => <EventCard key={event.id} event={event} />)
        )}
      </div>
    </ScrollArea>
  </div>
);
