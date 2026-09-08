import { expect, test } from 'vitest';

import { ContextMenuAction } from '@shared/contextMenu';

import { getVisibleContextMenuGroups } from './ContextMenu';

test('getVisibleContextMenuGroups shows the expected editing groups', () => {
  const groups = getVisibleContextMenuGroups({
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

  expect(groups.map(group => group.map(item => item.action))).toEqual([
    [ContextMenuAction.Undo],
    [ContextMenuAction.Cut, ContextMenuAction.Copy, ContextMenuAction.Paste],
    [ContextMenuAction.SelectAll],
  ]);
});
