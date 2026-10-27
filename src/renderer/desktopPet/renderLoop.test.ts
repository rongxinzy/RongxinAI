import { afterEach, expect, test, vi } from 'vitest';
import { DesktopPetRenderLoop } from './renderLoop';

const raf = new Map<number, () => void>();
let nextRaf = 0;

function animationFrame(callback: () => void): number {
  const id = ++nextRaf;
  raf.set(id, callback);
  return id;
}

function fakeVideo() {
  const callbacks = new Map<number, () => void>();
  let next = 0;
  return {
    callbacks,
    requestVideoFrameCallback: vi.fn((callback: () => void) => {
      const id = ++next;
      callbacks.set(id, callback);
      return id;
    }),
    cancelVideoFrameCallback: vi.fn((id: number) => {
      callbacks.delete(id);
    }),
    frame(index = 0) {
      const callback = [...callbacks.values()][index];
      callbacks.clear();
      callback?.();
    },
  };
}

afterEach(() => {
  raf.clear();
  vi.unstubAllGlobals();
});

test('active media redraws only for decoded video frames', () => {
  vi.stubGlobal('requestAnimationFrame', vi.fn(animationFrame));
  vi.stubGlobal(
    'cancelAnimationFrame',
    vi.fn((id: number) => raf.delete(id)),
  );
  const video = fakeVideo();
  const draw = vi.fn(() => ({ video: video as never as HTMLVideoElement, animate: true }));
  const loop = new DesktopPetRenderLoop(draw);
  loop.refresh();
  loop.refresh();
  expect(draw).toHaveBeenCalledTimes(2);
  expect(video.callbacks.size).toBe(1);
  expect(raf.size).toBe(0);
  video.frame();
  expect(draw).toHaveBeenCalledTimes(3);
  expect(video.callbacks.size).toBe(1);
  loop.dispose();
  expect(video.cancelVideoFrameCallback).toHaveBeenCalled();
});

test('clip switches cancel the old video callback without catch-up', () => {
  vi.stubGlobal('requestAnimationFrame', vi.fn(animationFrame));
  vi.stubGlobal(
    'cancelAnimationFrame',
    vi.fn((id: number) => raf.delete(id)),
  );
  const first = fakeVideo();
  const second = fakeVideo();
  let current = first;
  const draw = vi.fn(() => ({ video: current as never as HTMLVideoElement, animate: true }));
  const loop = new DesktopPetRenderLoop(draw);
  loop.refresh();
  current = second;
  loop.refresh();
  expect(first.callbacks.size).toBe(0);
  first.frame();
  expect(draw).toHaveBeenCalledTimes(2);
  second.frame();
  expect(draw).toHaveBeenCalledTimes(3);
  loop.dispose();
});

test('procedural animation uses rAF while a static frame stops scheduling', () => {
  vi.stubGlobal('requestAnimationFrame', vi.fn(animationFrame));
  vi.stubGlobal(
    'cancelAnimationFrame',
    vi.fn((id: number) => raf.delete(id)),
  );
  let animate = true;
  const draw = vi.fn(() => ({ video: null, animate }));
  const loop = new DesktopPetRenderLoop(draw);
  loop.refresh();
  expect(raf.size).toBe(1);
  const callback = [...raf.values()][0]!;
  raf.clear();
  animate = false;
  callback();
  expect(draw).toHaveBeenCalledTimes(2);
  expect(raf.size).toBe(0);
  loop.dispose();
});
