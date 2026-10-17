import { describe, expect, test } from 'vitest';

import { CoworkErrorKind } from '../../../common/coworkError';
import { t } from '../../i18n';
import { UNSCHEDULED_REMINDER_FAILURE_REPLY, DEFAULT_IM_EMPTY_REPLY } from '../imReplyGuard';
import {
  formatIMErrorReply,
  formatIMMessageWithMedia,
  formatIMReply,
  formatIMReplyRaw,
} from './replies';
import type { IMMessage } from '../types';

function assistantMessage(content: string, overrides: Record<string, unknown> = {}) {
  return {
    id: `assistant-${content}`,
    type: 'assistant',
    content,
    timestamp: Date.now(),
    metadata: {},
    ...overrides,
  };
}

describe('formatIMReplyRaw', () => {
  test('joins assistant text and skips thinking content', () => {
    const messages = [
      assistantMessage('  first  '),
      assistantMessage('thinking only', { metadata: { isThinking: true } }),
      { id: 'system-1', type: 'system', content: 'system note', timestamp: 0, metadata: {} },
      assistantMessage('second'),
    ];
    expect(formatIMReplyRaw(messages)).toBe('first\n\nsecond');
  });

  test('falls back to the default empty reply', () => {
    expect(formatIMReplyRaw([])).toBe(DEFAULT_IM_EMPTY_REPLY);
    expect(formatIMReplyRaw([assistantMessage('   ')])).toBe(DEFAULT_IM_EMPTY_REPLY);
  });
});

describe('formatIMReply', () => {
  test('returns assistant text when no reminder commitment is present', () => {
    const messages = [assistantMessage('这是会议纪要摘要。')];
    expect(formatIMReply('session-1', messages)).toBe('这是会议纪要摘要。');
  });

  test('guards an unbacked reminder commitment', () => {
    const messages = [assistantMessage('好的，稍后我会提醒你喝水。')];
    expect(formatIMReply('session-1', messages)).toBe(UNSCHEDULED_REMINDER_FAILURE_REPLY);
  });

  test('keeps the assistant text when a cron.add succeeded', () => {
    const messages = [
      {
        id: 'tool-use-1',
        type: 'tool_use',
        content: 'Using tool: cron',
        timestamp: 0,
        metadata: {
          toolName: 'cron',
          toolUseId: 'cron-1',
          toolInput: { action: 'add' },
        },
      },
      {
        id: 'tool-result-1',
        type: 'tool_result',
        content: '{"ok":true}',
        timestamp: 0,
        metadata: { toolUseId: 'cron-1', isError: false },
      },
      assistantMessage('已设置好提醒！'),
    ];
    expect(formatIMReply('session-1', messages)).toBe('已设置好提醒！');
  });

  test('replaces an empty reply with a confirmation when a cron.add succeeded', () => {
    const messages = [
      {
        id: 'tool-use-1',
        type: 'tool_use',
        content: 'Using tool: cron',
        timestamp: 0,
        metadata: {
          toolName: 'cron',
          toolUseId: 'cron-1',
          toolInput: { action: 'add' },
        },
      },
      {
        id: 'tool-result-1',
        type: 'tool_result',
        content: '{"ok":true}',
        timestamp: 0,
        metadata: { toolUseId: 'cron-1', isError: false },
      },
    ];
    expect(formatIMReply('session-1', messages)).toBe('已创建定时任务。');
  });
});

describe('formatIMErrorReply', () => {
  test('maps error kinds to dedicated i18n replies', () => {
    expect(formatIMErrorReply({ kind: CoworkErrorKind.AuthExpired } as never)).toBe(
      t('imErrorAuthExpired'),
    );
    expect(
      formatIMErrorReply({ kind: CoworkErrorKind.NetworkError, message: 'boom' } as never),
    ).toBe(t('imErrorTransient', { error: 'boom' }));
    expect(formatIMErrorReply({ kind: CoworkErrorKind.ModelNotFound, message: 'x' } as never)).toBe(
      t('imErrorUnknown', { error: 'x' }),
    );
  });
});

describe('formatIMMessageWithMedia', () => {
  function createIMMessage(overrides: Partial<IMMessage> = {}): IMMessage {
    return {
      platform: 'dingtalk',
      messageId: 'im-msg-1',
      conversationId: 'conv-1',
      senderId: 'user-1',
      content: '帮我看看这张图',
      chatType: 'direct',
      timestamp: 0,
      ...overrides,
    };
  }

  test('returns content unchanged without attachments', () => {
    expect(formatIMMessageWithMedia(createIMMessage())).toBe('帮我看看这张图');
    expect(formatIMMessageWithMedia(createIMMessage({ attachments: [] }))).toBe('帮我看看这张图');
  });

  test('appends attachment metadata to the content', () => {
    const message = createIMMessage({
      attachments: [
        {
          type: 'image',
          localPath: '/tmp/downloaded.png',
          mimeType: 'image/png',
          fileName: 'photo.png',
          width: 640,
          height: 480,
          fileSize: 2048,
        },
      ],
    });
    const formatted = formatIMMessageWithMedia(message);
    expect(formatted).toBe(
      '帮我看看这张图\n\n[附件信息]\n- 类型: image, 路径: /tmp/downloaded.png, 文件名: photo.png, MIME: image/png, 尺寸: 640x480, 大小: 2.0KB',
    );
  });

  test('uses the attachment block alone when the message content is empty', () => {
    const message = createIMMessage({
      content: '',
      attachments: [
        { type: 'voice', localPath: '/tmp/a.silk', mimeType: 'audio/silk', duration: 12 },
      ],
    });
    expect(formatIMMessageWithMedia(message)).toBe(
      '[附件信息]\n- 类型: voice, 路径: /tmp/a.silk, MIME: audio/silk, 时长: 12秒',
    );
  });
});
