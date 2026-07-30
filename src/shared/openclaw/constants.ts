export const OpenClawEnginePhase = {
  NotInstalled: 'not_installed',
  Installing: 'installing',
  Ready: 'ready',
  Starting: 'starting',
  Compiling: 'compiling',
  Restarting: 'restarting',
  Running: 'running',
  Error: 'error',
} as const;

export type OpenClawEnginePhase =
  (typeof OpenClawEnginePhase)[keyof typeof OpenClawEnginePhase];
