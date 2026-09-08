import { describe, expect, test } from 'vitest';

import { ContextMenuAction, isContextMenuAction } from '../shared/contextMenu';
import { createContextMenuOpenEvent } from './contextMenu';

describe('context menu IPC payload', () => {
  test('forwards only the renderer state required to render menu actions', () => {
    expect(
      createContextMenuOpenEvent({
        x: 24,
        y: 48,
        isEditable: true,
        selectionText: 'selected text',
        editFlags: {
          canUndo: true,
          canRedo: false,
          canCut: true,
          canCopy: true,
          canPaste: true,
          canDelete: true,
          canSelectAll: true,
          canEditRichly: false,
        },
      }),
    ).toEqual({
      x: 24,
      y: 48,
      isEditable: true,
      selectionText: 'selected text',
      editFlags: {
        canUndo: true,
        canRedo: false,
        canCut: true,
        canCopy: true,
        canPaste: true,
        canSelectAll: true,
      },
    });
  });

  test('accepts only declared context menu actions', () => {
    expect(isContextMenuAction(ContextMenuAction.Copy)).toBe(true);
    expect(isContextMenuAction('delete')).toBe(false);
  });
});
