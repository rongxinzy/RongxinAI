import { app, screen, utilityProcess, type BrowserWindow, type UtilityProcess } from 'electron';
import path from 'node:path';
import {
  WINDOW_SENSOR_ENTRY,
  WINDOW_SENSOR_STALE_MS,
  WindowSensorMessage,
} from '../../../shared/desktopPet/surfaces/constants';
import type {
  SurfaceDisplay,
  WindowSurfaceSnapshot,
} from '../../../shared/desktopPet/surfaces/types';
import { windowSensorConfig, windowSensorSnapshot, windowSensorError } from './protocol';
import { WindowSensorFailure } from './constants';

interface Child {
  process: UtilityProcess;
  stopping: boolean;
  reported: boolean;
  ready: boolean;
  startedAt: number;
  startup?: ReturnType<typeof setTimeout>;
  health?: ReturnType<typeof setTimeout>;
  shutdown?: ReturnType<typeof setTimeout>;
}

/** One utility process, one unacknowledged frame; the main process owns every Electron API. */
export class DesktopWindowObserver {
  private child: Child | undefined;
  private wanted = false;
  private disposed = false;
  private retries = 0;
  private retry?: ReturnType<typeof setTimeout>;
  private revision = 0;
  private sequence = 0;
  private displays = new Set<string>();
  private value: WindowSurfaceSnapshot | null = null;

  constructor(
    private readonly window: BrowserWindow,
    private readonly changed: (snapshot: WindowSurfaceSnapshot | null) => void,
    private readonly platform: NodeJS.Platform = process.platform,
  ) {}

  get snapshot(): WindowSurfaceSnapshot | null {
    return this.value;
  }

  setActive(active: boolean): void {
    if (this.disposed || this.platform !== 'win32') return;
    if (active === this.wanted) return;
    this.wanted = active;
    clearTimeout(this.retry);
    if (active) {
      this.retries = 0;
      this.start();
    } else {
      this.publish(null);
      this.stop();
    }
  }

  private publish(value: WindowSurfaceSnapshot | null): void {
    this.value = value;
    this.changed(value);
  }

  configure(): void {
    const child = this.child;
    if (!child || child.stopping || this.window.isDestroyed()) return;
    try {
      const displays: SurfaceDisplay[] = screen.getAllDisplays().map(display => ({
        id: String(display.id),
        dip: display.bounds,
        workArea: display.workArea,
        physical: screen.dipToScreenRect(null, display.bounds),
      }));
      const handle = this.window.getNativeWindowHandle();
      if (handle.byteLength !== 8 || handle.readBigUInt64LE() === 0n)
        throw new Error('Unsupported native window handle');
      const config = windowSensorConfig.parse({
        kind: WindowSensorMessage.Configure,
        revision: ++this.revision,
        displays,
        excluded: [handle.readBigUInt64LE().toString(16)],
      });
      this.displays = new Set(displays.map(display => display.id));
      this.publish(null);
      child.process.postMessage(config);
    } catch {
      this.fail(child, WindowSensorFailure.Protocol);
    }
  }

  private start(): void {
    if (!this.wanted || this.disposed || this.child || this.window.isDestroyed()) return;
    try {
      // Do not inherit provider credentials or agent/tool environment into the native helper.
      const root = process.env.SystemRoot ?? '';
      const processChild = utilityProcess.fork(
        path.join(app.getAppPath(), 'dist-electron', WINDOW_SENSOR_ENTRY),
        [],
        {
          serviceName: 'Desktop window surfaces',
          stdio: 'ignore',
          env: {
            SystemRoot: root,
            WINDIR: root,
            PATH: path.win32.join(root, 'System32'),
            TEMP: process.env.TEMP ?? '',
            TMP: process.env.TMP ?? '',
          },
        },
      );
      const child: Child = {
        process: processChild,
        stopping: false,
        reported: false,
        ready: false,
        startedAt: performance.now(),
      };
      this.child = child;
      this.sequence = 0;
      processChild.on('spawn', () => {
        if (this.child === child && !child.stopping) this.configure();
      });
      processChild.on('message', message => this.receive(child, message));
      processChild.on('error', () => this.fail(child, WindowSensorFailure.Native));
      processChild.once('exit', () => this.exited(child));
      child.startup = setTimeout(() => this.fail(child, WindowSensorFailure.Timeout), 5000);
    } catch {
      console.warn(`[WindowSurface] Failed to start sensor for window ${this.window.id}`);
      this.publish(null);
      this.scheduleRetry();
    }
  }

  private receive(child: Child, message: unknown): void {
    if (this.child !== child || child.stopping || !this.wanted) return;
    const failure = windowSensorError.safeParse(message);
    if (failure.success) return this.fail(child, failure.data.code);
    const parsed = windowSensorSnapshot.safeParse(message);
    if (!parsed.success) return this.fail(child, WindowSensorFailure.Protocol);
    const snapshot = parsed.data;
    child.process.postMessage({ kind: WindowSensorMessage.Ack, sequence: snapshot.sequence });
    if (snapshot.revision !== this.revision) return;
    if (
      snapshot.sequence <= this.sequence ||
      snapshot.surfaces.some(surface => !this.displays.has(surface.display)) ||
      snapshot.fullscreenDisplays.some(display => !this.displays.has(display))
    )
      return this.fail(child, WindowSensorFailure.Protocol);
    this.sequence = snapshot.sequence;
    if (!child.ready) {
      child.ready = true;
      console.log(
        `[WindowSurface] Sensor ${child.process.pid ?? 'ready'} became ready after ${Math.round(performance.now() - child.startedAt)} ms with ${snapshot.timing.queueMs.toFixed(1)} ms queued and ${snapshot.timing.runMs.toFixed(1)} ms processing`,
      );
    }
    clearTimeout(child.startup);
    clearTimeout(child.health);
    if (Math.abs(Date.now() - snapshot.capturedAt) > WINDOW_SENSOR_STALE_MS) {
      this.publish(null);
    } else this.publish(snapshot);
    child.health = setTimeout(() => this.fail(child, WindowSensorFailure.Timeout), 3000);
  }

  private fail(child: Child, code: string): void {
    if (this.child !== child || child.stopping) return;
    child.reported = true;
    console.warn(`[WindowSurface] Sensor ${child.process.pid ?? 'starting'} failed with ${code}`);
    this.publish(null);
    this.stop();
  }

  private stop(): void {
    const child = this.child;
    if (!child || child.stopping) return;
    child.stopping = true;
    clearTimeout(child.startup);
    clearTimeout(child.health);
    try {
      child.process.postMessage({ kind: WindowSensorMessage.Stop });
    } catch {
      /* Exiting. */
    }
    child.shutdown = setTimeout(() => child.process.kill(), 250);
  }

  private exited(child: Child): void {
    clearTimeout(child.startup);
    clearTimeout(child.health);
    clearTimeout(child.shutdown);
    if (this.child !== child) return;
    this.child = undefined;
    if (!child.stopping && !child.reported)
      console.warn(`[WindowSurface] Sensor ${child.process.pid ?? 'exited'} exited unexpectedly`);
    this.publish(null);
    if (this.wanted && !this.disposed) {
      if (child.stopping && !child.reported) this.start();
      else this.scheduleRetry();
    }
  }

  private scheduleRetry(): void {
    if (!this.wanted || this.disposed || this.retries >= 2) return;
    this.retry = setTimeout(() => this.start(), 1000 * 2 ** this.retries++);
  }

  dispose(): void {
    this.disposed = true;
    this.wanted = false;
    clearTimeout(this.retry);
    this.publish(null);
    this.stop();
  }
}
