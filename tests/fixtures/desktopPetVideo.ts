import { afterEach, expect, vi } from 'vitest';
import type { DesktopPetMotion } from '../../src/shared/desktopPet/motionCatalog';
import type { DesktopPetMediaClip } from '../../src/renderer/desktopPet/mediaPack';
import { PetVideoPlayer, PetVideoState } from '../../src/renderer/desktopPet/videoPlayer';

export class FakeVideo extends EventTarget {
  src = '';
  loop = false;
  muted = false;
  playsInline = false;
  preload = '';
  currentTime = 0;
  onended: (() => void) | null = null;
  callbacks = new Map<number, () => void>();
  nextId = 0;
  auto = false;
  pause = vi.fn();
  play = vi.fn(async () => {});
  load() {
    if (this.auto && this.src) queueMicrotask(() => this.dispatchEvent(new Event('loadeddata')));
  }
  removeAttribute() {
    this.src = '';
  }
  requestVideoFrameCallback(callback: () => void) {
    const id = ++this.nextId;
    this.callbacks.set(id, callback);
    if (this.auto) queueMicrotask(() => this.frame());
    return id;
  }
  cancelVideoFrameCallback(id: number) {
    this.callbacks.delete(id);
  }
  frame() {
    for (const [id, callback] of this.callbacks) {
      this.callbacks.delete(id);
      callback();
    }
  }
}
export class FakeImage {
  src = '';
  decode = vi.fn(async () => {});
  removeAttribute() {
    this.src = '';
  }
}
export const cleanup: (() => void)[] = [];
afterEach(() => {
  cleanup.splice(0).forEach(dispose => dispose());
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

export const clip = (id: DesktopPetMotion): DesktopPetMediaClip => ({
  id,
  url: `/${id}.webm`,
  maskUrl: `/${id}-mask.png`,
  posterUrl: `/${id}-poster.png`,
  loop: false,
});
export function fixture() {
  const videos: FakeVideo[] = [];
  const images: FakeImage[] = [];
  const changed = vi.fn(),
    ended = vi.fn(),
    failed = vi.fn(),
    started = vi.fn();
  const player = new PetVideoPlayer({
    changed,
    ended,
    failed,
    started,
    now: () => 0,
    video: () => {
      const video = new FakeVideo();
      videos.push(video);
      return video as never;
    },
    image: () => {
      const image = new FakeImage();
      images.push(image);
      return image as never;
    },
  });
  cleanup.push(() => player.dispose());
  const decode = async (slot: number) => {
    videos[slot].dispatchEvent(new Event('loadeddata'));
    await vi.waitFor(() => expect(videos[slot].callbacks.size).toBe(1));
    videos[slot].frame();
    await Promise.resolve();
    await Promise.resolve();
  };
  const ready = async (slot: number) => {
    await decode(slot);
    await vi.waitFor(() => expect(player.state).toBe(PetVideoState.Playing));
  };
  return { player, videos, images, changed, ended, failed, started, ready, decode };
}
