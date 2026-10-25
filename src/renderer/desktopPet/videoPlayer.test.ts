import { afterEach, expect, test, vi } from 'vitest';
import { DesktopPetMotion } from '../../shared/desktopPet/motionCatalog';
import { DesktopPetBuiltinId } from '../../shared/desktopPet/catalog';
import { DesktopPetPlayableAction, DesktopPetState } from '../../shared/desktopPet/constants';
import { DesktopPetMediaController } from './mediaController';
import { PetVideoPlayer, PetVideoState } from './videoPlayer';
import type { DesktopPetMediaClip } from './mediaPack';

class FakeVideo extends EventTarget {
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
class FakeImage {
  src = '';
  decode = vi.fn(async () => {});
  removeAttribute() {
    this.src = '';
  }
}
const cleanup: (() => void)[] = [];
afterEach(() => {
  cleanup.splice(0).forEach(dispose => dispose());
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const clip = (id: DesktopPetMotion): DesktopPetMediaClip => ({
  id,
  url: `/${id}.webm`,
  maskUrl: `/${id}-mask.png`,
  posterUrl: `/${id}-poster.png`,
  loop: false,
});
function fixture() {
  const videos: FakeVideo[] = [];
  const images: FakeImage[] = [];
  const changed = vi.fn(),
    ended = vi.fn(),
    failed = vi.fn();
  const player = new PetVideoPlayer({
    changed,
    ended,
    failed,
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
  const ready = async (slot: number) => {
    videos[slot].dispatchEvent(new Event('loadeddata'));
    await vi.waitFor(() => expect(videos[slot].callbacks.size).toBe(1));
    videos[slot].frame();
    await vi.waitFor(() => expect(player.state).toBe(PetVideoState.Playing));
  };
  return { player, videos, images, changed, ended, failed, ready };
}

test('does not promote metadata-ready media until play and its first decoded frame succeed', async () => {
  const f = fixture();
  f.player.play(clip(DesktopPetMotion.Idle));
  f.videos[0].dispatchEvent(new Event('loadeddata'));
  await vi.waitFor(() => expect(f.videos[0].callbacks.size).toBe(1));
  expect(f.player.sample(0)).toBeNull();
  expect(f.changed).not.toHaveBeenCalled();
  f.videos[0].frame();
  await vi.waitFor(() => expect(f.player.state).toBe(PetVideoState.Playing));
  expect(f.player.sample(0)?.clip.id).toBe(DesktopPetMotion.Idle);
  expect(f.videos).toHaveLength(2);
});

test('a superseded first-frame callback cannot replace the newest clip', async () => {
  const f = fixture();
  f.player.play(clip(DesktopPetMotion.Idle));
  await f.ready(0);
  f.player.play(clip(DesktopPetMotion.Happy));
  f.videos[1].dispatchEvent(new Event('loadeddata'));
  await vi.waitFor(() => expect(f.videos[1].callbacks.size).toBe(1));
  const stale = [...f.videos[1].callbacks.values()][0];
  f.player.play(clip(DesktopPetMotion.Concern));
  await f.ready(1);
  stale();
  expect(f.player.sample(200)?.clip.id).toBe(DesktopPetMotion.Concern);
  expect(f.failed).not.toHaveBeenCalled();
  expect(f.videos[0].src).toBe('');
});

test('real end is delivered once, while an interrupted old element cannot end the new clip', async () => {
  const f = fixture();
  f.player.play(clip(DesktopPetMotion.Peek));
  await f.ready(0);
  const oldEnd = f.videos[0].onended;
  f.player.play(clip(DesktopPetMotion.Nod));
  await f.ready(1);
  oldEnd?.();
  expect(f.ended).not.toHaveBeenCalled();
  f.videos[1].onended?.();
  f.videos[1].onended?.();
  expect(f.ended).toHaveBeenCalledOnce();
});

test('blocked playback and a missing first frame fail closed and release both decoders', async () => {
  const f = fixture();
  f.videos[0].play.mockRejectedValueOnce(new Error('autoplay denied'));
  f.player.play(clip(DesktopPetMotion.Idle));
  f.videos[0].dispatchEvent(new Event('loadeddata'));
  await vi.waitFor(() => expect(f.failed).toHaveBeenCalledOnce());
  expect(f.player.state).toBe(PetVideoState.Failed);
  expect(f.player.sample(0)).toBeNull();
  expect(f.videos.every(video => video.src === '')).toBe(true);
  expect(f.videos.every(video => video.callbacks.size === 0)).toBe(true);
  vi.useFakeTimers();
  f.player.play(clip(DesktopPetMotion.Nod));
  f.videos[0].dispatchEvent(new Event('loadeddata'));
  await vi.advanceTimersByTimeAsync(8000);
  expect(f.failed).toHaveBeenCalledTimes(2);
  expect(f.videos.every(video => video.src === '')).toBe(true);
});

test('stopping during decoding cancels callbacks without reporting a decode failure', async () => {
  const f = fixture();
  f.player.play(clip(DesktopPetMotion.Idle));
  f.videos[0].dispatchEvent(new Event('loadeddata'));
  await vi.waitFor(() => expect(f.videos[0].callbacks.size).toBe(1));
  const stale = [...f.videos[0].callbacks.values()][0];
  f.player.stop();
  stale();
  await Promise.resolve();
  expect(f.player.state).toBe(PetVideoState.Empty);
  expect(f.changed).not.toHaveBeenCalled();
  expect(f.failed).not.toHaveBeenCalled();
  expect(f.images.every(image => image.src === '')).toBe(true);
});

test('a hung alpha-mask decode cannot hold the pending switch past its timeout', async () => {
  const f = fixture();
  vi.useFakeTimers();
  f.images[0].decode.mockImplementation(() => new Promise(() => {}));
  f.player.play(clip(DesktopPetMotion.Idle));
  f.videos[0].dispatchEvent(new Event('loadeddata'));
  await vi.advanceTimersByTimeAsync(8000);
  expect(f.failed).toHaveBeenCalledOnce();
  expect(f.player.state).toBe(PetVideoState.Failed);
  expect(f.videos.every(video => video.src === '')).toBe(true);
});

test('starved active playback fails after a bounded wait, while recovery clears its timer', async () => {
  const f = fixture();
  f.player.play(clip(DesktopPetMotion.Idle));
  await f.ready(0);
  vi.useFakeTimers();
  f.videos[0].dispatchEvent(new Event('waiting'));
  await vi.advanceTimersByTimeAsync(4000);
  f.videos[0].dispatchEvent(new Event('playing'));
  await vi.advanceTimersByTimeAsync(8000);
  expect(f.failed).not.toHaveBeenCalled();
  f.videos[0].dispatchEvent(new Event('stalled'));
  await vi.advanceTimersByTimeAsync(8000);
  expect(f.failed).toHaveBeenCalledOnce();
  expect(f.player.sample(0)).toBeNull();
});

function controllerFixture() {
  const videos: FakeVideo[] = [];
  vi.stubGlobal('document', {
    createElement: () => {
      const video = new FakeVideo();
      video.auto = true;
      videos.push(video);
      return video;
    },
  });
  vi.stubGlobal('Image', FakeImage);
  const controller = new DesktopPetMediaController(vi.fn());
  cleanup.push(() => controller.dispose());
  const current = () => controller.sample(performance.now()).playing?.clip.id;
  const wait = async (id: DesktopPetMotion) => vi.waitFor(() => expect(current()).toBe(id));
  return { controller, videos, current, wait };
}

test('task attention interrupts an idle action, remains visible through drag and ignores playback requests', async () => {
  const f = controllerFixture();
  f.controller.update({ characterId: DesktopPetBuiltinId.Xiaoyuan });
  await f.wait(DesktopPetMotion.Idle);
  f.controller.playAction(DesktopPetPlayableAction.Happy);
  await f.wait(DesktopPetMotion.Happy);
  f.controller.update({ state: DesktopPetState.Error, dragging: true });
  await f.wait(DesktopPetMotion.Concern);
  f.controller.playAction(DesktopPetPlayableAction.Flutter);
  expect(f.current()).toBe(DesktopPetMotion.Concern);
});

test('hide releases all media and show starts the latest state without replaying its old action', async () => {
  const f = controllerFixture();
  f.controller.update({ characterId: DesktopPetBuiltinId.Xiaoyuan });
  await f.wait(DesktopPetMotion.Idle);
  f.controller.playAction(DesktopPetPlayableAction.Peek);
  await f.wait(DesktopPetMotion.Peek);
  f.controller.update({ visible: false });
  expect(f.videos.every(video => video.src === '')).toBe(true);
  f.controller.update({ state: DesktopPetState.Waiting });
  expect(f.videos.every(video => video.src === '')).toBe(true);
  f.controller.update({ visible: true });
  await f.wait(DesktopPetMotion.Wait);
  expect(f.videos).toHaveLength(2);
});

test('reduced motion never assigns video sources and unknown characters release media', async () => {
  const f = controllerFixture();
  f.controller.update({ characterId: DesktopPetBuiltinId.Xiaoyuan, reduced: true });
  await Promise.resolve();
  expect(f.videos.every(video => video.src === '')).toBe(true);
  f.controller.update({ reduced: false });
  await f.wait(DesktopPetMotion.Idle);
  f.controller.update({ characterId: 'unknown' });
  expect(f.controller.supported).toBe(false);
  expect(f.videos.every(video => video.src === '')).toBe(true);
  expect(f.controller.playAction(DesktopPetPlayableAction.Happy)).toBe(false);
});

test('switching every migrated character cancels old media while retaining two owned slots', async () => {
  const f = controllerFixture();
  for (const characterId of Object.values(DesktopPetBuiltinId)) {
    f.controller.update({ characterId });
    await f.wait(DesktopPetMotion.Idle);
    expect(f.controller.supported).toBe(true);
    expect(f.videos).toHaveLength(2);
    expect(
      f.videos
        .filter(video => video.src)
        .every(video => video.src.includes(`/motion/${characterId}/`)),
    ).toBe(true);
  }
});

test('dozing hands off to wake through actual end events and impacts do not erase task attention', async () => {
  const f = controllerFixture();
  vi.spyOn(Math, 'random').mockReturnValue(0.98);
  f.controller.update({ characterId: DesktopPetBuiltinId.Xiaoyuan });
  await f.wait(DesktopPetMotion.Idle);
  f.videos.find(video => video.onended)?.onended?.();
  await f.wait(DesktopPetMotion.Doze);
  f.videos.find(video => video.onended)?.onended?.();
  await f.wait(DesktopPetMotion.Wake);
  f.controller.impact(0.8);
  await f.wait(DesktopPetMotion.Land);
  f.controller.update({ state: DesktopPetState.Waiting });
  await f.wait(DesktopPetMotion.Wait);
  f.controller.impact(1);
  expect(f.current()).toBe(DesktopPetMotion.Wait);
});
