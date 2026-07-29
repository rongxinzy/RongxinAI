export const PiAssistantStopReason = {
  Error: 'error',
  Length: 'length',
  Stop: 'stop',
} as const;

export const PiBuiltinFileToolName = {
  Bash: 'bash',
  Write: 'write',
} as const;

export const PiContentBlockType = {
  Text: 'text',
  ToolCall: 'toolCall',
} as const;

const DEFAULT_MAX_OUTPUT_TOKENS = 4096;
const MAX_CHUNK_CHARACTERS = 8000;
const CHUNK_CHARACTERS_PER_OUTPUT_TOKEN = 0.5;
const MAX_WRITE_RECOVERY_ATTEMPTS = 3;
const UNKNOWN_WRITE_CALL_KEY = '__unknown_write_call__';

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
    '- Use the built-in write tool only for new files or complete rewrites that fit safely in one response.',
    `- Never put more than ${chunkCharacterLimit} characters in a single write.content or edit.edits[].newText when generating a large file.`,
    '- For a large new file, use write to create a small skeleton with a unique continuation marker, then use edit to replace that marker with one content chunk plus the same marker.',
    '- Emit only one content-bearing write or edit call per assistant response during a chunked write. Continue with the next chunk after the tool result.',
    '- Remove the continuation marker and verify the completed file with read or grep before reporting success.',
    '- For a complete rewrite of an existing file, assemble and verify a sibling temporary file first, then use the built-in bash tool to replace the target only after the temporary file is complete.',
    '- If a write call hits the output token limit, do not retry the full content. Switch to the chunked write and edit workflow immediately.',
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
        block.name?.toLowerCase() === PiBuiltinFileToolName.Write,
    )
    .map(block => {
      if (block.id?.trim()) return `call:${block.id.trim()}`;

      const rawPath = block.arguments?.path ?? block.arguments?.file_path;
      if (typeof rawPath === 'string' && rawPath.trim()) {
        return `path:${rawPath.trim().replace(/\\/g, '/')}`;
      }
      return UNKNOWN_WRITE_CALL_KEY;
    });

  return [...new Set(keys)];
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
    if (newKeys.length === 0 || this.recoveryAttempts >= MAX_WRITE_RECOVERY_ATTEMPTS) return false;

    const queuedGeneration = this.generation;
    for (const key of newKeys) this.recoveredWriteCalls.add(key);
    this.recoveryAttempts += 1;
    const prompt = [
      'The previous built-in write call hit the output token limit and was not executed.',
      'Do not retry the complete content in one call.',
      'Use write to create a small skeleton with a unique continuation marker, then use edit to replace the marker with one chunk plus the marker on each subsequent model turn.',
      `Keep each write.content or edit.edits[].newText payload at or below ${this.chunkCharacterLimit} characters and emit only one content-bearing file mutation per response.`,
      'Remove the marker and verify the completed file before reporting success.',
    ].join(' ');

    const rollback = (error: unknown): void => {
      if (queuedGeneration === this.generation) {
        for (const key of newKeys) this.recoveredWriteCalls.delete(key);
        this.recoveryAttempts = Math.max(0, this.recoveryAttempts - 1);
      }
      console.warn('[PiWriteRecovery] failed to queue chunked write guidance:', error);
    };

    try {
      void session.steer(prompt).catch(error => rollback(error));
    } catch (error) {
      rollback(error);
      return false;
    }
    return true;
  }
}
