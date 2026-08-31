import { CodingEventKind, type CodingEvent } from '../../shared/codingAgent';

export const isAssistantResponseEvent = (
  event: Pick<CodingEvent, 'kind' | 'payload'>,
): boolean =>
  (event.kind === CodingEventKind.Message || event.kind === CodingEventKind.MessageDelta) &&
  event.payload.role !== 'user' &&
  typeof event.payload.content === 'string' &&
  Boolean(event.payload.content.trim());
