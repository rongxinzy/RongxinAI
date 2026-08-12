import { expect, test, vi } from 'vitest';

import {
  calculatePiWriteChunkCharacterLimit,
  createPiLargeFileWriteSystemPrompt,
  PiAssistantStopReason,
  PiBuiltinFileToolName,
  PiContentBlockType,
  PiWriteTokenLimitRecovery,
} from './piWriteTokenLimit';

const writeCall = (id: string, path: string) => ({
  type: PiContentBlockType.ToolCall,
  id,
  name: PiBuiltinFileToolName.Write,
  arguments: { path, content: 'partial' },
});

test('derives a conservative character budget from the model output limit', () => {
  expect(calculatePiWriteChunkCharacterLimit(4096)).toBe(2048);
  expect(calculatePiWriteChunkCharacterLimit(16384)).toBe(8000);
  expect(calculatePiWriteChunkCharacterLimit(512)).toBe(256);
  expect(calculatePiWriteChunkCharacterLimit(1)).toBe(1);
  expect(calculatePiWriteChunkCharacterLimit(Number.NaN)).toBe(2048);
});

test('instructs Pi to reuse write, edit, read, grep, and bash for chunked writes', () => {
  const prompt = createPiLargeFileWriteSystemPrompt(4096);

  expect(prompt).toContain('built-in write tool');
  expect(prompt).toContain('2048 characters');
  expect(prompt).toContain('use edit');
  expect(prompt).toContain('read or grep');
  expect(prompt).toContain('built-in bash tool');
  expect(prompt).toContain('only one content-bearing write or edit call');
});

test('does not steer normal responses or truncated non-write calls', () => {
  const recovery = new PiWriteTokenLimitRecovery(4096);
  const session = { steer: vi.fn().mockResolvedValue(undefined) };

  expect(
    recovery.queueIfNeeded(
      { stopReason: PiAssistantStopReason.Stop, content: [writeCall('write-1', 'src/file.ts')] },
      session,
    ),
  ).toBe(false);
  expect(
    recovery.queueIfNeeded(
      {
        stopReason: PiAssistantStopReason.Length,
        content: [
          {
            type: PiContentBlockType.ToolCall,
            id: 'bash-1',
            name: PiBuiltinFileToolName.Bash,
            arguments: {},
          },
        ],
      },
      session,
    ),
  ).toBe(false);
  expect(session.steer).not.toHaveBeenCalled();
});

test('steers each truncated write call once and resets for the next user turn', () => {
  const recovery = new PiWriteTokenLimitRecovery(4096);
  const session = { steer: vi.fn().mockResolvedValue(undefined) };
  const firstMessage = {
    stopReason: PiAssistantStopReason.Length,
    content: [writeCall('write-1', 'src\\large.ts'), writeCall('write-2', 'src/other.ts')],
  };

  expect(recovery.queueIfNeeded(firstMessage, session)).toBe(true);
  expect(recovery.queueIfNeeded(firstMessage, session)).toBe(false);
  expect(
    recovery.queueIfNeeded(
      {
        stopReason: PiAssistantStopReason.Length,
        content: [writeCall('write-3', 'src/other.ts')],
      },
      session,
    ),
  ).toBe(true);
  expect(session.steer).toHaveBeenCalledTimes(2);
  expect(session.steer).toHaveBeenCalledWith(expect.stringContaining('2048 characters'));

  recovery.reset();
  expect(recovery.queueIfNeeded(firstMessage, session)).toBe(true);
  expect(session.steer).toHaveBeenCalledTimes(3);
});

test('caps recovery attempts within one user turn', () => {
  const recovery = new PiWriteTokenLimitRecovery(4096);
  const session = { steer: vi.fn().mockResolvedValue(undefined) };

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    expect(
      recovery.queueIfNeeded(
        {
          stopReason: PiAssistantStopReason.Length,
          content: [writeCall(`write-${attempt}`, 'large.md')],
        },
        session,
      ),
    ).toBe(true);
  }
  expect(
    recovery.queueIfNeeded(
      {
        stopReason: PiAssistantStopReason.Length,
        content: [writeCall('write-4', 'large.md')],
      },
      session,
    ),
  ).toBe(false);
  expect(session.steer).toHaveBeenCalledTimes(3);
});

test('allows recovery to be queued again when Pi rejects steering', async () => {
  const recovery = new PiWriteTokenLimitRecovery(4096);
  const steerError = new Error('session stopped');
  const session = { steer: vi.fn().mockRejectedValueOnce(steerError).mockResolvedValue(undefined) };
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const message = {
    stopReason: PiAssistantStopReason.Length,
    content: [writeCall('write-1', 'large.md')],
  };

  expect(recovery.queueIfNeeded(message, session)).toBe(true);
  await vi.waitFor(() =>
    expect(warning).toHaveBeenCalledWith(
      '[PiWriteRecovery] failed to queue chunked write guidance:',
      steerError,
    ),
  );
  expect(recovery.queueIfNeeded(message, session)).toBe(true);
  expect(session.steer).toHaveBeenCalledTimes(2);

  warning.mockRestore();
});

test('allows recovery after a synchronous steering failure', () => {
  const recovery = new PiWriteTokenLimitRecovery(4096);
  const steerError = new Error('session stopped');
  const session = {
    steer: vi.fn(() => {
      throw steerError;
    }),
  };
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const message = {
    stopReason: PiAssistantStopReason.Length,
    content: [writeCall('write-1', 'large.md')],
  };

  expect(recovery.queueIfNeeded(message, session)).toBe(false);
  expect(recovery.queueIfNeeded(message, session)).toBe(false);
  expect(session.steer).toHaveBeenCalledTimes(2);
  expect(warning).toHaveBeenCalledWith(
    '[PiWriteRecovery] failed to queue chunked write guidance:',
    steerError,
  );

  warning.mockRestore();
});

test('does not let a delayed failure clear recovery state from a newer user turn', async () => {
  const recovery = new PiWriteTokenLimitRecovery(4096);
  let rejectFirstSteer: ((error: Error) => void) | undefined;
  const session = {
    steer: vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((_resolve, reject) => {
            rejectFirstSteer = reject;
          }),
      )
      .mockResolvedValue(undefined),
  };
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const message = {
    stopReason: PiAssistantStopReason.Length,
    content: [writeCall('write-1', 'large.md')],
  };

  expect(recovery.queueIfNeeded(message, session)).toBe(true);
  recovery.reset();
  expect(recovery.queueIfNeeded(message, session)).toBe(true);

  rejectFirstSteer?.(new Error('late failure'));
  await vi.waitFor(() => expect(warning).toHaveBeenCalled());
  expect(recovery.queueIfNeeded(message, session)).toBe(false);

  warning.mockRestore();
});
