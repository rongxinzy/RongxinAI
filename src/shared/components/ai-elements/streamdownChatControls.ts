import type { StreamdownProps } from 'streamdown';

/**
 * Chat / reasoning Streamdown controls.
 * Table fullscreen uses `fixed inset-0` and covers the whole Agent (issue #37);
 * search answers often render as tables, so keep copy/download but disable fullscreen.
 */
export const streamdownChatControls: NonNullable<StreamdownProps['controls']> = {
  table: { fullscreen: false },
};
