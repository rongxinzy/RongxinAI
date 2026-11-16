// @vitest-environment jsdom

import { act, render } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { CoworkToolActivityPhase } from '../../../../shared/cowork/toolActivity';
import { coworkLiveTextStore } from '../../../services/liveTextStore';
import { projectSessionToTurns } from '../model/projectTurns';
import { ConversationThread } from './ConversationThread';

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      disconnect(): void {}
      observe(): void {}
      unobserve(): void {}
    },
  );
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      disconnect(): void {}
      observe(): void {}
      unobserve(): void {}
    },
  );
});

describe('ConversationThread', () => {
  test('renders thinking, tools and answer in strict chronological DOM order without repeating generic header', () => {
    const { turns } = projectSessionToTurns({
      messages: [
        { id: 'u1', type: 'user', content: 'Analyze repo', timestamp: 1000 },
        {
          id: 'th1',
          type: 'assistant',
          content: 'Inspecting workspace',
          timestamp: 1001,
          metadata: { isThinking: true },
        },
        {
          id: 'tu1',
          type: 'tool_use',
          content: '',
          timestamp: 1002,
          metadata: { toolName: 'bash', toolUseId: 'c1', toolInput: { command: 'ls' } },
        },
        {
          id: 'tr1',
          type: 'tool_result',
          content: 'README.md',
          timestamp: 1003,
          metadata: { toolUseId: 'c1', toolResult: 'README.md' },
        },
        { id: 'a1', type: 'assistant', content: 'Done!', timestamp: 1004 },
      ],
      toolActivities: [],
      artifacts: [],
      previewableTypes: new Set(),
      isStreaming: false,
    });

    const scrollRef = React.createRef<HTMLDivElement | null>();
    const { container } = render(
      <ConversationThread turns={turns} skills={[]} scrollContainerRef={scrollRef} />,
    );

    const log = container.querySelector('[role="log"]');
    expect(log).not.toBeNull();
    const scroller = container.querySelector('[role="log"] .cowork-conversation-scroll');
    expect(scroller).not.toBeNull();

    const orderedNodes = Array.from(
      container.querySelectorAll(
        '.theme-fold-reasoning, [data-tool-name], .group.is-assistant .theme-message-body',
      ),
    );
    expect(orderedNodes).toHaveLength(3);
    expect(orderedNodes[0].classList.contains('theme-fold-reasoning')).toBe(true);
    expect(orderedNodes[1].getAttribute('data-tool-name')).toBe('bash');
    expect(orderedNodes[2].classList.contains('theme-message-body')).toBe(true);
  });

  test('renders TurnNavigator rail once conversation reaches 6 turns', () => {
    const messages = Array.from({ length: 6 }, (_, index) => [
      {
        id: `u${index}`,
        type: 'user' as const,
        content: `Prompt ${index + 1}`,
        timestamp: 1000 + index * 2,
      },
      {
        id: `a${index}`,
        type: 'assistant' as const,
        content: `Reply ${index + 1}`,
        timestamp: 1001 + index * 2,
      },
    ]).flat();

    const { turns } = projectSessionToTurns({
      messages,
      toolActivities: [],
      artifacts: [],
      previewableTypes: new Set(),
      isStreaming: false,
    });

    const scrollRef = React.createRef<HTMLDivElement | null>();
    const { container } = render(
      <ConversationThread turns={turns} skills={[]} scrollContainerRef={scrollRef} />,
    );

    const nav = container.querySelector('nav[aria-label="Conversation turns"]');
    expect(nav).not.toBeNull();
    expect(nav?.querySelectorAll('button')).toHaveLength(6);
  });

  test('streams live thinking deltas visibly while isStreaming is true before thinking completes', async () => {
    const { turns } = projectSessionToTurns({
      messages: [
        { id: 'u-live', type: 'user', content: 'Think step by step', timestamp: 1000 },
        {
          id: 'th-live',
          type: 'assistant',
          content: 'Step 1:',
          timestamp: 1001,
          metadata: { isThinking: true, isStreaming: true, isFinal: false },
        },
      ],
      toolActivities: [],
      artifacts: [],
      previewableTypes: new Set(),
      isStreaming: true,
    });

    const scrollRef = React.createRef<HTMLDivElement | null>();
    const { container } = render(
      <ConversationThread turns={turns} skills={[]} scrollContainerRef={scrollRef} />,
    );

    const panel = container.querySelector('.theme-reasoning-panel');
    expect(panel).not.toBeNull();
    expect(panel?.hasAttribute('data-open')).toBe(true);
    expect(panel?.textContent).toContain('Step 1:');

    await act(async () => {
      coworkLiveTextStore.applyChunk('th-live', { type: 'reasoning-start', id: 'r1' });
      coworkLiveTextStore.applyChunk('th-live', {
        type: 'reasoning-delta',
        id: 'r1',
        delta: 'Step 1: checking AST nodes smoothly',
      });
      await new Promise(resolve => window.requestAnimationFrame(() => resolve(undefined)));
    });

    expect(container.querySelector('.theme-reasoning-panel')?.textContent).toContain(
      'checking AST nodes smoothly',
    );
    coworkLiveTextStore.clear('th-live');
  });

  test('shows bottom status indicator while preparing/running a tool or awaiting next step', () => {
    const { turns: preparingTurns } = projectSessionToTurns({
      messages: [{ id: 'u-tool', type: 'user', content: 'Write code', timestamp: 1000 }],
      toolActivities: [
        {
          toolCallId: 'call-write-1',
          toolName: 'write',
          toolInput: { file_path: 'src/app.ts' },
          phase: CoworkToolActivityPhase.Preparing,
          progress: { argsChars: 640 },
          updatedAt: 1001,
        },
      ],
      artifacts: [],
      previewableTypes: new Set(),
      isStreaming: true,
    });

    const scrollRef = React.createRef<HTMLDivElement | null>();
    const preparingView = render(
      <ConversationThread turns={preparingTurns} skills={[]} scrollContainerRef={scrollRef} />,
    );
    const preparingStatus = preparingView.container.querySelector('[role="status"]');
    expect(preparingStatus).not.toBeNull();
    expect(preparingStatus?.textContent).toContain('640');

    const { turns: postToolTurns } = projectSessionToTurns({
      messages: [
        { id: 'u-post', type: 'user', content: 'Check dir', timestamp: 1000 },
        {
          id: 'tu-post',
          type: 'tool_use',
          content: '',
          timestamp: 1001,
          metadata: { toolName: 'bash', toolUseId: 'c1', toolInput: { command: 'ls' } },
        },
        {
          id: 'tr-post',
          type: 'tool_result',
          content: 'ok',
          timestamp: 1002,
          metadata: { toolUseId: 'c1', toolResult: 'ok' },
        },
      ],
      toolActivities: [],
      artifacts: [],
      previewableTypes: new Set(),
      isStreaming: true,
    });

    const postToolView = render(
      <ConversationThread turns={postToolTurns} skills={[]} scrollContainerRef={scrollRef} />,
    );
    expect(postToolView.container.querySelector('[role="status"]')).not.toBeNull();
  });
});
