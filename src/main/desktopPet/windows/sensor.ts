import type {
  SurfaceDisplay,
  WindowSurfaceSnapshot,
} from '../../../shared/desktopPet/surfaces/types';
import { WindowSensorMessage } from '../../../shared/desktopPet/surfaces/constants';
import {
  fullscreenDisplays,
  visibleWindowSurfaces,
} from '../../../shared/desktopPet/surfaces/geometry';
import { windowSensorInput } from './protocol';
import { createNativeWindows } from './native';
import {
  WINDOW_SENSOR_HEARTBEAT_MS,
  WINDOW_SENSOR_PUMP_MS,
  WINDOW_SENSOR_SAMPLE_MS,
  WindowSensorFailure,
} from './constants';

export interface WindowSensorPort {
  postMessage(message: unknown): void;
  on(event: 'message', listener: (event: { data: unknown }) => void): unknown;
}

/** Native callbacks only mark dirty. Sampling and geometry are coalesced behind one receipt. */
export function startWindowSensor(port: WindowSensorPort, finished: () => void) {
  let displays: SurfaceDisplay[] = [];
  let excluded = new Set<string>();
  let native: ReturnType<typeof createNativeWindows> | undefined;
  let dirty = true;
  let dirtyAt = performance.now();
  let sequence = 0;
  let revision = 0;
  let pending = 0;
  let sampledAt = -Infinity;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const close = () => {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    try {
      native?.close();
    } finally {
      finished();
    }
  };
  const fail = (code: string) => {
    port.postMessage({ kind: WindowSensorMessage.Failed, code });
    close();
  };
  const step = () => {
    if (stopped) return;
    try {
      native?.pump();
      const now = Date.now();
      if (
        native &&
        !pending &&
        now - sampledAt >= WINDOW_SENSOR_SAMPLE_MS &&
        (dirty || now - sampledAt >= WINDOW_SENSOR_HEARTBEAT_MS)
      ) {
        const begun = performance.now();
        const frame = native.sample();
        const snapshot: WindowSurfaceSnapshot = {
          revision,
          sequence: ++sequence,
          capturedAt: now,
          timing: { queueMs: dirty ? Math.max(0, begun - dirtyAt) : 0, runMs: 0 },
          surfaces: visibleWindowSurfaces(frame.windows, displays),
          fullscreenDisplays: fullscreenDisplays(
            frame.windows.find(window => window.id === frame.foreground),
            displays,
          ),
        };
        snapshot.timing.runMs = performance.now() - begun;
        pending = snapshot.sequence;
        dirty = false;
        sampledAt = now;
        port.postMessage({ kind: WindowSensorMessage.Snapshot, ...snapshot });
      }
    } catch {
      fail(WindowSensorFailure.Native);
      return;
    }
    timer = setTimeout(step, WINDOW_SENSOR_PUMP_MS);
  };
  port.on('message', ({ data }) => {
    if (stopped) return;
    const parsed = windowSensorInput.safeParse(data);
    if (!parsed.success) return fail(WindowSensorFailure.Protocol);
    const message = parsed.data;
    if (message.kind === WindowSensorMessage.Stop) return close();
    if (message.kind === WindowSensorMessage.Ack) {
      if (message.sequence === pending) pending = 0;
      return;
    }
    displays = message.displays;
    revision = message.revision;
    excluded = new Set(message.excluded);
    dirty = true;
    dirtyAt = performance.now();
    if (native) return;
    try {
      native = createNativeWindows(
        () => {
          if (!dirty) dirtyAt = performance.now();
          dirty = true;
        },
        () => excluded,
      );
      step();
    } catch {
      fail(WindowSensorFailure.Native);
    }
  });
  return { close };
}
