import { DESKTOP_PET_SIZE } from './constants';

/** Vertical space reserved for the status bubble above the character canvas. */
export const DESKTOP_PET_BUBBLE_SLOT = 40;

/** Total transparent window height (bubble slot + character). */
export const DESKTOP_PET_WINDOW_HEIGHT = DESKTOP_PET_SIZE + DESKTOP_PET_BUBBLE_SLOT;

/** Y offset from the window top to the character canvas origin. */
export const DESKTOP_PET_CANVAS_TOP = DESKTOP_PET_BUBBLE_SLOT;

export const DESKTOP_PET_LAYOUT_VERSION = 1;
