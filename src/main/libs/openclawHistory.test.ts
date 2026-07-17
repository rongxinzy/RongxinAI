import { describe, expect, test } from 'vitest';

import {
  buildScheduledReminderSystemMessage,
  extractGatewayHistoryEntries,
  extractGatewayHistoryEntry,
  extractGatewayMessageText,
  isHeartbeatAckText,
  isHeartbeatPromptText,
  isSilentReplyPrefixText,
  isSilentReplyText,
} from './openclawHistory';

describe('openclawHistory', () => {
  test('extracts plain text content blocks', () => {
    expect(
      extractGatewayMessageText({
        content: [{ type: 'text', text: 'hello world' }],
      }),
    ).toBe('hello world');
  });

  test('extracts output_text style content blocks', () => {
    expect(
      extractGatewayMessageText({
        content: [{ type: 'output_text', text: 'gemini output' }],
      }),
    ).toBe('gemini output');
  });

  test('extracts nested parts content blocks', () => {
    expect(
      extractGatewayMessageText({
        content: {
          parts: [
            { text: 'first line' },
            { type: 'toolCall', name: 'message', arguments: { action: 'send' } },
            { text: 'second line' },
          ],
        },
      }),
    ).toBe('first line\nsecond line');
  });

  test('builds history entry from assistant message with non-anthropic text shape', () => {
    expect(
      extractGatewayHistoryEntry({
        role: 'assistant',
        content: [{ type: 'output_text', text: 'final answer' }],
      }),
    ).toEqual({
      role: 'assistant',
      text: 'final answer',
    });
  });

  test('keeps gateway message timestamps when present', () => {
    expect(
      extractGatewayHistoryEntry({
        role: 'user',
        content: 'hello',
        createdAt: '2026-05-09T10:20:30.000Z',
      }),
    ).toEqual({
      role: 'user',
      text: 'hello',
      timestamp: Date.parse('2026-05-09T10:20:30.000Z'),
    });
  });

  test('joins text content blocks separated by toolCall blocks', () => {
    const text = extractGatewayMessageText({
      content: [
        { type: 'text', text: 'First line' },
        { type: 'toolCall', name: 'cron', arguments: { action: 'add' } },
        { type: 'text', text: 'Second line' },
      ],
    });
    expect(text).toBe('First line\nSecond line');
  });

  test('keeps system messages', () => {
    const entry = extractGatewayHistoryEntry({
      role: 'system',
      content: [{ type: 'text', text: 'Reminder fired' }],
    });
    expect(entry).toEqual({ role: 'system', text: 'Reminder fired' });
  });

  test('filters pure heartbeat ack assistant messages', () => {
    const entry = extractGatewayHistoryEntry({
      role: 'assistant',
      content: [{ type: 'text', text: 'HEARTBEAT_OK' }],
    });
    expect(entry).toBeNull();
  });

  test('filters pure heartbeat ack system messages with punctuation wrappers', () => {
    const entry = extractGatewayHistoryEntry({
      role: 'system',
      content: [{ type: 'text', text: '("HEARTBEAT_OK")' }],
    });
    expect(entry).toBeNull();
  });

  test('filters heartbeat prompt user messages', () => {
    const entry = extractGatewayHistoryEntry({
      role: 'user',
      content: `Read HEARTBEAT.md if it exists (workspace context). Follow it strictly.
When reading HEARTBEAT.md, use workspace file /tmp/HEARTBEAT.md.
Do not infer or repeat old tasks from prior chats. If nothing needs attention, reply HEARTBEAT_OK.`,
    });
    expect(entry).toBeNull();
  });

  test('filters unsupported roles and empty messages', () => {
    const entries = extractGatewayHistoryEntries([
      { role: 'user', content: 'Set a reminder' },
      { role: 'system', content: [{ type: 'text', text: 'Reminder fired' }] },
      { role: 'tool', content: 'ignored' },
      { role: 'assistant', content: [{ type: 'toolCall', name: 'cron', arguments: {} }] },
      { role: 'assistant', content: 'Done' },
    ]);
    expect(entries).toEqual([
      { role: 'user', text: 'Set a reminder' },
      { role: 'system', text: 'Reminder fired' },
      { role: 'assistant', text: 'Done' },
    ]);
  });

  test('remaps scheduled reminder prompts to system messages', () => {
    const entry = extractGatewayHistoryEntry({
      role: 'user',
      content: `A scheduled reminder has been triggered. The reminder content is:

⏰ 提醒：该去买菜了！

Handle this reminder internally. Do not relay it to the user unless explicitly requested.
Current time: Sunday, March 15th, 2026 — 11:27 (Asia/Shanghai)`,
    });
    expect(entry).toEqual({ role: 'system', text: '⏰ 提醒：该去买菜了！' });
  });

  test('remaps plain scheduled reminder text to a system message', () => {
    const entry = extractGatewayHistoryEntry({
      role: 'user',
      content: '⏰ 提醒：该去钉钉打卡啦！别忘了打卡哦～',
    });
    expect(entry).toEqual({ role: 'system', text: '⏰ 提醒：该去钉钉打卡啦！别忘了打卡哦～' });
  });

  test('buildScheduledReminderSystemMessage returns null for regular user text', () => {
    expect(buildScheduledReminderSystemMessage('普通聊天消息')).toBeNull();
  });

  test('isHeartbeatAckText matches token with lightweight wrappers only', () => {
    expect(isHeartbeatAckText('HEARTBEAT_OK')).toBe(true);
    expect(isHeartbeatAckText('`HEARTBEAT_OK`')).toBe(true);
    expect(isHeartbeatAckText('HEARTBEAT_OK: all clear')).toBe(false);
  });

  test('isHeartbeatPromptText matches canonical heartbeat instructions only', () => {
    expect(
      isHeartbeatPromptText(`Read HEARTBEAT.md if it exists.
When reading HEARTBEAT.md, use workspace file /tmp/HEARTBEAT.md.
Do not infer or repeat old tasks from prior chats.
If nothing needs attention, reply HEARTBEAT_OK.`),
    ).toBe(true);
    expect(isHeartbeatPromptText('Please read README.md and reply OK.')).toBe(false);
  });

  test('isSilentReplyText matches exact NO_REPLY token only', () => {
    expect(isSilentReplyText('NO_REPLY')).toBe(true);
    expect(isSilentReplyText('  NO_REPLY  ')).toBe(true);
    expect(isSilentReplyText('no_reply')).toBe(true);
    expect(isSilentReplyText('This is a message ending with NO_REPLY')).toBe(false);
    expect(isSilentReplyText('NO_REPLY: explanation')).toBe(false);
    expect(isSilentReplyText('NO')).toBe(false);
    expect(isSilentReplyText('')).toBe(false);
  });

  test('shouldSuppressHeartbeatText suppresses NO_REPLY for assistant and system', () => {
    // Imported at module level, test via extractGatewayHistoryEntry
    const entry = extractGatewayHistoryEntry({
      role: 'assistant',
      content: [{ type: 'text', text: 'NO_REPLY' }],
    });
    expect(entry).toBeNull();
  });

  test('shouldSuppressHeartbeatText does not suppress user NO_REPLY', () => {
    const entry = extractGatewayHistoryEntry({
      role: 'user',
      content: 'NO_REPLY',
    });
    expect(entry).toEqual({ role: 'user', text: 'NO_REPLY' });
  });

  test('isSilentReplyPrefixText matches streaming prefix fragments', () => {
    expect(isSilentReplyPrefixText('NO')).toBe(true);
    expect(isSilentReplyPrefixText('NO_')).toBe(true);
    expect(isSilentReplyPrefixText('NO_R')).toBe(true);
    expect(isSilentReplyPrefixText('NO_RE')).toBe(true);
    expect(isSilentReplyPrefixText('NO_REP')).toBe(true);
    expect(isSilentReplyPrefixText('NO_REPL')).toBe(true);
  });

  test('isSilentReplyPrefixText rejects non-prefix text', () => {
    expect(isSilentReplyPrefixText('')).toBe(false);
    expect(isSilentReplyPrefixText('N')).toBe(false);
    expect(isSilentReplyPrefixText('No')).toBe(false);
    expect(isSilentReplyPrefixText('NO,')).toBe(false);
    expect(isSilentReplyPrefixText('NOT')).toBe(false);
    expect(isSilentReplyPrefixText('hello')).toBe(false);
  });
});
