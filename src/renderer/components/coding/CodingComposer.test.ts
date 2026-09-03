// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { createElement, useState } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';

import { i18nService } from '../../services/i18n';
import { CodingComposer } from './CodingComposer';

const renderComposer = (prompt: string, onChange = vi.fn()) => {
  const onSend = vi.fn();
  render(
    createElement(CodingComposer, {
      availableCommands: [
        { name: 'mcp', description: 'List configured MCP tools.' },
        {
          name: 'review',
          description: 'Review changes.',
          input: { hint: 'optional instructions' },
        },
      ],
      configOptions: [],
      disabled: false,
      isRunning: false,
      prompt,
      recipientName: 'Codex',
      onChange,
      onConfigOptionChange: vi.fn(),
      onSend,
      onStop: vi.fn(),
    }),
  );
  return { onChange, onSend };
};

const renderStatefulComposer = ({
  initialPrompt,
  onSend = vi.fn(),
}: {
  initialPrompt: string;
  onSend?: () => void;
}) => {
  const StatefulComposer = () => {
    const [prompt, setPrompt] = useState(initialPrompt);
    return createElement(CodingComposer, {
      availableCommands: [
        { name: 'plan', description: 'Turn plan mode on.' },
        { name: 'mcp', description: 'List configured MCP tools.' },
        { name: 'skills', description: 'List available skills.' },
        { name: '$react', description: 'A React skill.' },
      ],
      configOptions: [],
      disabled: false,
      isRunning: false,
      prompt,
      recipientName: 'Codex',
      onChange: setPrompt,
      onConfigOptionChange: vi.fn(),
      onSend,
      onStop: vi.fn(),
    });
  };

  render(createElement(StatefulComposer));
  return { onSend };
};

beforeEach(() => {
  i18nService.setLanguage('zh', { persist: false });
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
});

test('shows the Agent command snapshot when the composer starts with slash', () => {
  renderComposer('/');

  expect(screen.getByRole('textbox')).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByText('/mcp')).toBeTruthy();
  expect(screen.getByText('/review')).toBeTruthy();
});

test('shows a distinct selected command and moves it with arrow keys', () => {
  renderComposer('/');
  const textbox = screen.getByRole('textbox');
  const mcpItem = screen.getByText('/mcp').closest('[data-slot="command-item"]');
  const reviewItem = screen.getByText('/review').closest('[data-slot="command-item"]');

  expect(mcpItem).toHaveAttribute('data-selected', 'true');
  expect(reviewItem).toHaveAttribute('data-selected', 'false');

  fireEvent.keyDown(textbox, { key: 'ArrowDown' });

  expect(mcpItem).toHaveAttribute('data-selected', 'false');
  expect(reviewItem).toHaveAttribute('data-selected', 'true');
});

test('uses keyboard selection without submitting a partial slash query', () => {
  const { onChange } = renderComposer('/rev');

  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });

  expect(onChange).toHaveBeenCalledWith('/review ');
});

test('resets keyboard selection when the slash query changes', () => {
  renderStatefulComposer({ initialPrompt: '/m' });
  const textbox = screen.getByRole('textbox');

  fireEvent.change(textbox, { target: { value: '/ski' } });
  fireEvent.keyDown(textbox, { key: 'Enter' });

  expect(textbox).toHaveValue('/skills');
});

test('requests prompt submission with Enter', () => {
  renderComposer('Review this change.');
  const textbox = screen.getByRole('textbox');
  const form = textbox.closest('form');
  expect(form).not.toBeNull();
  const requestSubmit = vi.spyOn(form as HTMLFormElement, 'requestSubmit');

  fireEvent.keyDown(textbox, { key: 'Enter' });

  expect(requestSubmit).toHaveBeenCalledTimes(1);
});

test('inserts a newline at the cursor with Control Enter without submitting', () => {
  const onSend = vi.fn();
  renderStatefulComposer({ initialPrompt: 'hello world', onSend });
  const textbox = screen.getByRole('textbox') as HTMLTextAreaElement;
  textbox.setSelectionRange(5, 5);

  fireEvent.keyDown(textbox, { key: 'Enter', ctrlKey: true });

  expect(textbox).toHaveValue('hello\n world');
  expect(onSend).not.toHaveBeenCalled();
});

test('steers a running agent with Control S', () => {
  const onSteer = vi.fn();
  render(
    createElement(CodingComposer, {
      availableCommands: [],
      configOptions: [],
      disabled: false,
      isRunning: true,
      prompt: 'Change direction.',
      recipientName: 'Codex',
      onChange: vi.fn(),
      onConfigOptionChange: vi.fn(),
      onSend: vi.fn(),
      onSteer,
      supportsSteerShortcut: true,
      onStop: vi.fn(),
    }),
  );

  fireEvent.keyDown(screen.getByRole('textbox'), { key: 's', ctrlKey: true });

  expect(onSteer).toHaveBeenCalledOnce();
});
