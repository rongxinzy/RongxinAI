export const WindowSurfaceSide = { Top: 'top', Left: 'left', Right: 'right' } as const;
export type WindowSurfaceSide = (typeof WindowSurfaceSide)[keyof typeof WindowSurfaceSide];
export const PetOrientation = {
  Upright: 'upright',
  Left: 'left-wall',
  Right: 'right-wall',
} as const;
export type PetOrientation = (typeof PetOrientation)[keyof typeof PetOrientation];
export const WindowSensorMessage = {
  Configure: 'configure',
  Ack: 'ack',
  Snapshot: 'snapshot',
  Failed: 'failed',
  Stop: 'stop',
} as const;
export const WINDOW_SENSOR_MAX_WINDOWS = 256;
export const WINDOW_SENSOR_MAX_SURFACES = 512;
export const WINDOW_SENSOR_MAX_DISPLAYS = 16;
export const WINDOW_SENSOR_STALE_MS = 1500;
export const WINDOW_SENSOR_ENTRY = 'desktopPetWindowsEntry.js';
