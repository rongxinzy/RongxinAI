import { expect, test } from 'vitest';

import {
  CoworkExecutionMode,
  CoworkSessionSource,
  CoworkSessionStatus,
} from '../../../../shared/cowork/constants';
import type { CoworkMessage, CoworkSession } from '../../../types/cowork';
import { sessionToJSON, sessionToMarkdown } from './sessionExport';

const buildMessage = (overrides: Partial<CoworkMessage>): CoworkMessage => ({
  id: `msg-${Math.random().toString(36).slice(2)}`,
  type: 'user',
  content: '',
  timestamp: 1_700_000_000_000,
  ...overrides,
});

const buildSession = (messages: CoworkMessage[]): CoworkSession => ({
  id: 'session-1',
  title: 'Quarterly report',
  status: CoworkSessionStatus.Idle,
  pinned: false,
  cwd: '/workspace/report',
  systemPrompt: '',
  modelOverride: '',
  executionMode: CoworkExecutionMode.Auto,
  activeSkillIds: [],
  workspaceId: '',
  agentId: '',
  source: CoworkSessionSource.Manual,
  messages,
  messagesOffset: 0,
  totalMessages: messages.length,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_100_000,
});

test('sessionToMarkdown serializes the transcript with tool detail blocks', () => {
  const session = buildSession([
    buildMessage({ id: 'u1', type: 'user', content: 'Write the report' }),
    buildMessage({ id: 'a1', type: 'assistant', content: 'Done.' }),
    buildMessage({
      id: 't1',
      type: 'tool_use',
      content: '',
      metadata: { toolName: 'python_execute', toolInput: { code: 'print(1)' } },
    }),
    buildMessage({ id: 'r1', type: 'tool_result', content: '1' }),
  ]);

  const markdown = sessionToMarkdown(session);
  const lines = markdown.split('\n');

  expect(lines[0]).toBe('# Quarterly report');
  expect(lines[1]).toBe('');
  expect(lines[2]).toBe(`> 创建时间: ${new Date(session.createdAt).toLocaleString()}`);
  expect(lines[3]).toBe('');
  expect(lines[4]).toBe('---');
  expect(lines[5]).toBe('');
  expect(markdown).toContain('## 🧑 User');
  expect(markdown).toContain('Write the report');
  expect(markdown).toContain('## 🤖 Assistant');
  expect(markdown).toContain('Done.');
  expect(markdown).toContain('### 🔧 Tool: python_execute');
  expect(markdown).toContain('```json');
  expect(markdown).toContain(JSON.stringify({ code: 'print(1)' }, null, 2));
  expect(markdown).toContain('#### Tool Result');
  expect(markdown).toContain('```');
});

test('sessionToMarkdown truncates tool results longer than 2000 characters', () => {
  const session = buildSession([
    buildMessage({ id: 'r1', type: 'tool_result', content: 'x'.repeat(2500) }),
  ]);

  const markdown = sessionToMarkdown(session);

  expect(markdown).toContain('x'.repeat(2000));
  expect(markdown).not.toContain('x'.repeat(2001));
  expect(markdown).toContain('\n... (truncated)');
});

test('sessionToJSON serializes session metadata and messages deterministically', () => {
  const session = buildSession([
    buildMessage({ id: 'u1', type: 'user', content: 'hello' }),
    buildMessage({
      id: 't1',
      type: 'tool_use',
      content: '',
      metadata: { toolName: 'bash', toolInput: { command: 'ls' } },
    }),
  ]);

  const json = sessionToJSON(session);

  expect(json).toBe(
    JSON.stringify(
      {
        title: 'Quarterly report',
        createdAt: '2023-11-14T22:13:20.000Z',
        updatedAt: '2023-11-14T22:15:00.000Z',
        status: session.status,
        messages: [
          { type: 'user', content: 'hello', timestamp: '2023-11-14T22:13:20.000Z' },
          {
            type: 'tool_use',
            content: '',
            timestamp: '2023-11-14T22:13:20.000Z',
            toolName: 'bash',
            toolInput: { command: 'ls' },
          },
        ],
      },
      null,
      2,
    ),
  );
});

test('sessionToMarkdown and sessionToJSON return empty payloads without a session', () => {
  expect(sessionToMarkdown(null)).toBe('');
  expect(sessionToJSON(null)).toBe('{}');
});
