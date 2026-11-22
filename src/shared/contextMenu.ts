export const ContextMenuAction = {
  Undo: 'undo',
  Redo: 'redo',
  Cut: 'cut',
  Copy: 'copy',
  Paste: 'paste',
  SelectAll: 'selectAll',
} as const;
export type ContextMenuAction = (typeof ContextMenuAction)[keyof typeof ContextMenuAction];

interface ContextMenuEditFlags {
  canUndo: boolean;
  canRedo: boolean;
  canCut: boolean;
  canCopy: boolean;
  canPaste: boolean;
  canSelectAll: boolean;
}

export interface ContextMenuEditState {
  isEditable: boolean;
  selectionText: string;
  editFlags: ContextMenuEditFlags;
}

export interface ContextMenuOpenEvent extends ContextMenuEditState {
  x: number;
  y: number;
}
