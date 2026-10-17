import { buildSessionTitleFromInput } from '../../../common/sessionTitle';

const SESSION_TITLE_FALLBACK = 'New Chat';

export async function generateSessionTitle(
  userIntent: string | null,
  defaultTitle = SESSION_TITLE_FALLBACK,
): Promise<string> {
  return buildSessionTitleFromInput(userIntent, defaultTitle);
}
