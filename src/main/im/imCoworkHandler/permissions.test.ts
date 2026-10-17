import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { PermissionRequest } from '../../libs/agentEngine/types';
import {
  accumulatorFromPendingPermissions,
  buildIMAllowPermissionResult,
  buildIMPermissionPrompt,
  createIMConversationKey,
  IMCoworkPermissionRegistry,
  isIMAllowResponse,
  isIMDenyResponse,
} from './permissions';
import type { PendingIMPermission } from './types';

function createPermissionRequest(overrides: Partial<PermissionRequest> = {}): PermissionRequest {
  return {
    requestId: 'permission-1',
    toolName: 'Bash',
    toolInput: { command: 'rm temporary.txt' },
    ...overrides,
  };
}

describe('createIMConversationKey', () => {
  test('prefixes the conversation id with the platform', () => {
    expect(createIMConversationKey('conv-1', 'dingtalk')).toBe('dingtalk:conv-1');
    expect(createIMConversationKey('a:b', 'weixin')).toBe('weixin:a:b');
  });
});

describe('allow/deny response matching', () => {
  test('accepts the documented allow replies', () => {
    for (const reply of ['允许', '同意', 'yes', 'YES', 'y', 'Y']) {
      expect(isIMAllowResponse(reply)).toBe(true);
    }
  });

  test('accepts the documented deny replies', () => {
    for (const reply of ['拒绝', '不同意', 'no', 'NO', 'n', 'N']) {
      expect(isIMDenyResponse(reply)).toBe(true);
    }
  });

  test('rejects anything else', () => {
    expect(isIMAllowResponse('不允许')).toBe(false);
    expect(isIMAllowResponse('好的')).toBe(false);
    expect(isIMDenyResponse('允许')).toBe(false);
    expect(isIMAllowResponse('')).toBe(false);
  });
});

describe('buildIMPermissionPrompt', () => {
  test('includes the tool name and default note without a question', () => {
    const prompt = buildIMPermissionPrompt(createPermissionRequest());
    expect(prompt).toBe(
      '检测到需要安全确认的操作（工具: Bash）。\n说明: 当前操作涉及删除或访问任务目录外路径。\n请在 60 秒内回复“允许”或“拒绝”。',
    );
  });

  test('surfaces the first question when present', () => {
    const request = createPermissionRequest({
      toolName: 'AskUserQuestion',
      toolInput: {
        questions: [{ question: '要继续执行吗？' }],
      },
    });
    const prompt = buildIMPermissionPrompt(request);
    expect(prompt).toContain('检测到需要安全确认的操作（工具: AskUserQuestion）。');
    expect(prompt).toContain('说明: 要继续执行吗？');
    expect(prompt).toContain('请在 60 秒内回复“允许”或“拒绝”。');
  });
});

describe('buildIMAllowPermissionResult', () => {
  test('allows other tools with unchanged input', () => {
    const request = createPermissionRequest();
    expect(buildIMAllowPermissionResult(request)).toEqual({
      behavior: 'allow',
      updatedInput: request.toolInput,
    });
  });

  test('answers AskUserQuestion with the allow-preferred option', () => {
    const request = createPermissionRequest({
      toolName: 'AskUserQuestion',
      toolInput: {
        questions: [
          {
            question: '是否删除文件？',
            options: [{ label: '取消' }, { label: '允许本次操作' }],
          },
        ],
      },
    });
    expect(buildIMAllowPermissionResult(request)).toEqual({
      behavior: 'allow',
      updatedInput: {
        questions: [
          {
            question: '是否删除文件？',
            options: [{ label: '取消' }, { label: '允许本次操作' }],
          },
        ],
        answers: { '是否删除文件？': '允许本次操作' },
      },
    });
  });

  test('falls back to the first option and the default label', () => {
    const request = createPermissionRequest({
      toolName: 'AskUserQuestion',
      toolInput: {
        questions: [
          { question: '继续吗？', options: [{ label: '继续' }, { label: '停止' }] },
          { question: '没有选项的问题' },
        ],
      },
    });
    expect(buildIMAllowPermissionResult(request)).toEqual({
      behavior: 'allow',
      updatedInput: {
        questions: [
          { question: '继续吗？', options: [{ label: '继续' }, { label: '停止' }] },
          { question: '没有选项的问题' },
        ],
        answers: { '继续吗？': '继续', 没有选项的问题: '允许本次操作' },
      },
    });
  });
});

