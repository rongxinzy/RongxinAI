import {
  hasRichMessageContent,
  loadRichMessageResponse,
} from '../../shared/components/ai-elements/richMessageResponseLoader';
import type { CoworkSession } from '../types/cowork';

/** Loads the rich Markdown pipeline before a historical session reaches the DOM. */
export async function prepareCoworkSessionRender(session: CoworkSession): Promise<void> {
  if (!session.messages.some(message => hasRichMessageContent(message.content))) return;
  await loadRichMessageResponse();
}
