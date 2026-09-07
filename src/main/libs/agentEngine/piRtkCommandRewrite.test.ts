import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { CoworkSessionMode } from '../../../shared/cowork/constants';
import type { PiToolCallEvent } from './piExtensionTypes';
import {
  createPiRtkCommandRewriteExtension,
  isRtkRewriteEligibleCommand,
  type RtkRewriteExecutor,
} from './piRtkCommandRewrite';

describe('Pi RTK command rewrite extension', () => {
  let temporaryDirectory: string;
  let executablePath: string;
  let teeDirectory: string;

  beforeEach(() => {
    temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-rtk-rewrite-'));
    executablePath = path.join(temporaryDirectory, 'rtk');
    teeDirectory = path.join(temporaryDirectory, 'tee');
    fs.writeFileSync(executablePath, 'test runtime');
    delete process.env.ZHIYUAN_RTK_DISABLED;
  });

  afterEach(() => {
    delete process.env.ZHIYUAN_RTK_DISABLED;
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  function registerHandler(execute: RtkRewriteExecutor) {
    const extension = createPiRtkCommandRewriteExtension({
      sessionMode: CoworkSessionMode.Work,
      cwd: '/workspace',
      executablePath,
      teeDirectory,
      execute,
    });
    let handler: ((event: PiToolCallEvent) => Promise<unknown>) | undefined;
    extension?.({
      on(_event, registeredHandler) {
        handler = registeredHandler as (event: PiToolCallEvent) => Promise<unknown>;
      },
    });
    if (!handler) throw new Error('Expected the extension to register a tool handler.');
    return handler;
  }

  test('is disabled for chat sessions', () => {
    expect(
      createPiRtkCommandRewriteExtension({
        sessionMode: CoworkSessionMode.Chat,
        cwd: '/workspace',
        executablePath,
        teeDirectory,
      }),
    ).toBeNull();
  });

  test('is disabled when the bundled runtime is unavailable', () => {
    expect(
      createPiRtkCommandRewriteExtension({
        sessionMode: CoworkSessionMode.Work,
        cwd: '/workspace',
        executablePath: path.join(temporaryDirectory, 'missing'),
        teeDirectory,
      }),
    ).toBeNull();
  });

  test('rewrites an eligible command with private runtime state', async () => {
    let invocation:
      | { executablePath: string; args: string[]; options: Record<string, unknown> }
      | undefined;
    const handler = registerHandler(async (runtimePath, args, options) => {
      invocation = { executablePath: runtimePath, args, options };
      return { stdout: 'rtk git status\n' };
    });
    const input = { command: 'git status' };

    await handler({ toolCallId: 'tool-1', toolName: 'bash', input });

    expect(invocation?.executablePath).toBe(executablePath);
    expect(invocation?.args).toEqual(['rewrite', 'git status']);
    expect(invocation?.options.cwd).toBe('/workspace');
    expect(invocation?.options.timeout).toBe(2_000);
    expect(invocation?.options.env).toMatchObject({
      RTK_TELEMETRY_DISABLED: '1',
      RTK_NO_TOML: '1',
      RTK_DB_PATH: ':memory:',
      RTK_TEE_DIR: teeDirectory,
    });
    expect(input.command).toContain('RTK_TELEMETRY_DISABLED=1');
    expect(input.command).toContain(`'${executablePath}' git status`);
  });

  test('does not pass mutating or compound commands to RTK', async () => {
    const execute = vi.fn(async () => ({ stdout: 'rtk git status' }));
    const handler = registerHandler(execute);

    for (const command of [
      'git push origin main',
      'wrangler deploy',
      'npm run release',
      'rm -rf build',
      'git -C other status',
      'git status | head',
      'tail -f app.log',
    ]) {
      const input = { command };
      await handler({ toolCallId: command, toolName: 'bash', input });
      expect(input.command).toBe(command);
    }
    expect(execute).not.toHaveBeenCalled();
  });

  test('fails open when rewrite output is invalid or execution fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const invalidHandler = registerHandler(async () => ({ stdout: 'git status' }));
    const invalidInput = { command: 'git status' };
    await invalidHandler({ toolCallId: 'invalid', toolName: 'bash', input: invalidInput });
    expect(invalidInput.command).toBe('git status');

    const failingHandler = registerHandler(async () => {
      throw new Error('rewrite unavailable');
    });
    const failingInput = { command: 'ls -la' };
    await failingHandler({ toolCallId: 'failure', toolName: 'bash', input: failingInput });
    expect(failingInput.command).toBe('ls -la');
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe('RTK rewrite eligibility', () => {
  test('allows low-risk diagnostic and build commands', () => {
    expect(isRtkRewriteEligibleCommand('git diff --stat')).toBe(true);
    expect(isRtkRewriteEligibleCommand('rg TODO src')).toBe(true);
    expect(isRtkRewriteEligibleCommand('npm run lint')).toBe(true);
    expect(isRtkRewriteEligibleCommand('cargo test')).toBe(true);
  });

  test('rejects empty and substitution syntax', () => {
    expect(isRtkRewriteEligibleCommand('')).toBe(false);
    expect(isRtkRewriteEligibleCommand('rg $(cat pattern) src')).toBe(false);
  });
});
