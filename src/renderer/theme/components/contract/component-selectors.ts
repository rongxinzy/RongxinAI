import { APP_SELECTORS } from './selectors-app';
import { CORE_SELECTORS } from './selectors-core';
import { OVERLAY_SELECTORS } from './selectors-overlays';
import { PAGE_HOOK_SELECTORS } from './selectors-page-hooks';

/** Stable component hooks. Theme packages cannot supply selectors or behavior. */
export const COMPONENT_SELECTORS = {
  ...CORE_SELECTORS,
  ...OVERLAY_SELECTORS,
  ...PAGE_HOOK_SELECTORS,
  ...APP_SELECTORS,
} as const;
