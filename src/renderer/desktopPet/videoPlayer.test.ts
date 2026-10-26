import { expect, test, vi } from 'vitest';
import { DesktopPetMotion } from '../../shared/desktopPet/motionCatalog';
import { DesktopPetBuiltinId } from '../../shared/desktopPet/catalog';
import { DesktopPetPlayableAction, DesktopPetState } from '../../shared/desktopPet/constants';
import { DesktopPetMediaController } from './mediaController';
import { PetVideoState } from './videoPlayer';
import { desktopPetMediaPack } from './mediaPack';
import {
  cleanup,
  clip,
  FakeImage,
  FakeVideo,
  fixture,
} from '../../../tests/fixtures/desktopPetVideo';

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

function controllerFixture(idleOnly = false) {
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
  const controller = new DesktopPetMediaController(
    vi.fn(),
    idleOnly
      ? id => desktopPetMediaPack(id)?.filter(clip => clip.id === DesktopPetMotion.Idle) ?? null
      : undefined,
  );
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

test('walking keeps the decoded outgoing frame until its successor can crossfade', async () => {
  const f = controllerFixture();
  f.controller.update({ characterId: DesktopPetBuiltinId.Xiaoyuan });
  await f.wait(DesktopPetMotion.Idle);
  const outgoing = f.controller.sample(performance.now()).playing!.current.video;
  f.videos.forEach(video => (video.auto = false));
  f.controller.update({ walking: true });
  expect(f.controller.sample(performance.now()).playing?.current.video).toBe(outgoing);
  const pending = f.videos.find(video => video.src.endsWith('/walk.webm'))!;
  pending.dispatchEvent(new Event('loadeddata'));
  await vi.waitFor(() => expect(pending.callbacks.size).toBe(1));
  expect(f.controller.sample(performance.now()).playing?.current.video).toBe(outgoing);
  pending.frame();
  await f.wait(DesktopPetMotion.Walk);
  const handoff = f.controller.sample(performance.now()).playing!;
  expect(handoff.previous?.video).toBe(outgoing);
  expect(handoff.mix).toBeLessThan(1);
  expect(handoff.current.video).toBe(pending);
});

test('unrelated walking and drag changes do not restart a task attention loop', async () => {
  const f = controllerFixture();
  f.controller.update({ characterId: DesktopPetBuiltinId.Xiaoyuan, state: DesktopPetState.Error });
  await f.wait(DesktopPetMotion.Concern);
  const playing = f.controller.sample(performance.now()).playing!.current.video;
  playing.currentTime = 2;
  f.controller.update({ walking: true });
  f.controller.update({ dragging: true });
  const continued = f.controller.sample(performance.now()).playing!;
  expect(continued?.current.video).toBe(playing);
  expect(continued.current.video.currentTime).toBe(2);
  expect(continued.clip.id).toBe(DesktopPetMotion.Concern);
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

test('switching every original character and returning to Xiaoyuan reuses two slots', async () => {
  const f = controllerFixture();
  f.controller.update({ characterId: DesktopPetBuiltinId.Xiaoyuan });
  await f.wait(DesktopPetMotion.Idle);
  for (const characterId of Object.values(DesktopPetBuiltinId)) {
    if (characterId === DesktopPetBuiltinId.Xiaoyuan) continue;
    f.controller.update({ characterId });
    await f.wait(DesktopPetMotion.Idle);
    expect(f.controller.supported).toBe(true);
    expect(f.current()).toBe(DesktopPetMotion.Idle);
    expect(
      f.videos
        .filter(video => video.src)
        .every(video => video.src.includes(`/motion/${characterId}-original/`)),
    ).toBe(true);
  }
  f.controller.update({ characterId: DesktopPetBuiltinId.Xiaoyuan });
  await f.wait(DesktopPetMotion.Idle);
  expect(f.controller.supported).toBe(true);
  expect(f.videos).toHaveLength(2);
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

test('preparation keeps the existing quiet idle beat between randomly chosen actions', async () => {
  const f = controllerFixture();
  const random = vi.spyOn(Math, 'random').mockReturnValue(0.7);
  f.controller.update({ characterId: DesktopPetBuiltinId.Xiaoyuan });
  await f.wait(DesktopPetMotion.Idle);
  expect(random).toHaveBeenCalledTimes(1);
  f.videos[0].onended?.();
  await vi.waitFor(() => expect(f.videos[1].onended).not.toBeNull());
  // Selecting idle is itself a complete beat. It still returns to the quiet
  // base before another draw, rather than doubling the rate of idle gestures.
  expect(random).toHaveBeenCalledTimes(1);
  f.controller.sample(performance.now() + 120);
  f.videos[1].onended?.();
  await vi.waitFor(() => expect(f.videos[0].onended).not.toBeNull());
  expect(random).toHaveBeenCalledTimes(2);
});

test('an idle-only authoring fixture yields to missing pose actions and resumes only at their end', async () => {
  const f = controllerFixture(true);
  f.controller.update({ characterId: DesktopPetBuiltinId.Xiaoyuan });
  await f.wait(DesktopPetMotion.Idle);
  expect(f.controller.playAction(DesktopPetPlayableAction.Happy)).toBe(false);
  expect(f.controller.supported).toBe(false);
  expect(f.videos.every(video => video.src === '')).toBe(true);
  f.controller.finishFallback(true);
  expect(f.current()).toBeUndefined();
  f.controller.finishFallback(false);
  await f.wait(DesktopPetMotion.Idle);
  expect(f.controller.supported).toBe(true);
});

test('an idle-only authoring fixture never lets stale media cover missing task expressions', async () => {
  const f = controllerFixture(true);
  f.controller.update({ characterId: DesktopPetBuiltinId.Xiaoyuan });
  await f.wait(DesktopPetMotion.Idle);
  for (const state of [DesktopPetState.Thinking, DesktopPetState.Waiting, DesktopPetState.Error]) {
    f.controller.update({ state });
    await Promise.resolve();
    expect(f.controller.supported).toBe(false);
    expect(f.controller.playAction(DesktopPetPlayableAction.Happy)).toBe(true);
    expect(f.controller.sample(performance.now())).toMatchObject({
      playing: null,
      poster: undefined,
    });
    expect(f.videos.every(video => video.src === '')).toBe(true);
  }
  f.controller.update({ state: DesktopPetState.Idle });
  await f.wait(DesktopPetMotion.Idle);
});
