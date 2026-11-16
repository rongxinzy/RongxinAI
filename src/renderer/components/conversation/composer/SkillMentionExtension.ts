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

/**
 * Builds the `@` mention Tiptap extension backed by enabled Skills and current attachments.
 * Uses `@tiptap/suggestion`'s native `mount()` positioning/lifecycle and retains
 * `id`, `label`, `kind`, and `path` on file mention nodes in Tiptap JSON.
 */
export const createSkillMentionExtension = ({
  getCandidates,
  onSelectCandidate,
}: CreateSkillMentionExtensionOptions) =>
  Mention.extend({
    priority: 1000,
    addAttributes() {
      return {
        ...this.parent?.(),
        kind: {
          default: null,
          parseHTML: element => element.getAttribute('data-mention-kind'),
          renderHTML: attributes =>
            attributes.kind ? { 'data-mention-kind': String(attributes.kind) } : {},
        },
        path: {
          default: null,
          parseHTML: element => element.getAttribute('data-mention-path'),
          renderHTML: attributes =>
            attributes.path ? { 'data-mention-path': String(attributes.path) } : {},
        },
      };
    },
  }).configure({
    HTMLAttributes: {
      class: 'theme-conversation-skill-token inline-flex items-center',
    },
    renderText: ({ node }) => `@${String(node.attrs.label ?? node.attrs.id ?? '')}`,
    suggestion: {
      char: '@',
      allowSpaces: false,
      placement: 'top-start',
      offset: { mainAxis: 8, crossAxis: 0 },
      flip: true,
      floatingUi: { strategy: 'fixed' },
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
              attrs: {
                id: candidate.id,
                label: candidate.label,
                kind: candidate.kind,
                path: candidate.id,
              },
            },
            { type: 'text', text: ' ' },
          ])
          .run();
      },
      render: () => {
        let component: ReactRenderer<MentionSuggestionListHandle> | null = null;
        let unmount: (() => void) | null = null;

        const syncMount = (props: SuggestionProps<MentionCandidate>) => {
          if (!component) return;
          const element = component.element;
          if (props.items.length > 0 && element instanceof HTMLElement) {
            unmount ??= props.mount(element);
          } else {
            unmount?.();
            unmount = null;
          }
        };

        const destroy = () => {
          unmount?.();
          unmount = null;
          component?.destroy();
          component = null;
        };

        return {
          onStart: (props: SuggestionProps<MentionCandidate>) => {
            component = new ReactRenderer(MentionSuggestionList, {
              props: {
                items: props.items,
                command: (item: MentionCandidate) => props.command(item),
              },
              editor: props.editor,
            });
            syncMount(props);
          },
          onUpdate: (props: SuggestionProps<MentionCandidate>) => {
            component?.updateProps({
              items: props.items,
              command: (item: MentionCandidate) => props.command(item),
            });
            syncMount(props);
          },
          onKeyDown: (props: SuggestionKeyDownProps) => {
            if (props.event.key === 'Escape') {
              destroy();
              return true;
            }
            return component?.ref?.onKeyDown(props) ?? false;
          },
          onExit: () => {
            destroy();
          },
        };
      },
    },
  });
