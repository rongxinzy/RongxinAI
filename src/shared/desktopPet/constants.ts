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
  Pose: 'desktop-pet:pose',
  DragStart: 'desktop-pet:drag-start',
  DragEnd: 'desktop-pet:drag-end',
  Menu: 'desktop-pet:menu',
  Open: 'desktop-pet:open',
  HitMask: 'desktop-pet:hit-mask',
  Motion: 'desktop-pet:motion',
  Effect: 'desktop-pet:effect',
  GetSettings: 'desktop-pet:get-settings',
  SetSettings: 'desktop-pet:set-settings',
  SettingsChanged: 'desktop-pet:settings-changed',
  OpenTask: 'desktop-pet:open-task',
  GetPendingTask: 'desktop-pet:get-pending-task',
  ResolveTask: 'desktop-pet:resolve-task',
} as const;

export const DesktopPetTaskResult = {
  Opened: 'opened',
  Missing: 'missing',
  Failed: 'failed',
} as const;
export type DesktopPetTaskResult = (typeof DesktopPetTaskResult)[keyof typeof DesktopPetTaskResult];
export const DESKTOP_PET_FAILURES_KEY = 'desktopPetFailures';
export const DESKTOP_PET_DEFAULT_SETTINGS = {
  enabled: false,
  doNotDisturb: false,
  hideInFullscreen: true,
  roaming: true,
} as const;

export const DesktopPetEffectKind = { Drag: 'drag', Impact: 'impact' } as const;

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
