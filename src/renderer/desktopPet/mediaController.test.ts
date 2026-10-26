import { afterEach, expect, test, vi } from 'vitest';
import { DesktopPetBuiltinId } from '../../shared/desktopPet/catalog';
import { DesktopPetPlayableAction } from '../../shared/desktopPet/constants';
import { DesktopPetMotion } from '../../shared/desktopPet/motionCatalog';
import { DesktopPetMediaController } from './mediaController';
import type { DesktopPetMediaClip } from './mediaPack';

// Video decoding has its own real-event tests. Keep poster scheduling controlled.
vi.mock('./videoPlayer', () => ({
  PetVideoPlayer: class {
    state = 'loading';
    stop() {}
    play() {}
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
  const pack = [DesktopPetMotion.Idle, DesktopPetMotion.Peek, DesktopPetMotion.Nod].map(
    (id): DesktopPetMediaClip => ({
      id,
      url: `/${id}.webm`,
      maskUrl: `/${id}-mask.png`,
      posterUrl: `/${id}-poster.png`,
      loop: false,
    }),
  );
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
