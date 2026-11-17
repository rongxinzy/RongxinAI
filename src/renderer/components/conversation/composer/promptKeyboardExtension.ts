import { Extension } from '@tiptap/react';
import { Plugin } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';

/** Run after Mention's key handler and before StarterKit's editing shortcuts. */
export const createPromptKeyboardExtension = (
  handleKeyDown: (view: EditorView, event: KeyboardEvent) => boolean,
) =>
  Extension.create({
    name: 'promptKeyboard',
    priority: 500,
    addProseMirrorPlugins: () => [new Plugin({ props: { handleKeyDown } })],
  });
