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
      attachments: [],
      canAttachFiles: false,
      disabled: false,
      isRunning: false,
      prompt,
      onChange,
      onAddAttachments: vi.fn(),
      onConfigOptionChange: vi.fn(),
      onRemoveAttachment: vi.fn(),
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
        {
          name: 'skill',
          description: 'Apply an installed skill.',
          input: {
            hint: 'Skill name',
            options: [
              { value: 'pdf', label: 'PDF toolkit', description: 'Fill PDF forms.' },
              { value: 'off', label: 'No skill' },
            ],
          },
        },
      ],
      configOptions: [],
      attachments: [],
      canAttachFiles: false,
      disabled: false,
      isRunning: false,
      prompt,
      onChange: setPrompt,
      onAddAttachments: vi.fn(),
      onConfigOptionChange: vi.fn(),
      onRemoveAttachment: vi.fn(),
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

test('scrolls the keyboard-selected command into view', () => {
  const scrollIntoView = vi.fn();
  Element.prototype.scrollIntoView = scrollIntoView;
  renderStatefulComposer({ initialPrompt: '/' });
  const textbox = screen.getByRole('textbox');
  const mcpItem = screen.getByText('/mcp').closest('[data-slot="command-item"]');

  scrollIntoView.mockClear();
  fireEvent.keyDown(textbox, { key: 'ArrowDown' });

  expect(mcpItem).toHaveAttribute('data-selected', 'true');
  expect(scrollIntoView.mock.contexts).toContain(mcpItem);
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

test('reopens command discovery when the same text is retyped after a dismissal', () => {
  renderStatefulComposer({ initialPrompt: '' });
  const textbox = screen.getByRole('textbox');

  fireEvent.change(textbox, { target: { value: '/' } });
  expect(textbox).toHaveAttribute('aria-expanded', 'true');

  fireEvent.keyDown(textbox, { key: 'Escape' });
  expect(textbox).toHaveAttribute('aria-expanded', 'false');

  fireEvent.change(textbox, { target: { value: '' } });
  fireEvent.change(textbox, { target: { value: '/' } });
  expect(textbox).toHaveAttribute('aria-expanded', 'true');
});

test('lists the command choices while the argument is being typed', () => {
  renderStatefulComposer({ initialPrompt: '/skill ' });

  expect(screen.getByRole('textbox')).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByText('PDF toolkit')).toBeTruthy();
  expect(screen.getByText('Fill PDF forms.')).toBeTruthy();
  expect(screen.getByText('No skill')).toBeTruthy();
});

test('opens the choice menu right after a command with choices is picked', () => {
  renderStatefulComposer({ initialPrompt: '' });
  const textbox = screen.getByRole('textbox');

  fireEvent.change(textbox, { target: { value: '/' } });
  // The list is [plan, mcp, skills, $react, skill]; walk down to the last one,
  // which is the only command carrying choices.
  for (let step = 0; step < 4; step += 1) {
    fireEvent.keyDown(textbox, { key: 'ArrowDown' });
  }
  fireEvent.keyDown(textbox, { key: 'Enter' });

  expect(textbox).toHaveValue('/skill ');
  expect(textbox).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByText('PDF toolkit')).toBeTruthy();
});

test('filters the command choices by the typed argument', () => {
  renderStatefulComposer({ initialPrompt: '/skill pd' });

  expect(screen.getByText('PDF toolkit')).toBeTruthy();
  expect(screen.queryByText('No skill')).toBeNull();
});

test('replaces the typed argument with the selected choice', () => {
  renderStatefulComposer({ initialPrompt: '/skill pd' });
  const textbox = screen.getByRole('textbox');

  fireEvent.keyDown(textbox, { key: 'Enter' });

  expect(textbox).toHaveValue('/skill pdf ');
  expect(textbox).toHaveAttribute('aria-expanded', 'false');
});

test('closes the choice menu once the command carries a full argument', () => {
  renderStatefulComposer({ initialPrompt: '/skill pdf fill the form' });

  expect(screen.getByRole('textbox')).toHaveAttribute('aria-expanded', 'false');
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

test('does not move the cursor again when the prompt changes', () => {
  const setSelectionRange = vi.spyOn(HTMLTextAreaElement.prototype, 'setSelectionRange');
  const createComposer = (prompt: string) =>
    createElement(CodingComposer, {
      availableCommands: [],
      configOptions: [],
      attachments: [],
      canAttachFiles: false,
      disabled: false,
      focusRequestKey: 1,
      isRunning: false,
      prompt,
      onChange: vi.fn(),
      onAddAttachments: vi.fn(),
      onConfigOptionChange: vi.fn(),
      onRemoveAttachment: vi.fn(),
      onSend: vi.fn(),
      onStop: vi.fn(),
    });
  const { rerender } = render(createComposer('hello'));

  expect(setSelectionRange).toHaveBeenCalledTimes(1);
  rerender(createComposer('hello world'));

  expect(setSelectionRange).toHaveBeenCalledTimes(1);
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
      attachments: [],
      canAttachFiles: false,
      onChange: vi.fn(),
      onAddAttachments: vi.fn(),
      onConfigOptionChange: vi.fn(),
      onRemoveAttachment: vi.fn(),
      onSend: vi.fn(),
      onSteer,
      supportsSteerShortcut: true,
      onStop: vi.fn(),
    }),
  );

  fireEvent.keyDown(screen.getByRole('textbox'), { key: 's', ctrlKey: true });

  expect(onSteer).toHaveBeenCalledOnce();
});

test('uses a settings menu for configuration controls in a tight toolbar', () => {
  const ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
  vi.stubGlobal('ResizeObserver', ResizeObserver);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(640);

  render(
    createElement(CodingComposer, {
      availableCommands: [],
      configOptions: [
        {
          id: 'model',
          name: 'Model',
          type: 'select',
          currentValue: 'default',
          options: [{ value: 'default', name: 'Default' }],
        },
      ],
      disabled: false,
      isRunning: false,
      prompt: '',
      attachments: [],
      canAttachFiles: false,
      onChange: vi.fn(),
      onAddAttachments: vi.fn(),
      onConfigOptionChange: vi.fn(),
      onRemoveAttachment: vi.fn(),
      onSend: vi.fn(),
      onStop: vi.fn(),
    }),
  );

  expect(screen.getByRole('button', { name: i18nService.t('settings') })).toBeTruthy();
});
