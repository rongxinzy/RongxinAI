import { afterEach, expect, test, vi } from 'vitest';
import { DesktopPetBuiltinId } from '../../shared/desktopPet/catalog';
import { DesktopPetPlayableAction, DesktopPetState } from '../../shared/desktopPet/constants';
import { DesktopPetMotion } from '../../shared/desktopPet/motionCatalog';
import { DesktopPetMediaController } from './mediaController';
import type { DesktopPetMediaClip } from './mediaPack';

// Video decoding has its own real-event tests. Keep poster scheduling controlled.
const videoCallbacks = new WeakMap<
  object,
  { ended(): void; failed(clip: DesktopPetMediaClip): void }
>();
vi.mock('./videoPlayer', () => ({
  PetVideoPlayer: class {
    state = 'loading';
    constructor(options: { ended(): void; failed(clip: DesktopPetMediaClip): void }) {
      videoCallbacks.set(this, options);
    }
    stop = vi.fn();
    play = vi.fn();
    sample() {
      return null;
    }
    dispose() {}
  },
}));

type PendingDecode = { resolve(): void; reject(error: Error): void };
class PosterImage {
  src = '';
  pending: PendingDecode[] = [];
  constructor() {
    images.push(this);
  }
  decode(): Promise<void> {
    return new Promise((resolve, reject) => this.pending.push({ resolve, reject }));
  }
  removeAttribute() {
    this.src = '';
  }
}
const images: PosterImage[] = [];
const controllers: DesktopPetMediaController[] = [];
afterEach(() => {
  controllers.splice(0).forEach(controller => controller.dispose());
  images.length = 0;
  vi.unstubAllGlobals();
});

function fixture() {
  vi.stubGlobal('Image', PosterImage);
  const changed = vi.fn();
  const pack = [
    DesktopPetMotion.Idle,
    DesktopPetMotion.Peek,
    DesktopPetMotion.Nod,
    DesktopPetMotion.Walk,
    DesktopPetMotion.Doze,
    DesktopPetMotion.Wake,
    DesktopPetMotion.Think,
  ].map((id): DesktopPetMediaClip => ({
    id,
    url: `/${id}.webm`,
    maskUrl: `/${id}-mask.png`,
    posterUrl: `/${id}-poster.png`,
    loop: id === DesktopPetMotion.Walk,
  }));
  const controller = new DesktopPetMediaController(changed, () => pack);
  controllers.push(controller);
  controller.update({ characterId: DesktopPetBuiltinId.Xiaoyuan });
  return { controller, changed };
}

test('repeated decoded poster changes retain at most two images and release all sources when hidden', async () => {
  const { controller } = fixture();
  images[0].pending.shift()!.resolve();
  await Promise.resolve();
  for (let index = 0; index < 30; index++) {
    const action = index % 2 ? DesktopPetPlayableAction.Nod : DesktopPetPlayableAction.Peek;
    expect(controller.playAction(action)).toBe(true);
    const pending = images.find(image => image.pending.length > 0)!;
    pending.pending.shift()!.resolve();
    await Promise.resolve();
    expect(controller.sample(0).poster?.src).toBe(`/${action}-poster.png`);
  }
  expect(images).toHaveLength(2);
  controller.update({ visible: false });
  expect(controller.sample(0).poster).toBeUndefined();
  expect(images.every(image => !image.src)).toBe(true);
});

test('the synchronized walk plays once and keeps its last frame until native motion ends', () => {
  const { controller, changed } = fixture();
  const play = vi.mocked(controller.player.play);
  controller.update({ walking: true, walkId: 42 });
  expect(play.mock.lastCall?.[0]).toMatchObject({
    id: DesktopPetMotion.Walk,
    loop: false,
    walkId: 42,
  });
  play.mockClear();
  changed.mockClear();
  videoCallbacks.get(controller.player)!.ended();
  expect(play).not.toHaveBeenCalled();
  expect(changed).toHaveBeenCalledOnce();

  controller.update({ walking: true, walkId: undefined });
  expect(play.mock.lastCall?.[0]).toMatchObject({ id: DesktopPetMotion.Walk, loop: true });
  expect(play.mock.lastCall?.[0].walkId).toBeUndefined();
});

test('explicit sleep holds the Doze frame, releases video and wakes only on leaving sleep', async () => {
  const { controller } = fixture();
  const play = vi.mocked(controller.player.play);
  const stop = vi.mocked(controller.player.stop);
  stop.mockClear();
  controller.update({ state: DesktopPetState.Sleeping });
  expect(play.mock.lastCall?.[0].id).toBe(DesktopPetMotion.Doze);
  videoCallbacks.get(controller.player)!.ended();
  expect(stop).not.toHaveBeenCalled();
  const still = images.find(image => image.src.includes('xiaoyuan-sleep'))!;
  still.pending.pop()!.resolve();
  await Promise.resolve();
  expect(controller.sample(0).poster).toBe(still);
  expect(stop).toHaveBeenCalledOnce();
  expect(play.mock.lastCall?.[0].id).toBe(DesktopPetMotion.Doze);

  play.mockClear();
  controller.update({ visible: false });
  expect(controller.sample(0).poster).toBeUndefined();
  controller.update({ visible: true });
  expect(play).not.toHaveBeenCalled();
  expect(images.some(image => image.src.includes('xiaoyuan-sleep'))).toBe(true);
  controller.update({ state: DesktopPetState.Idle });
  expect(play.mock.lastCall?.[0].id).toBe(DesktopPetMotion.Wake);
});

test('reduced motion uses the sleep still while task state can preempt it', async () => {
  const { controller } = fixture();
  const play = vi.mocked(controller.player.play);
  play.mockClear();
  controller.update({ state: DesktopPetState.Sleeping, reduced: true });
  const still = images.find(image => image.src.includes('xiaoyuan-sleep'))!;
  still.pending.pop()!.resolve();
  await Promise.resolve();
  expect(controller.sample(0).poster).toBe(still);
  expect(play).not.toHaveBeenCalled();

  controller.update({ state: DesktopPetState.Thinking, reduced: false });
  expect(play.mock.lastCall?.[0].id).toBe(DesktopPetMotion.Think);
  expect(controller.sample(0).poster).toBeUndefined();
});

test('a late decode cannot replace a newer poster or restore a hidden poster', async () => {
  const { controller, changed } = fixture();
  images[0].pending.shift()!.resolve();
  await Promise.resolve();
  controller.playAction(DesktopPetPlayableAction.Peek);
  const stale = images[1].pending.shift()!;
  controller.playAction(DesktopPetPlayableAction.Nod);
  const current = images.find(image => image.pending.length > 0)!;
  current.pending.shift()!.resolve();
  await Promise.resolve();
  const calls = changed.mock.calls.length;
  stale.resolve();
  await Promise.resolve();
  expect(controller.sample(0).poster?.src).toBe(`/${DesktopPetMotion.Nod}-poster.png`);
  expect(changed).toHaveBeenCalledTimes(calls);
  controller.playAction(DesktopPetPlayableAction.Peek);
  const hidden = images.find(image => image.pending.length > 0)!.pending.shift()!;
  controller.update({ visible: false });
  hidden.resolve();
  await Promise.resolve();
  expect(controller.sample(0).poster).toBeUndefined();
  expect(images.every(image => !image.src)).toBe(true);
});
