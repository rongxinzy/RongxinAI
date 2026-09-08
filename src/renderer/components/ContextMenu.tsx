import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@shared/components/ui/dropdown-menu';
import {
  ContextMenuAction,
  type ContextMenuEditState,
  type ContextMenuOpenEvent,
} from '@shared/contextMenu';
import { ClipboardPaste, Copy, ListChecks, Redo2, Scissors, Undo2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { i18nService } from '../services/i18n';

interface ContextMenuItemDefinition {
  action: ContextMenuAction;
  icon: LucideIcon;
  labelKey: string;
  isVisible: (state: ContextMenuEditState) => boolean;
}

const contextMenuGroups: readonly (readonly ContextMenuItemDefinition[])[] = [
  [
    {
      action: ContextMenuAction.Undo,
      icon: Undo2,
      labelKey: 'contextMenuUndo',
      isVisible: state => state.isEditable && state.editFlags.canUndo,
    },
    {
      action: ContextMenuAction.Redo,
      icon: Redo2,
      labelKey: 'contextMenuRedo',
      isVisible: state => state.isEditable && state.editFlags.canRedo,
    },
  ],
  [
    {
      action: ContextMenuAction.Cut,
      icon: Scissors,
      labelKey: 'contextMenuCut',
      isVisible: state => state.isEditable && state.editFlags.canCut,
    },
    {
      action: ContextMenuAction.Copy,
      icon: Copy,
      labelKey: 'contextMenuCopy',
      isVisible: state =>
        state.editFlags.canCopy && (state.isEditable || state.selectionText.length > 0),
    },
    {
      action: ContextMenuAction.Paste,
      icon: ClipboardPaste,
      labelKey: 'contextMenuPaste',
      isVisible: state => state.isEditable && state.editFlags.canPaste,
    },
  ],
  [
    {
      action: ContextMenuAction.SelectAll,
      icon: ListChecks,
      labelKey: 'contextMenuSelectAll',
      isVisible: state => state.editFlags.canSelectAll,
    },
  ],
];

export const getVisibleContextMenuGroups = (state: ContextMenuEditState) =>
  contextMenuGroups
    .map(group => group.filter(item => item.isVisible(state)))
    .filter(group => group.length > 0);

export function ContextMenu() {
  const [menuEvent, setMenuEvent] = useState<ContextMenuOpenEvent | null>(null);
  const visibleGroups = useMemo(
    () => (menuEvent ? getVisibleContextMenuGroups(menuEvent) : []),
    [menuEvent],
  );
  const anchor = useMemo(
    () =>
      menuEvent
        ? {
            getBoundingClientRect: () => new DOMRect(menuEvent.x, menuEvent.y, 0, 0),
          }
        : null,
    [menuEvent],
  );

  useEffect(() => window.electron.contextMenu.onOpen(setMenuEvent), []);

  if (!menuEvent || visibleGroups.length === 0) return null;

  const handleOpenChange = (open: boolean) => {
    if (!open) setMenuEvent(null);
  };
  const handleAction = (action: ContextMenuAction) => {
    window.electron.contextMenu.execute(action);
    setMenuEvent(null);
  };

  return (
    <DropdownMenu open onOpenChange={handleOpenChange}>
      <DropdownMenuContent
        anchor={anchor}
        positionMethod="fixed"
        side="bottom"
        align="start"
        sideOffset={0}
        className="min-w-44"
      >
        {visibleGroups.map((group, groupIndex) => (
          <div key={group[0].action}>
            {groupIndex > 0 && <DropdownMenuSeparator />}
            {group.map(item => {
              const Icon = item.icon;
              return (
                <DropdownMenuItem key={item.action} onClick={() => handleAction(item.action)}>
                  <Icon className="size-4" aria-hidden="true" />
                  <span>{i18nService.t(item.labelKey)}</span>
                </DropdownMenuItem>
              );
            })}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
