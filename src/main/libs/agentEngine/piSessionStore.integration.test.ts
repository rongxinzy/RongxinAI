/**
 * Integration test for file-backed Pi session persistence.
 *
 * Drives the REAL pi SessionManager through the same code path the adapter
 * uses (`openPersistentPiSessionManager`): a session with a tool call and
 * tool result is written to disk, then reopened from the store and the
 * structured messages must come back via `buildSessionContext()` — never
 * flattened into text.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  hasPersistedPiSession,
  invalidatePiSessionDir,
  openPersistentPiSessionManager,
  piSessionDirFor,
  resolvePiSessionStoreFile,
} from './piSessionStore';

import { SessionManager } from '@earendil-works/pi-coding-agent';

let rootDir: string;
let workspaceRoot: string;

beforeAll(() => {
  rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-session-store-root-'));
  workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-session-store-ws-'));
});

afterAll(() => {
  fs.rmSync(rootDir, { recursive: true, force: true });
  fs.rmSync(workspaceRoot, { recursive: true, force: true });
});

const userMessage = (text: string) => ({
  role: 'user' as const,
  content: [{ type: 'text' as const, text }],
  timestamp: new Date().toISOString(),
});

const assistantToolCall = () => ({
  role: 'assistant' as const,
  content: [{ type: 'toolCall' as const, id: 'toolu_1', name: 'bash', arguments: { cmd: 'ls' } }],
  provider: 'llamacpp',
  model: 'qwen-local',
  stopReason: 'toolUse',
  timestamp: new Date().toISOString(),
});

const toolResultMessage = () => ({
  role: 'toolResult' as const,
  toolCallId: 'toolu_1',
  toolName: 'bash',
  content: [{ type: 'text' as const, text: 'file-a\nfile-b' }],
  isError: false,
  timestamp: new Date().toISOString(),
});

describe('piSessionStore with the real Pi SessionManager', () => {
  it('round-trips structured messages (tool call + result) through a reopen', () => {
    const sessionId = '0ed4a4e6-1f2b-4c8f-9a3d-6c1f2e7b9d10';

    const first = openPersistentPiSessionManager(SessionManager, rootDir, sessionId, workspaceRoot);
    expect(first.reusedFile).toBe(false);
    const manager = first.manager as InstanceType<typeof SessionManager>;

    // No conversation yet: Pi writes the file lazily, so nothing is on disk.
    expect(hasPersistedPiSession(rootDir, sessionId)).toBe(false);

    manager.appendMessage(userMessage('List the files') as never);
    manager.appendMessage(assistantToolCall() as never);
    manager.appendMessage(toolResultMessage() as never);
    manager.appendMessage({
      role: 'assistant',
      content: [{ type: 'text', text: 'There are file-a and file-b.' }],
      provider: 'llamacpp',
      model: 'qwen-local',
      stopReason: 'stop',
      timestamp: new Date().toISOString(),
    } as never);

    // The first user message flushed the file.
    expect(hasPersistedPiSession(rootDir, sessionId)).toBe(true);

    // Reopen through the same resolution the adapter uses on a rebuild.
    const reopenedResolution = openPersistentPiSessionManager(
      SessionManager,
      rootDir,
      sessionId,
      workspaceRoot,
    );
    expect(reopenedResolution.reusedFile).toBe(true);
    const reopened = reopenedResolution.manager as InstanceType<typeof SessionManager>;

    const context = reopened.buildSessionContext();
    // Structured restore: user, assistant tool call, tool result, answer —
    // never one flattened "PREVIOUS CONVERSATION" text prompt.
    expect(context.messages.map(message => message.role)).toEqual([
      'user',
      'assistant',
      'toolResult',
      'assistant',
    ]);
    const toolCallMessage = context.messages[1];
    expect(toolCallMessage.content[0]).toMatchObject({
      type: 'toolCall',
      name: 'bash',
      arguments: { cmd: 'ls' },
    });
    const toolResult = context.messages[2] as { toolCallId: string; content: unknown };
    expect(toolResult.toolCallId).toBe('toolu_1');
    expect(JSON.stringify(toolResult.content)).toContain('file-a');

    // A new turn appends after the restored history.
    reopened.appendMessage(userMessage('Now count them') as never);
    const after = reopened.buildSessionContext();
    expect(after.messages.map(message => message.role)).toEqual([
      'user',
      'assistant',
      'toolResult',
      'assistant',
      'user',
    ]);
    expect(after.messages[4].content[0]).toMatchObject({ type: 'text', text: 'Now count them' });
  });

  it('keeps the reopen in the workspace the rebuild runs under', () => {
    const sessionId = '22c9a1de-4c8f-4b1e-8f2a-9d3e4f5a6b7c';
    const first = openPersistentPiSessionManager(SessionManager, rootDir, sessionId, workspaceRoot);
    (first.manager as InstanceType<typeof SessionManager>).appendMessage(
      userMessage('hello') as never,
    );

    const otherWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-session-store-ws2-'));
    const reopened = openPersistentPiSessionManager(
      SessionManager,
      rootDir,
      sessionId,
      otherWorkspace,
    );
    expect((reopened.manager as InstanceType<typeof SessionManager>).getCwd()).toBe(otherWorkspace);
    fs.rmSync(otherWorkspace, { recursive: true, force: true });
  });

  it('starts fresh after invalidation, so the text fallback runs again', () => {
    const sessionId = '31d7c2ef-9a4b-4c5d-8e6f-0a1b2c3d4e5f';
    const first = openPersistentPiSessionManager(SessionManager, rootDir, sessionId, workspaceRoot);
    (first.manager as InstanceType<typeof SessionManager>).appendMessage(
      userMessage('to be discarded') as never,
    );
    expect(hasPersistedPiSession(rootDir, sessionId)).toBe(true);

    invalidatePiSessionDir(rootDir, sessionId);
    expect(hasPersistedPiSession(rootDir, sessionId)).toBe(false);

    const afterInvalidation = resolvePiSessionStoreFile(rootDir, sessionId);
    expect(afterInvalidation.sessionFile).toBeNull();
    const next = openPersistentPiSessionManager(SessionManager, rootDir, sessionId, workspaceRoot);
    expect(next.reusedFile).toBe(false);
    expect(
      (next.manager as InstanceType<typeof SessionManager>).buildSessionContext().messages,
    ).toEqual([]);
  });

  it('isolates sessions into one directory each', () => {
    const left = '47e8d3fa-1b2c-4d3e-9f0a-1a2b3c4d5e6f';
    const right = '58f9e4ab-2c3d-4e4f-8a1b-2b3c4d5e6f7a';
    const leftDir = piSessionDirFor(rootDir, left);
    const rightDir = piSessionDirFor(rootDir, right);
    expect(leftDir).not.toBe(rightDir);

    openPersistentPiSessionManager(SessionManager, rootDir, left, workspaceRoot);
    invalidatePiSessionDir(rootDir, right);
    // Invalidating one session never touches another.
    expect(hasPersistedPiSession(rootDir, left)).toBe(false);
    expect(fs.existsSync(leftDir)).toBe(true);
  });
});
