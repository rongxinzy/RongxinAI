export const DesktopPetState = {
  Idle: 'idle',
  Thinking: 'thinking',
  Waiting: 'waiting',
  Completed: 'completed',
  Error: 'error',
  Greeting: 'greeting',
} as const;
export type DesktopPetState = (typeof DesktopPetState)[keyof typeof DesktopPetState];

export const DesktopPetIpc = {
  Ready: 'desktop-pet:ready',
  State: 'desktop-pet:state',
  DragStart: 'desktop-pet:drag-start',
  DragEnd: 'desktop-pet:drag-end',
  Menu: 'desktop-pet:menu',
  Open: 'desktop-pet:open',
  HitMask: 'desktop-pet:hit-mask',
  Motion: 'desktop-pet:motion',
} as const;

export const DESKTOP_PET_SIZE = 192;
export const DESKTOP_PET_STORE_KEY = 'desktopPet';
export const DESKTOP_PET_PAGE = 'desktop-pet.html';
export const DESKTOP_PET_TERMINAL_MS = 8000;

export const DesktopPetSprite = {
  [DesktopPetState.Idle]: 0,
  [DesktopPetState.Thinking]: 1,
  [DesktopPetState.Waiting]: 2,
  [DesktopPetState.Completed]: 3,
  [DesktopPetState.Error]: 4,
  [DesktopPetState.Greeting]: 5,
} as const;
