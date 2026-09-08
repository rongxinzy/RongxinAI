export const ContextMenuAction = {
  Undo: 'undo',
  Redo: 'redo',
  Cut: 'cut',
  Copy: 'copy',
  Paste: 'paste',
  SelectAll: 'selectAll',
} as const;
export type ContextMenuAction = (typeof ContextMenuAction)[keyof typeof ContextMenuAction];

const contextMenuActionValues = new Set<string>(Object.values(ContextMenuAction));

export const isContextMenuAction = (value: unknown): value is ContextMenuAction =>
  typeof value === 'string' && contextMenuActionValues.has(value);

export interface ContextMenuEditFlags {
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
