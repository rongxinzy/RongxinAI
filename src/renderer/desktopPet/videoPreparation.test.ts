import { expect, test, vi } from 'vitest';
import { DesktopPetMotion } from '../../shared/desktopPet/motionCatalog';
import { clip, fixture } from '../../../tests/fixtures/desktopPetVideo';
import { PetVideoState } from './videoPlayer';

test('a decoded successor stays paused offscreen until the real end, then reuses its first frame', async () => {
  const f = fixture();
  const next = clip(DesktopPetMotion.Wake);
  f.player.play(clip(DesktopPetMotion.Doze));
  await f.ready(0);
  f.player.prepare(next);
  await f.decode(1);
  expect(f.player.sample(0)?.clip.id).toBe(DesktopPetMotion.Doze);
  expect(f.player.state).toBe(PetVideoState.Playing);
  expect(f.started).toHaveBeenCalledTimes(1);
  expect(f.videos[1].pause).toHaveBeenCalled();
  expect(f.videos[1].play).toHaveBeenCalledTimes(1);
  f.ended.mockImplementation(() => f.player.play(next, true));
  f.videos[0].onended?.();
  await vi.waitFor(() => expect(f.player.sample(0)?.clip.id).toBe(DesktopPetMotion.Wake));
  expect(f.videos[1].callbacks.size).toBe(0);
  expect(f.videos[1].play).toHaveBeenCalledTimes(2);
  expect(f.started).toHaveBeenCalledTimes(2);
  expect(f.player.sample(0)?.previous?.video).toBe(f.videos[0]);
  expect(f.player.sample(120)?.previous).toBeUndefined();
  expect(f.videos[0].src).toBe('');
  expect(f.videos).toHaveLength(2);
});

test('an end during preparation adopts the same load instead of restarting or losing the end', async () => {
  const f = fixture();
  const next = clip(DesktopPetMotion.Nod);
  f.player.play(clip(DesktopPetMotion.Idle));
  await f.ready(0);
  f.player.prepare(next);
  f.videos[1].dispatchEvent(new Event('loadeddata'));
  await vi.waitFor(() => expect(f.videos[1].callbacks.size).toBe(1));
  const decode = [...f.videos[1].callbacks.values()][0];
  f.ended.mockImplementation(() => f.player.play(next, true));
  f.videos[0].onended?.();
  expect(f.ended).toHaveBeenCalledOnce();
  expect(f.player.state).toBe(PetVideoState.Loading);
  expect([...f.videos[1].callbacks.values()]).toEqual([decode]);
  f.videos[1].frame();
  await vi.waitFor(() => expect(f.player.sample(0)?.clip.id).toBe(DesktopPetMotion.Nod));
  expect(f.videos[1].play).toHaveBeenCalledOnce();
});

test('preparation waits for the outgoing crossfade slot and never allocates a third decoder', async () => {
  const f = fixture();
  f.player.play(clip(DesktopPetMotion.Idle));
  await f.ready(0);
  f.player.play(clip(DesktopPetMotion.Nod));
  await f.ready(1);
  f.player.prepare(clip(DesktopPetMotion.Idle));
  expect(f.videos[0].src).toBe('/idle.webm');
  expect(f.videos[0].callbacks.size).toBe(0);
  expect(f.player.sample(100)?.previous?.video).toBe(f.videos[0]);
  f.player.sample(120);
  await f.decode(0);
  expect(f.player.sample(150)?.clip.id).toBe(DesktopPetMotion.Nod);
  expect(f.videos).toHaveLength(2);
  expect(f.failed).not.toHaveBeenCalled();
});

