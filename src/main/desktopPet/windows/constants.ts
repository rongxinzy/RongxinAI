export const NativeWindowFlag = {
  ExtendedFrameBounds: 9,
  Cloaked: 14,
  Next: 2,
  ExtendedStyle: -20,
  ToolWindow: 0x80n,
  Layered: 0x80000n,
  Transparent: 0x20n,
  ObjectCreate: 0x8000,
  ObjectLocation: 0x800b,
  Foreground: 3,
  MinimizeStart: 0x16,
  MinimizeEnd: 0x17,
  SkipOwnProcess: 2,
  RemoveMessage: 1,
} as const;
export const WINDOW_SENSOR_PUMP_MS = 16;
export const WINDOW_SENSOR_SAMPLE_MS = 16;
export const WINDOW_SENSOR_HEARTBEAT_MS = 1000;
export const WINDOW_SENSOR_MAX_VISITED = 2048;
export const WindowSensorFailure = {
  Native: 'native',
  Protocol: 'protocol',
  Unsupported: 'unsupported',
  Timeout: 'timeout',
} as const;
