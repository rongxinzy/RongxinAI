export const PiAssistantStopReason = {
  Error: 'error',
  Length: 'length',
  Stop: 'stop',
  ToolUse: 'toolUse',
} as const;

export const PiBuiltinFileToolName = {
  Bash: 'bash',
  Write: 'write',
  Edit: 'edit',
} as const;

export const PiContentBlockType = {
  Text: 'text',
  ToolCall: 'toolCall',
} as const;

const DEFAULT_MAX_OUTPUT_TOKENS = 4096;
const MAX_CHUNK_CHARACTERS = 2000;
const CHUNK_CHARACTERS_PER_OUTPUT_TOKEN = 0.5;
const MAX_WRITE_RECOVERY_ATTEMPTS = 6;
const UNKNOWN_WRITE_CALL_KEY = '__unknown_write_call__';
const TRUNCATED_RESPONSE_KEY = '__truncated_response__';

type PiMessageContentBlock = {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  arguments?: Record<string, unknown>;
};

export type PiWriteRecoveryMessage = {
  stopReason?: string;
  content: string | PiMessageContentBlock[];
};

export type PiSteeringSession = {
  steer(text: string): Promise<void>;
  followUp?(text: string): Promise<void>;
  prompt?(text: string, options?: { streamingBehavior?: 'steer' | 'followUp' }): Promise<void>;
};

const normalizeMaxOutputTokens = (maxOutputTokens: number): number =>
  Number.isFinite(maxOutputTokens) && maxOutputTokens > 0
    ? maxOutputTokens
    : DEFAULT_MAX_OUTPUT_TOKENS;

export const calculatePiWriteChunkCharacterLimit = (maxOutputTokens: number): number =>
  Math.min(
    MAX_CHUNK_CHARACTERS,
    Math.max(
      1,
      Math.floor(normalizeMaxOutputTokens(maxOutputTokens) * CHUNK_CHARACTERS_PER_OUTPUT_TOKEN),
    ),
  );

export const createPiLargeFileWriteSystemPrompt = (maxOutputTokens: number): string => {
  const chunkCharacterLimit = calculatePiWriteChunkCharacterLimit(maxOutputTokens);
  return [
    '## Large File Writes',
    '',
    '- Use the built-in write tool for new files or complete rewrites that fit one response.',
    `- Limit each write.content or edit.edits[].newText to ${chunkCharacterLimit} characters for large files.`,
    '- For larger files, write a skeleton with a unique continuation marker; use edit to replace it with one chunk plus the marker. Emit only one content-bearing write or edit call per response, waiting for its result before continuing.',
    '- Remove the marker and verify with read or grep before reporting success. For existing-file rewrites, build and verify a sibling temporary file before replacing the target with the built-in bash tool.',
    '- On output token limit, switch to chunking immediately; never retry the full content.',
  ].join('\n');
};

const getWriteCallKeys = (message: PiWriteRecoveryMessage): string[] => {
  if (message.stopReason !== PiAssistantStopReason.Length || !Array.isArray(message.content)) {
    return [];
  }

  const keys = message.content
    .filter(
      block =>
        block.type === PiContentBlockType.ToolCall &&
        (block.name?.toLowerCase() === PiBuiltinFileToolName.Write ||
          block.name?.toLowerCase() === PiBuiltinFileToolName.Edit),
    )
    .map(block => {
      if (block.id?.trim()) return `call:${block.id.trim()}`;

      const rawPath = block.arguments?.path ?? block.arguments?.file_path;
      if (typeof rawPath === 'string' && rawPath.trim()) {
        return `path:${rawPath.trim().replace(/\\/g, '/')}`;
      }
      return UNKNOWN_WRITE_CALL_KEY;
    });

  if (keys.length > 0) return [...new Set(keys)];
  const responseSuffix = message.content
    .map(block => block.text ?? '')
    .join('')
    .slice(-120);
  return [`${TRUNCATED_RESPONSE_KEY}:${responseSuffix}`];
};

export class PiWriteTokenLimitRecovery {
  private readonly recoveredWriteCalls = new Set<string>();
  private readonly chunkCharacterLimit: number;
  private recoveryAttempts = 0;
  private generation = 0;

  constructor(maxOutputTokens: number) {
    this.chunkCharacterLimit = calculatePiWriteChunkCharacterLimit(maxOutputTokens);
  }

  reset(): void {
    this.generation += 1;
    this.recoveredWriteCalls.clear();
    this.recoveryAttempts = 0;
  }

  queueIfNeeded(message: PiWriteRecoveryMessage, session: PiSteeringSession): boolean {
    const writeCallKeys = getWriteCallKeys(message);
    const newKeys = writeCallKeys.filter(key => !this.recoveredWriteCalls.has(key));
    if (newKeys.length === 0) return false;
    const fileMutation = newKeys.some(key => !key.startsWith(TRUNCATED_RESPONSE_KEY));
    if (!fileMutation && this.recoveryAttempts >= MAX_WRITE_RECOVERY_ATTEMPTS) return false;

    const queuedGeneration = this.generation;
    for (const key of newKeys) this.recoveredWriteCalls.add(key);
    if (!fileMutation) this.recoveryAttempts += 1;
    const prompt = fileMutation
      ? [
          'The previous built-in write or edit call hit the output token limit and was not executed.',
          'Do not retry the complete content in one call.',
          'Use write to create a small skeleton with a unique continuation marker, then use edit to replace the marker with one chunk plus the marker on each subsequent model turn.',
          `Keep each write.content or edit.edits[].newText payload at or below ${this.chunkCharacterLimit} characters and emit only one content-bearing file mutation per response.`,
          'Remove the marker and verify the completed file before reporting success.',
        ].join(' ')
      : [
          'The previous response hit the output token limit and was truncated.',
          'Continue the unfinished task without repeating completed tool calls.',
          'Keep the next response short and use small tool arguments. For large files, use the established continuation marker and chunked write/edit workflow.',
        ].join(' ');

    const rollback = (error: unknown): void => {
      if (queuedGeneration === this.generation) {
        for (const key of newKeys) this.recoveredWriteCalls.delete(key);
        if (!fileMutation) this.recoveryAttempts = Math.max(0, this.recoveryAttempts - 1);
      }
      console.warn('[PiWriteRecovery] failed to queue chunked write guidance:', error);
    };

    try {
      const queue = session.prompt ?? session.followUp ?? session.steer;
      void queue
        .call(session, prompt, { streamingBehavior: 'followUp' })
        .catch((error: unknown) => rollback(error));
    } catch (error) {
      rollback(error);
      return false;
    }
    return true;
  }
}