test('a task expression cancels speculative decoding and ignores its late frame', async () => {
  const f = fixture();
  f.player.play(clip(DesktopPetMotion.Idle));
  await f.ready(0);
  f.player.prepare(clip(DesktopPetMotion.Happy));
  f.videos[1].dispatchEvent(new Event('loadeddata'));
  await vi.waitFor(() => expect(f.videos[1].callbacks.size).toBe(1));
  const stale = [...f.videos[1].callbacks.values()][0];
  f.player.stop();
  f.player.play(clip(DesktopPetMotion.Concern));
  await f.ready(0);
  stale();
  await Promise.resolve();
  expect(f.player.sample(0)?.clip.id).toBe(DesktopPetMotion.Concern);
  expect(f.videos[1].src).toBe('');
  expect(f.failed).not.toHaveBeenCalled();
});

test('a failed speculative load leaves the current action intact and actual playback retains its error path', async () => {
  const f = fixture();
  f.player.play(clip(DesktopPetMotion.Idle));
  await f.ready(0);
  f.player.prepare(clip(DesktopPetMotion.Nod));
  f.videos[1].dispatchEvent(new Event('error'));
  await vi.waitFor(() => expect(f.videos[1].src).toBe(''));
  expect(f.player.sample(0)?.clip.id).toBe(DesktopPetMotion.Idle);
  expect(f.player.state).toBe(PetVideoState.Playing);
  expect(f.failed).not.toHaveBeenCalled();
  f.player.play(clip(DesktopPetMotion.Nod));
  f.videos[1].dispatchEvent(new Event('error'));
  await vi.waitFor(() => expect(f.failed).toHaveBeenCalledOnce());
  expect(f.player.state).toBe(PetVideoState.Failed);
  expect(f.videos.every(video => !video.src)).toBe(true);
});

test('hiding releases a prepared successor and a late resume cannot bring it back', async () => {
  const f = fixture();
  f.player.play(clip(DesktopPetMotion.Idle));
  await f.ready(0);
  f.player.prepare(clip(DesktopPetMotion.Nod));
  await f.decode(1);
  let resume!: () => void;
  f.videos[1].play.mockImplementationOnce(
    () =>
      new Promise<void>(resolve => {
        resume = resolve;
      }),
  );
  f.player.play(clip(DesktopPetMotion.Nod));
  f.player.stop();
  resume();
  await Promise.resolve();
  expect(f.player.state).toBe(PetVideoState.Empty);
  expect(f.player.sample(0)).toBeNull();
  expect(f.videos.every(video => !video.src)).toBe(true);
  expect(f.images.every(image => !image.src)).toBe(true);
});

test('a prepared video that cannot resume still reaches the bounded static fallback', async () => {
  const f = fixture();
  f.player.play(clip(DesktopPetMotion.Idle));
  await f.ready(0);
  f.player.prepare(clip(DesktopPetMotion.Nod));
  await f.decode(1);
  f.videos[1].play.mockImplementationOnce(() => new Promise(() => {}));
  vi.useFakeTimers();
  f.player.play(clip(DesktopPetMotion.Nod));
  await vi.advanceTimersByTimeAsync(8000);
  expect(f.player.state).toBe(PetVideoState.Failed);
  expect(f.failed).toHaveBeenCalledOnce();
  expect(f.player.sample(0)).toBeNull();
  expect(f.videos.every(video => !video.src)).toBe(true);
});

test('preparing another clip does not suppress a failure of the visible action', async () => {
  const f = fixture();
  f.player.play(clip(DesktopPetMotion.Idle));
  await f.ready(0);
  f.player.prepare(clip(DesktopPetMotion.Nod));
  f.videos[1].dispatchEvent(new Event('loadeddata'));
  await vi.waitFor(() => expect(f.videos[1].callbacks.size).toBe(1));
  const stale = [...f.videos[1].callbacks.values()][0];
  f.videos[0].dispatchEvent(new Event('error'));
  stale();
  await Promise.resolve();
  expect(f.failed).toHaveBeenCalledWith(clip(DesktopPetMotion.Idle));
  expect(f.player.state).toBe(PetVideoState.Failed);
  expect(f.player.sample(0)).toBeNull();
  expect(f.videos.every(video => !video.src)).toBe(true);
  expect(f.ended).not.toHaveBeenCalled();
});
