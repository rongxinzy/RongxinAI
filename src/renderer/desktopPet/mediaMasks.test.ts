import { afterEach, expect, test, vi } from 'vitest';
import { DESKTOP_PET_SIZE } from '../../shared/desktopPet/constants';
import { DesktopPetMediaMasks } from './mediaMasks';
import type { DesktopPetMediaMaskRequest } from './mediaMasks.worker';

vi.mock('./draw', () => ({
  petMediaHitMask: vi.fn(() => new Uint8Array(DESKTOP_PET_SIZE * DESKTOP_PET_SIZE).fill(255)),
}));

class FakeWorker {
  static latest: FakeWorker | undefined;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  requests: DesktopPetMediaMaskRequest[] = [];
  terminate = vi.fn();
  constructor() {
    FakeWorker.latest = this;
  }
  postMessage(request: DesktopPetMediaMaskRequest): void {
    this.requests.push(request);
  }
  respond(index: number): void {
    const request = this.requests[index]!;
    this.onmessage?.({
      data: {
        id: request.id,
        key: request.key,
        mask: new ArrayBuffer(DESKTOP_PET_SIZE * DESKTOP_PET_SIZE),
      },
    } as MessageEvent);
  }
}

const image = (name: string) => ({ src: `https://assets.invalid/${name}.png` }) as HTMLImageElement;

afterEach(() => {
  FakeWorker.latest = undefined;
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

test('synchronous fallback publishes once and reuses the combined cache', () => {
  vi.stubGlobal('Worker', undefined);
  const ready = vi.fn();
  const masks = new DesktopPetMediaMasks(ready);
  expect(masks.get([image('idle')])).toBeUndefined();
  expect(ready).toHaveBeenCalledOnce();
  expect(masks.get([image('idle')])).toBeInstanceOf(Uint8Array);
  expect(ready).toHaveBeenCalledOnce();
  masks.dispose();
});

test('stale worker responses cannot replace the latest clip mask', async () => {
  vi.stubGlobal('Worker', FakeWorker);
  vi.stubGlobal('OffscreenCanvas', class {});
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => ({ close: vi.fn() })),
  );
  const ready = vi.fn();
  const masks = new DesktopPetMediaMasks(ready);
  masks.get([image('idle')]);
  await vi.waitFor(() => expect(FakeWorker.latest?.requests).toHaveLength(1));
  masks.get([image('happy')]);
  await vi.waitFor(() => expect(FakeWorker.latest?.requests).toHaveLength(2));
  FakeWorker.latest!.respond(0);
  expect(ready).not.toHaveBeenCalled();
  FakeWorker.latest!.respond(1);
  expect(ready).toHaveBeenCalledOnce();
  expect(ready.mock.calls[0]![0]).toContain('happy.png');
  masks.dispose();
  expect(FakeWorker.latest!.terminate).toHaveBeenCalledOnce();
});
