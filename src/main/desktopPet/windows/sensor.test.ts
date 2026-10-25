import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { WindowSensorMessage } from '../../../shared/desktopPet/surfaces/constants';
import { WindowSensorFailure } from './constants';
const native = vi.hoisted(() => ({
  sample: vi.fn(),
  pump: vi.fn(),
  close: vi.fn(),
  changed: () => {},
}));
vi.mock('./native', () => ({
  createNativeWindows: (changed: () => void) => {
    native.changed = changed;
    return native;
  },
}));
import { startWindowSensor, type WindowSensorPort } from './sensor';

const config = {
  kind: WindowSensorMessage.Configure,
  revision: 1,
  excluded: ['2a'],
  displays: [
    {
      id: '1',
      dip: { x: 0, y: 0, width: 1920, height: 1080 },
      physical: { x: 0, y: 0, width: 1920, height: 1080 },
      workArea: { x: 0, y: 0, width: 1920, height: 1040 },
    },
  ],
};
let receive: (event: { data: unknown }) => void;
const postMessage = vi.fn();
const finished = vi.fn();
let sensor: ReturnType<typeof startWindowSensor>;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(10_000);
  native.sample.mockReset().mockReturnValue({
    foreground: 'abc',
    windows: [{ id: 'abc', rect: { x: 300, y: 400, width: 600, height: 500 }, attachable: true }],
  });
  native.pump.mockReset();
  native.close.mockReset();
  postMessage.mockReset();
  finished.mockReset();
  const port: WindowSensorPort = {
    postMessage,
    on: (_event, listener) => {
      receive = listener;
    },
  };
  sensor = startWindowSensor(port, finished);
});
afterEach(() => {
  sensor.close();
  vi.useRealTimers();
});

test('unacknowledged native frames coalesce instead of growing a queue', () => {
  receive({ data: config });
  expect(native.sample).toHaveBeenCalledOnce();
  native.changed();
  vi.advanceTimersByTime(10_000);
  expect(native.sample).toHaveBeenCalledOnce();
  expect(postMessage).toHaveBeenCalledOnce();
  receive({ data: { kind: WindowSensorMessage.Ack, sequence: 99 } });
  vi.advanceTimersByTime(32);
  expect(native.sample).toHaveBeenCalledOnce();
  receive({ data: { kind: WindowSensorMessage.Ack, sequence: 1 } });
  vi.advanceTimersByTime(16);
  expect(native.sample).toHaveBeenCalledTimes(2);
  expect(postMessage.mock.calls[1][0].sequence).toBe(2);
  expect(postMessage.mock.calls[1][0].timing.queueMs).toBeGreaterThanOrEqual(0);
});

test('configuration changes cannot mix a new monitor layout with an old frame receipt', () => {
  receive({ data: config });
  receive({ data: { ...config, revision: 2 } });
  expect(postMessage).toHaveBeenCalledOnce();
  receive({ data: { kind: WindowSensorMessage.Ack, sequence: 1 } });
  vi.advanceTimersByTime(16);
  expect(postMessage.mock.calls[1][0].revision).toBe(2);
  expect(postMessage.mock.calls[1][0].sequence).toBe(2);
});

test('native failures report a bounded code and release callbacks and timers once', () => {
  receive({ data: config });
  native.pump.mockImplementationOnce(() => {
    throw new Error('private native detail');
  });
  vi.advanceTimersByTime(16);
  expect(postMessage).toHaveBeenLastCalledWith({
    kind: WindowSensorMessage.Failed,
    code: WindowSensorFailure.Native,
  });
  expect(native.close).toHaveBeenCalledOnce();
  expect(finished).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
  receive({ data: { kind: WindowSensorMessage.Stop } });
  expect(finished).toHaveBeenCalledOnce();
});

test('unexpected parent payloads never become native inputs', () => {
  receive({ data: { ...config, title: 'not part of this protocol' } });
  expect(native.sample).not.toHaveBeenCalled();
  expect(postMessage).toHaveBeenLastCalledWith({
    kind: WindowSensorMessage.Failed,
    code: WindowSensorFailure.Protocol,
  });
  expect(finished).toHaveBeenCalledOnce();
});
