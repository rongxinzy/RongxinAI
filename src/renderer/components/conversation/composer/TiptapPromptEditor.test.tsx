// @vitest-environment jsdom

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const reduxState = vi.hoisted(() => ({
  dispatch: vi.fn(),
  activeSkillIds: [] as string[],
  skills: [
    {
      id: 'deep-research',
      name: 'Deep Research',
      displayName: '深度调研',
      description: 'Research topics thoroughly',
      enabled: true,
    },
  ],
  quickActions: [] as unknown[],
  selectedActionId: null as string | null,
}));

vi.mock('react-redux', () => ({
  useDispatch: () => reduxState.dispatch,
  useSelector: (selector: (state: unknown) => unknown) =>
    selector({
      skill: { activeSkillIds: reduxState.activeSkillIds, skills: reduxState.skills },
      quickAction: {
        actions: reduxState.quickActions,
        selectedActionId: reduxState.selectedActionId,
      },
    }),
}));

import { TiptapPromptEditor, type TiptapPromptEditorHandle } from './TiptapPromptEditor';

beforeEach(() => {
  reduxState.dispatch.mockClear();
  reduxState.activeSkillIds = [];
});

describe('TiptapPromptEditor', () => {
  test('disables editing during compaction and restores the same draft and editor afterwards', () => {
    const onChange = vi.fn();
    const view = render(<TiptapPromptEditor value="Unsent draft" onChange={onChange} />);
    const editor = screen.getByRole('textbox');
    view.rerender(<TiptapPromptEditor value="Unsent draft" onChange={onChange} disabled />);
    expect(editor.getAttribute('contenteditable')).toBe('false');
    expect(editor.textContent).toBe('Unsent draft');
    view.rerender(<TiptapPromptEditor value="Unsent draft" onChange={onChange} />);
    expect(screen.getByRole('textbox')).toBe(editor);
    expect(editor.getAttribute('contenteditable')).toBe('true');
    expect(editor.textContent).toBe('Unsent draft');
    expect(onChange).not.toHaveBeenCalled();
  });
  test('renders textbox with aria-multiline and syncs external value changes', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <TiptapPromptEditor value="hello world" onChange={onChange} placeholder="Ask anything" />,
    );

    const textbox = screen.getByRole('textbox');
    expect(textbox.getAttribute('aria-multiline')).toBe('true');
    expect(textbox.getAttribute('aria-label')).toBe('Ask anything');
    expect(textbox.textContent).toContain('hello world');

    rerender(
      <TiptapPromptEditor value="updated prompt" onChange={onChange} placeholder="Ask anything" />,
    );
    expect(textbox.textContent).toContain('updated prompt');
    expect(onChange).not.toHaveBeenCalled();
  });

  test('renders active skill pills and allows removal via button click', () => {
    reduxState.activeSkillIds = ['deep-research'];
    render(<TiptapPromptEditor value="" onChange={vi.fn()} placeholder="Ask" />);

    const token = document.querySelector('[data-skill-token="deep-research"]');
    expect(token).not.toBeNull();
    const removeButton = token?.querySelector('button');
    expect(removeButton).not.toBeNull();
    fireEvent.click(removeButton!);

    expect(reduxState.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ payload: 'deep-research' }),
    );
  });

  test('ignores Enter during IME composition and delegates non-composing Enter', () => {
    const onKeyDown = vi.fn();
    render(<TiptapPromptEditor value="测试" onChange={vi.fn()} onKeyDown={onKeyDown} />);
    const textbox = screen.getByRole('textbox');

    fireEvent.keyDown(textbox, { key: 'Enter', isComposing: true, keyCode: 229 });
    expect(onKeyDown).not.toHaveBeenCalled();

    fireEvent.keyDown(textbox, { key: 'Enter', isComposing: false });
    expect(onKeyDown).toHaveBeenCalledTimes(1);
  });

  test('restores and preserves rich mention node attrs across draftDoc replacements', () => {
    const onChange = vi.fn();
    const initialDoc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Inspect ' },
            {
              type: 'mention',
              attrs: {
                id: '/tmp/report.png',
                label: 'report.png',
                kind: 'file',
                path: '/tmp/report.png',
              },
            },
          ],
        },
      ],
    };

    const { rerender } = render(
      <TiptapPromptEditor
        value="Inspect @report.png"
        draftDoc={initialDoc}
        externalVersion={1}
        onChange={onChange}
      />,
    );

    const mentionEl = document.querySelector('[data-mention-kind="file"]');
    expect(mentionEl).not.toBeNull();
    expect(mentionEl?.getAttribute('data-id')).toBe('/tmp/report.png');

    rerender(
      <TiptapPromptEditor
        value="Plain switched session"
        draftDoc={null}
        externalVersion={2}
        onChange={onChange}
      />,
    );
    expect(document.querySelector('[data-mention-kind="file"]')).toBeNull();
    expect(screen.getByRole('textbox').textContent).toContain('Plain switched session');

    rerender(
      <TiptapPromptEditor
        value="Inspect @report.png"
        draftDoc={initialDoc}
        externalVersion={3}
        onChange={onChange}
      />,
    );
    const restored = document.querySelector('[data-mention-kind="file"]');
    expect(restored?.getAttribute('data-id')).toBe('/tmp/report.png');
    expect(restored?.getAttribute('data-label')).toBe('report.png');
  });

  test('clears editor content under React.StrictMode after initial abandoned instance is destroyed', async () => {
    const ref = React.createRef<TiptapPromptEditorHandle>();
    const onChange = vi.fn();
    const { rerender } = render(
      <React.StrictMode>
        <TiptapPromptEditor
          ref={ref}
          value="hello strict mode"
          externalVersion={0}
          onChange={onChange}
        />
      </React.StrictMode>,
    );

    const textbox = screen.getByRole('textbox');
    expect(textbox.textContent).toContain('hello strict mode');

    // Wait >1ms for the discarded StrictMode EditorInstanceManager's scheduleDestroy timer to fire
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 30));
    });

    act(() => {
      ref.current?.clear();
    });
    rerender(
      <React.StrictMode>
        <TiptapPromptEditor ref={ref} value="" externalVersion={1} onChange={onChange} />
      </React.StrictMode>,
    );

    expect(textbox.textContent).toBe('');
  });
});