describe('accumulatorFromPendingPermissions', () => {
  test('returns undefined without pending permissions', () => {
    expect(accumulatorFromPendingPermissions([])).toBeUndefined();
  });

  test('derives the accumulator from the first pending permission', () => {
    const pending = {
      key: 'dingtalk:conv-1',
      runId: 'run-1',
      sessionId: 'session-1',
      request: createPermissionRequest(),
      conversationId: 'conv-1',
      platform: 'dingtalk',
      createdAt: 0,
      backgroundDelivery: { conversationId: 'conv-1', platform: 'dingtalk' },
    } satisfies PendingIMPermission;
    expect(accumulatorFromPendingPermissions([pending])).toEqual({
      runId: 'run-1',
      messages: [],
      backgroundDelivery: { conversationId: 'conv-1', platform: 'dingtalk' },
    });
  });
});

describe('IMCoworkPermissionRegistry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function trackEntry(registry: IMCoworkPermissionRegistry, key: string, requestId: string) {
    registry.track(
      {
        key,
        runId: `run-${requestId}`,
        sessionId: 'session-1',
        request: createPermissionRequest({ requestId }),
        conversationId: 'conv-1',
        platform: 'dingtalk',
      },
      () => {},
    );
  }

  test('stores, exposes, and clears pending permissions by key', () => {
    const registry = new IMCoworkPermissionRegistry();
    trackEntry(registry, 'dingtalk:conv-1', 'permission-1');
    expect(registry.get('dingtalk:conv-1')?.request.requestId).toBe('permission-1');

    const cleared = registry.clearByKey('dingtalk:conv-1');
    expect(cleared?.request.requestId).toBe('permission-1');
    expect(registry.get('dingtalk:conv-1')).toBeUndefined();
    expect(registry.clearByKey('dingtalk:conv-1')).toBeNull();
  });

  test('clears pending permissions by session id', () => {
    const registry = new IMCoworkPermissionRegistry();
    trackEntry(registry, 'dingtalk:conv-1', 'permission-1');
    trackEntry(registry, 'dingtalk:conv-2', 'permission-2');
    const cleared = registry.clearBySessionId('session-1');
    expect(cleared.map(pending => pending.request.requestId).sort()).toEqual([
      'permission-1',
      'permission-2',
    ]);
    expect(registry.get('dingtalk:conv-1')).toBeUndefined();
    expect(registry.get('dingtalk:conv-2')).toBeUndefined();
  });

  test('fires the confirmation timeout only for the still-pending request', () => {
    const registry = new IMCoworkPermissionRegistry();
    const onTimeout = vi.fn();
    registry.track(
      {
        key: 'dingtalk:conv-1',
        runId: 'run-1',
        sessionId: 'session-1',
        request: createPermissionRequest({ requestId: 'permission-1' }),
        conversationId: 'conv-1',
        platform: 'dingtalk',
      },
      onTimeout,
    );

    vi.advanceTimersByTime(60_000);
    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(onTimeout.mock.calls[0][0].request.requestId).toBe('permission-1');
    expect(registry.get('dingtalk:conv-1')).toBeUndefined();

    vi.advanceTimersByTime(120_000);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  test('does not fire the timeout for a superseded request', () => {
    const registry = new IMCoworkPermissionRegistry();
    const firstTimeout = vi.fn();
    registry.track(
      {
        key: 'dingtalk:conv-1',
        runId: 'run-1',
        sessionId: 'session-1',
        request: createPermissionRequest({ requestId: 'permission-1' }),
        conversationId: 'conv-1',
        platform: 'dingtalk',
      },
      firstTimeout,
    );
    registry.clearByKey('dingtalk:conv-1');
    trackEntry(registry, 'dingtalk:conv-1', 'permission-2');

    vi.advanceTimersByTime(60_000);
    expect(firstTimeout).not.toHaveBeenCalled();
  });

  test('destroyAll clears pending timers', () => {
    const registry = new IMCoworkPermissionRegistry();
    trackEntry(registry, 'dingtalk:conv-1', 'permission-1');
    registry.destroyAll();
    expect(registry.get('dingtalk:conv-1')).toBeUndefined();
  });
});
