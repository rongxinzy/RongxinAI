import Mention from '@tiptap/extension-mention';
import type { JSONContent } from '@tiptap/react';
import { ReactRenderer } from '@tiptap/react';
import type { SuggestionKeyDownProps, SuggestionProps } from '@tiptap/suggestion';

import {
  type MentionCandidate,
  MentionSuggestionList,
  type MentionSuggestionListHandle,
} from './MentionSuggestionList';

/**
 * Converts a plain multi-line prompt string into a safe Tiptap JSON document
 * without HTML string interpolation or entity escaping side effects.
 */
export const createTextDocFromString = (value: string): JSONContent => {
  const lines = value.split('\n');
  return {
    type: 'doc',
    content: lines.map(line =>
      line.length > 0
        ? { type: 'paragraph', content: [{ type: 'text', text: line }] }
        : { type: 'paragraph' },
    ),
  };
};

interface CreateSkillMentionExtensionOptions {
  getCandidates: (query: string) => MentionCandidate[];
  onSelectCandidate: (candidate: MentionCandidate) => boolean;
}

const positionPopupContainer = (
  container: HTMLDivElement,
  clientRect?: (() => DOMRect | null) | null,
): void => {
  const rect = clientRect?.();
  if (!rect) return;
  const top = Math.max(8, rect.top - 8);
  container.style.position = 'fixed';
  container.style.left = `${Math.max(8, Math.min(window.innerWidth - 300, rect.left))}px`;
  container.style.top = `${top}px`;
  container.style.transform = 'translateY(-100%)';
  container.style.zIndex = '60';
};

/**
 * Builds the `@` mention Tiptap extension backed by enabled Skills and current attachments.
 */
export const createSkillMentionExtension = ({
  getCandidates,
  onSelectCandidate,
}: CreateSkillMentionExtensionOptions) =>
  Mention.configure({
    HTMLAttributes: {
      class: 'theme-surface-skill-token inline-flex items-center px-1.5 py-0.5 text-xs font-medium',
    },
    renderText: ({ node }) => `@${String(node.attrs.label ?? node.attrs.id ?? '')}`,
    suggestion: {
      char: '@',
      allowSpaces: false,
      items: ({ query }) => getCandidates(query),
      command: ({ editor, range, props }) => {
        const candidate = props as unknown as MentionCandidate;
        // Skills activate directly as leading skill pills; delete the raw `@query` text.
        if (onSelectCandidate(candidate)) {
          editor.chain().focus().deleteRange(range).run();
          return;
        }
        editor
          .chain()
          .focus()
          .insertContentAt(range, [
            {
              type: 'mention',
              attrs: { id: candidate.id, label: candidate.label },
            },
            { type: 'text', text: ' ' },
          ])
          .run();
      },
      render: () => {
        let component: ReactRenderer<MentionSuggestionListHandle> | null = null;
        let container: HTMLDivElement | null = null;

        const destroy = () => {
          component?.destroy();
          component = null;
          container?.remove();
          container = null;
        };

        return {
          onStart: (props: SuggestionProps<MentionCandidate>) => {
            container = document.createElement('div');
            document.body.appendChild(container);
            component = new ReactRenderer(MentionSuggestionList, {
              props: {
                items: props.items,
                command: (item: MentionCandidate) => props.command(item),
              },
              editor: props.editor,
            });
            container.appendChild(component.element);
            positionPopupContainer(container, props.clientRect);
          },
          onUpdate: (props: SuggestionProps<MentionCandidate>) => {
            component?.updateProps({
              items: props.items,
              command: (item: MentionCandidate) => props.command(item),
            });
            if (container) {
              positionPopupContainer(container, props.clientRect);
            }
          },
          onKeyDown: (props: SuggestionKeyDownProps) => {
            if (props.event.key === 'Escape') {
              destroy();
              return true;
            }
            return component?.ref?.onKeyDown({ event: props.event }) ?? false;
          },
          onExit: destroy,
        };
      },
    },
  });
