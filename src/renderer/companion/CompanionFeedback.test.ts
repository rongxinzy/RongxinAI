// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { CompanionFeedback } from './CompanionFeedback';
import {
  CompanionCapability,
  CompanionUnavailableReason,
  CompanionRequestState as State,
} from '../../shared/companion/constants';
import { i18nService } from '../services/i18n';

afterEach(() => {
  cleanup();
  i18nService.setLanguage('zh', { persist: false });
});
const receipt = { petId: 'pet', requestId: 'request', submissionId: 1 };
const conversation = (state: State) => ({
  messages: [],
  pending: null,
  lastReply: { ...receipt, state },
});

test('a restored failure remains visible without a futile refresh action and clears on the next turn', () => {
  i18nService.setLanguage('zh', { persist: false });
  const props = { taskMode: false, error: null, reload: vi.fn(async () => {}) };
  const view = render(
    createElement(CompanionFeedback, { ...props, conversation: conversation(State.Unanswered) }),
  );
  expect(screen.getByRole('alert').textContent).toBe('回复中断了');
  expect(screen.queryByRole('button')).toBeNull();
  view.rerender(
    createElement(CompanionFeedback, {
      ...props,
      conversation: {
        ...conversation(State.Accepted),
        pending: { ...receipt, requestId: 'next', submissionId: 2 },
      },
    }),
  );
  expect(screen.queryByRole('alert')).toBeNull();
  view.rerender(
    createElement(CompanionFeedback, { ...props, conversation: conversation(State.Answered) }),
  );
  expect(screen.queryByRole('status')).toBeNull();
});

test('stopping is a quiet status in both languages and does not cover task mode', () => {
  const props = {
    taskMode: false,
    error: null,
    reload: vi.fn(async () => {}),
    conversation: conversation(State.Stopped),
  };
  const view = render(createElement(CompanionFeedback, props));
  expect(screen.getByRole('status').textContent).toBe('已停止回复');
  expect(screen.queryByRole('alert')).toBeNull();
  i18nService.setLanguage('en', { persist: false });
  view.rerender(createElement(CompanionFeedback, props));
  expect(screen.getByRole('status').textContent).toBe('Reply stopped');
  view.rerender(createElement(CompanionFeedback, { ...props, taskMode: true }));
  expect(screen.queryByRole('status')).toBeNull();
});

test('an unrelated attachment error stays actionable and does not erase the native reply result', () => {
  const props = {
    taskMode: false,
    error: 'companionFileUnavailable',
    reload: vi.fn(async () => {}),
    conversation: conversation(State.Unanswered),
  };
  const view = render(createElement(CompanionFeedback, props));
  expect(screen.getByRole('alert').textContent).toContain('附件已不可用');
  expect(screen.queryByRole('button')).toBeNull();
  view.rerender(createElement(CompanionFeedback, { ...props, error: null }));
  expect(screen.getByRole('alert').textContent).toBe('回复中断了');
});

test('a paused input waits for text or visual capability and offers continuation without a new submission', () => {
  const reload = vi.fn(async () => {});
  const props = {
    taskMode: false,
    error: null,
    reload,
    conversation: { ...conversation(State.Accepted), pending: receipt },
    availability: {
      capability: CompanionCapability.Local,
      modelId: null,
      imageInput: false,
      toolUse: false,
    },
  };
  const view = render(createElement(CompanionFeedback, props));
  expect(screen.getByRole('status').textContent).toContain('等待可用模型');
  expect(screen.queryByRole('alert')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '继续回复' }));
  expect(reload).toHaveBeenCalledOnce();
  view.rerender(
    createElement(CompanionFeedback, {
      ...props,
      availability: { ...props.availability, reason: CompanionUnavailableReason.ImageUnavailable },
    }),
  );
  expect(screen.getByRole('status').textContent).toContain('等待可看图片的模型');
  view.rerender(
    createElement(CompanionFeedback, {
      ...props,
      availability: {
        ...props.availability,
        capability: CompanionCapability.Chat,
        modelId: 'available',
      },
    }),
  );
  expect(screen.queryByRole('status')).toBeNull();
  view.rerender(createElement(CompanionFeedback, { ...props, taskMode: true }));
  expect(screen.queryByRole('status')).toBeNull();
});
