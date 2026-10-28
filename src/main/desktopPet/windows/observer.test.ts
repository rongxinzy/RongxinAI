import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { BrowserWindow, ForkOptions } from 'electron';
import {
  WindowSensorMessage,
  WindowSurfaceSide,
} from '../../../shared/desktopPet/surfaces/constants';

const runtime = vi.hoisted(() => ({ fork: vi.fn(), children: [] as FakeChild[] }));
vi.mock('electron', () => ({
  app: { getAppPath: () => '/isolated-app' },
  utilityProcess: { fork: runtime.fork },
  screen: {
    getAllDisplays: () => [
      {
        id: 1,
        bounds: { x: 0, y: 0, width: 1000, height: 800 },
        workArea: { x: 0, y: 0, width: 1000, height: 760 },
      },
    ],
    dipToScreenRect: (
      _window: unknown,
      rect: { x: number; y: number; width: number; height: number },
    ) => ({ x: rect.x * 2, y: rect.y * 2, width: rect.width * 2, height: rect.height * 2 }),
  },
}));
import { DesktopWindowObserver } from './observer';

class FakeChild extends EventEmitter {
  pid = 700 + runtime.children.length;
  postMessage = vi.fn();
  kill = vi.fn(() => true);
}
const window = {
  id: 42,
  isDestroyed: () => false,
  getNativeWindowHandle: () => {
    const handle = Buffer.alloc(8);
    handle.writeBigUInt64LE(42n);
    return handle;
  },
} as unknown as BrowserWindow;
const changed = vi.fn();
let observer: DesktopWindowObserver;
function open() {
  observer.setActive(true);
  const child = runtime.children.at(-1)!;
  child.emit('spawn');
  return child;
}
function config(child: FakeChild) {
  return child.postMessage.mock.calls
    .filter(([message]) => message.kind === WindowSensorMessage.Configure)
    .at(-1)![0];
}
function frame(child: FakeChild, sequence = 1, revision = config(child).revision) {
  return {
    kind: WindowSensorMessage.Snapshot,
    revision,
    sequence,
    capturedAt: Date.now(),
    timing: { queueMs: 0, runMs: 1 },
    fullscreenDisplays: [],
    surfaces: [
      {
        owner: 'abc',
        display: '1',
        side: WindowSurfaceSide.Top,
        start: { x: 200, y: 400 },
        end: { x: 800, y: 400 },
        from: 0,
        to: 1,
      },
    ],
  };
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] });
  vi.setSystemTime(10_000);
  runtime.children = [];
  runtime.fork.mockReset().mockImplementation(() => {
    const child = new FakeChild();
    runtime.children.push(child);
    return child;
  });
  changed.mockReset();
  observer = new DesktopWindowObserver(window, changed, 'win32');
});
afterEach(() => {
  observer.dispose();
  for (const child of runtime.children) child.emit('exit', 0);
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

test('only Windows starts a helper, with physical display geometry and no provider environment', () => {
  observer = new DesktopWindowObserver(window, changed, 'darwin');
  observer.setActive(true);
  expect(runtime.fork).not.toHaveBeenCalled();
  observer = new DesktopWindowObserver(window, changed, 'win32');
  vi.stubEnv('ANTHROPIC_API_KEY', 'synthetic-not-a-credential');
  const child = open();
  const options = runtime.fork.mock.calls[0][2] as ForkOptions;
  expect(options.env).not.toHaveProperty('ANTHROPIC_API_KEY');
  expect(config(child).excluded).toEqual(['2a']);
  expect(config(child).displays[0].physical.width).toBe(2000);
  child.emit('message', frame(child));
  expect(observer.snapshot?.surfaces).toHaveLength(1);
  expect(child.postMessage).toHaveBeenLastCalledWith({
    kind: WindowSensorMessage.Ack,
    sequence: 1,
  });
});

test('a display revision acknowledges old frames without applying their obsolete coordinates', () => {
  const child = open();
  const old = frame(child);
  child.emit('message', old);
  observer.configure();
  expect(observer.snapshot).toBeNull();
  child.emit('message', { ...old, sequence: 2 });
  expect(observer.snapshot).toBeNull();
  expect(child.postMessage).toHaveBeenLastCalledWith({
    kind: WindowSensorMessage.Ack,
    sequence: 2,
  });
  child.emit('message', frame(child, 3));
  expect(observer.snapshot?.sequence).toBe(3);
});

test('inactive and disposed owners reject late frames and never overlap a stopping helper', () => {
  const first = open();
  first.emit('message', frame(first));
  observer.setActive(false);
  observer.setActive(true);
  expect(runtime.fork).toHaveBeenCalledTimes(1);
  first.emit('message', frame(first, 2));
  expect(observer.snapshot).toBeNull();
  first.emit('exit', 0);
  expect(runtime.fork).toHaveBeenCalledTimes(2);
  const second = runtime.children[1];
  second.emit('spawn');
  first.emit('message', frame(first, 3));
  expect(observer.snapshot).toBeNull();
  second.emit('message', frame(second));
  expect(observer.snapshot?.sequence).toBe(1);
  observer.dispose();
  second.emit('exit', 0);
  vi.advanceTimersByTime(60_000);
  expect(runtime.fork).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
});

test('unknown frame fields fail closed, preserve no title/content, and retries have a fixed budget', () => {
  let child = open();
  for (let attempt = 0; attempt < 3; attempt++) {
    const bad = { ...frame(child), title: 'must not enter the main projection' };
    child.emit('message', bad);
    expect(observer.snapshot).toBeNull();
    expect(child.postMessage).toHaveBeenLastCalledWith({ kind: WindowSensorMessage.Stop });
    child.emit('exit', 1);
    vi.advanceTimersByTime(3000);
    if (attempt < 2) {
      child = runtime.children.at(-1)!;
      child.emit('spawn');
    }
  }
  vi.advanceTimersByTime(60_000);
  expect(runtime.fork).toHaveBeenCalledTimes(3);
});

test('a stale snapshot cannot support the pet and an unresponsive helper is terminated', () => {
  const child = open();
  child.emit('message', { ...frame(child), capturedAt: Date.now() - 2000 });
  expect(observer.snapshot).toBeNull();
  vi.advanceTimersByTime(3001);
  expect(child.postMessage).toHaveBeenLastCalledWith({ kind: WindowSensorMessage.Stop });
  vi.advanceTimersByTime(250);
  expect(child.kill).toHaveBeenCalledOnce();
});
