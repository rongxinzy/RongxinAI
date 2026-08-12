import type { CoworkMessage, CoworkStore } from '../coworkStore';
import type { ProjectMemoryService } from './projectMemoryService';

const MAX_SUMMARY_MESSAGES = 8;
const MAX_SOURCE_MESSAGES = 32;
const MAX_OBJECTIVE_CHARACTERS = 320;
const MAX_OUTCOME_CHARACTERS = 720;
const MAX_EARLIER_TOPIC_CHARACTERS = 160;

export class SessionSummaryService {
  private readonly pendingBySession = new Map<string, Promise<number | null>>();

  constructor(
    private readonly memoryService: ProjectMemoryService,
    private readonly coworkStore: CoworkStore,
  ) {}

  rollup(input: { sessionId: string; workingDirectory: string }): Promise<number | null> {
    const previous = this.pendingBySession.get(input.sessionId) ?? Promise.resolve(null);
    const current = previous
      .catch((): null => null)
      .then(() => this.rollupNow(input))
      .finally(() => {
        if (this.pendingBySession.get(input.sessionId) === current) {
          this.pendingBySession.delete(input.sessionId);
        }
      });
    this.pendingBySession.set(input.sessionId, current);
    return current;
  }

  private async rollupNow(input: {
    sessionId: string;
    workingDirectory: string;
  }): Promise<number | null> {
    const session = this.coworkStore.getSession(input.sessionId, MAX_SOURCE_MESSAGES);
    if (!session) return null;
    const summary = buildSessionSummary(session.messages);
    if (!summary) return null;
    return await this.memoryService.saveSessionSummary({ ...input, summary });
  }
}

export function buildSessionSummary(messages: CoworkMessage[]): string | null {
  const conversation = messages
    .filter(
      message =>
        (message.type === 'user' || message.type === 'assistant') &&
        message.metadata?.isThinking !== true &&
        message.content.trim().length > 0,
    )
    .slice(-MAX_SUMMARY_MESSAGES);
  const userMessages = conversation.filter(message => message.type === 'user');
  const assistantMessages = conversation.filter(message => message.type === 'assistant');
  const objective = userMessages.at(-1);
  const outcome = assistantMessages.at(-1);
  if (!objective || !outcome) return null;
  const earlierTopics = userMessages
    .slice(0, -1)
    .slice(-3)
    .map(message => summarizeText(message.content, MAX_EARLIER_TOPIC_CHARACTERS));
  return [
    `Session objective: ${summarizeText(objective.content, MAX_OBJECTIVE_CHARACTERS)}`,
    `Latest outcome: ${summarizeText(outcome.content, MAX_OUTCOME_CHARACTERS)}`,
    ...(earlierTopics.length > 0 ? [`Earlier topics: ${earlierTopics.join(' | ')}`] : []),
  ].join('\n');
}

function summarizeText(value: string, limit: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, Math.max(0, limit - 3)).trimEnd()}...`;
}
