import { expect, test } from '@playwright/test';
import {
  DesktopPetState,
  DesktopPetEffectKind,
  DesktopPetPlayableAction,
} from '../../../src/shared/desktopPet/constants.ts';
import {
  DESKTOP_PET_BUILTINS,
  DesktopPetBuiltinId,
} from '../../../src/shared/desktopPet/catalog.ts';
import {
  DesktopPetMotion,
  DESKTOP_PET_MOTIONS,
} from '../../../src/shared/desktopPet/motionCatalog.ts';

async function bridge(page) {
  await page.addInitScript(() => {
    window.mediaVideos = [];
    const create = Document.prototype.createElement;
    Document.prototype.createElement = function (...args) {
      const element = create.apply(this, args);
      if (args[0] === 'video') window.mediaVideos.push(element);
      return element;
    };
    window.desktopPet = {
      ready() {},
      motion() {},
      dragStart() {},
      dragEnd() {},
      menu() {},
      open() {},
      hitMask(mask) {
        window.mediaMask = [...mask];
      },
      onState(listener) {
        window.mediaState = listener;
        return () => {};
      },
      onPose(listener) {
        window.mediaPose = listener;
        return () => {};
      },
      onEffect(listener) {
        window.mediaEffect = listener;
        return () => {};
      },
    };
  });
}
const snapshot = (state, characterId = DesktopPetBuiltinId.Xiaoyuan) => ({
  state,
  characterId,
  label: state,
  reducedMotion: false,
  bubble: null,
});

test('released Xiaoyuan keeps the first-release neutral pixels and never requests the rejected rig', async ({
  page,
}) => {
  const videos = [];
  page.on('request', request => {
    if (request.resourceType() === 'media' && new URL(request.url()).pathname.endsWith('.webm'))
      videos.push(request.url());
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/desktop-pet.html');
  await expect(page.locator('canvas')).toHaveAttribute('data-state', DesktopPetState.Idle);
  const difference = await page.evaluate(async atlasUrl => {
    const { DesktopPetAtlas } = await import(atlasUrl);
    const atlas = new DesktopPetAtlas();
    await atlas.select('xiaoyuan');
    const expected = document.createElement('canvas');
    expected.width = expected.height = 192;
    expected.getContext('2d').drawImage(atlas.image, 0, 0, 512, 512, 0, 0, 192, 192);
    const pixels = expected.getContext('2d').getImageData(0, 0, 192, 192).data;
    const actual = document
      .querySelector('canvas')
      .getContext('2d')
      .getImageData(0, 0, 192, 192).data;
    return actual.reduce((count, value, index) => count + Number(value !== pixels[index]), 0);
  }, new URL('/src/renderer/desktopPet/atlas.ts', page.url()).href);
  expect(difference).toBe(0);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(page.locator('canvas')).toHaveAttribute('data-media-clip', DesktopPetMotion.Idle);
  expect(videos.length).toBeGreaterThan(0);
  expect(videos.every(url => url.includes('/motion/xiaoyuan-original/'))).toBe(true);
});

test('continuous owl media decodes real frames with alpha and two owned slots', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await bridge(page);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/desktop-pet.html');
  const canvas = page.locator('canvas');
  await expect(canvas).toHaveAttribute('data-media-clip', DesktopPetMotion.Idle);
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-media-time')))
    .toBeGreaterThan(0.15);
  const before = await canvas.evaluate(canvas => canvas.toDataURL());
  await expect.poll(() => canvas.evaluate(canvas => canvas.toDataURL())).not.toBe(before);
  const alpha = await canvas.evaluate(canvas => {
    const context = canvas.getContext('2d');
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let transparent = 0,
      opaque = 0;
    for (let i = 3; i < pixels.length; i += 4) {
      if (pixels[i] === 0) transparent++;
      if (pixels[i] > 240) opaque++;
    }
    return { transparent, opaque };
  });
  expect(alpha.transparent).toBeGreaterThan(10_000);
  expect(alpha.opaque).toBeGreaterThan(5000);
  expect(await page.evaluate(() => window.mediaVideos.length)).toBe(2);
  const mask = await page.evaluate(() => window.mediaMask);
  expect(mask).toHaveLength(192 * 192);
  expect(mask[0]).toBe(0);
  expect(mask[96 * 192 + 96]).toBeGreaterThan(32);
  const drawModuleUrl = new URL('/src/renderer/desktopPet/draw.ts', page.url()).href;
  await expect
    .poll(() =>
      page.evaluate(async moduleUrl => {
        const { petMediaHitMask } = await import(moduleUrl);
        const image = new Image();
        image.src = '/src/renderer/assets/desktop-pet/motion/xiaoyuan-original/idle-mask.png';
        await image.decode();
        const expected = petMediaHitMask([image]);
        return expected.reduce(
          (count, value, index) => count + Number(value > 32 && window.mediaMask[index] <= 32),
          0,
        );
      }, drawModuleUrl),
    )
    .toBe(0);
  await canvas.screenshot({ path: '/tmp/companion-continuous-owl.png', omitBackground: true });
  expect(errors).toEqual([]);
});

for (const character of DESKTOP_PET_BUILTINS.map(pet => ({
  id: pet.id,
  directory: `${pet.id}-original`,
}))) {
  test(`${character.id}: all authored clips decode transparent content at their real middle frame`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/desktop-pet.html');
    const clips = DESKTOP_PET_MOTIONS.map(clip => ({
      id: clip.id,
      url: new URL(
        `/src/renderer/assets/desktop-pet/motion/${character.directory}/${clip.id}.webm`,
        page.url(),
      ).href,
    }));
    const results = await page.evaluate(async clips => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 192;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      const video = document.createElement('video');
      video.muted = true;
      const results = [];
      for (const clip of clips) {
        try {
          const loaded = new Promise((resolve, reject) => {
            video.onloadeddata = resolve;
            video.onerror = reject;
          });
          video.src = clip.url;
          video.load();
          await loaded;
          const seeked = new Promise(resolve =>
            video.addEventListener('seeked', resolve, { once: true }),
          );
          video.currentTime = video.duration / 2;
          await seeked;
          context.clearRect(0, 0, 192, 192);
          context.drawImage(video, 0, 0, 192, 192);
          const rgba = context.getImageData(0, 0, 192, 192).data;
          let edge = 0,
            transparent = 0,
            opaque = 0;
          for (let y = 0; y < 192; y++)
            for (let x = 0; x < 192; x++) {
              const alpha = rgba[(y * 192 + x) * 4 + 3];
              if (alpha === 0) transparent++;
              if (alpha > 240) opaque++;
              if (x === 0 || y === 0 || x === 191 || y === 191) edge = Math.max(edge, alpha);
            }
          results.push({
            id: clip.id,
            width: video.videoWidth,
            height: video.videoHeight,
            duration: video.duration,
            edge,
            transparent,
            opaque,
          });
        } finally {
          video.pause();
          video.removeAttribute('src');
          video.load();
        }
      }
      return results;
    }, clips);
    expect(results).toHaveLength(24);
    for (const result of results) {
      expect(result.width, result.id).toBe(512);
      expect(result.height, result.id).toBe(512);
      expect(result.duration, result.id).toBeGreaterThanOrEqual(3);
      expect(result.edge, result.id).toBe(0);
      expect(result.transparent, result.id).toBeGreaterThan(10_000);
      expect(result.opaque, result.id).toBeGreaterThan(4000);
    }
  });
}

test('all seven original characters switch without retaining another identity in the two video slots', async ({
  page,
}) => {
  await bridge(page);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/desktop-pet.html');
  const canvas = page.locator('canvas');
  for (const character of DESKTOP_PET_BUILTINS.slice(1)) {
    await page.evaluate(
      value => window.mediaState(value),
      snapshot(DesktopPetState.Idle, character.id),
    );
    await expect(canvas).toHaveAttribute('data-character', character.id);
    await expect(canvas).toHaveAttribute('data-media-clip', DesktopPetMotion.Idle);
    await page.evaluate(
      action => window.mediaEffect({ kind: 'action', action }),
      DesktopPetPlayableAction.Happy,
    );
    await expect(canvas).toHaveAttribute('data-media-clip', DesktopPetMotion.Happy);
    for (const [state, clip] of [
      [DesktopPetState.Error, DesktopPetMotion.Concern],
      [DesktopPetState.Waiting, DesktopPetMotion.Wait],
      [DesktopPetState.Thinking, DesktopPetMotion.Think],
    ]) {
      await page.evaluate(value => window.mediaState(value), snapshot(state, character.id));
      await expect(canvas).toHaveAttribute('data-state', state);
      await expect(canvas).toHaveAttribute('data-media-clip', clip);
      await page.evaluate(
        action => window.mediaEffect({ kind: 'action', action }),
        DesktopPetPlayableAction.Flutter,
      );
      await expect(canvas).toHaveAttribute('data-media-clip', clip);
      await expect(canvas).toHaveAttribute('data-sequence', '');
    }
    await page.evaluate(
      kind => window.mediaEffect({ kind, visible: false }),
      DesktopPetEffectKind.Visibility,
    );
    expect(
      await page.evaluate(() =>
        window.mediaVideos.every(video => video.paused && !video.getAttribute('src')),
      ),
    ).toBe(true);
    await page.evaluate(
      value => window.mediaState(value),
      snapshot(DesktopPetState.Completed, character.id),
    );
    await page.evaluate(
      kind => window.mediaEffect({ kind, visible: true }),
      DesktopPetEffectKind.Visibility,
    );
    await expect(canvas).toHaveAttribute('data-state', DesktopPetState.Completed);
    await expect(canvas).toHaveAttribute('data-media-clip', DesktopPetMotion.Happy);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(canvas).toHaveAttribute('data-reduced-motion', 'true');
    expect(
      await page.evaluate(() =>
        window.mediaVideos.every(video => video.paused && !video.getAttribute('src')),
      ),
    ).toBe(true);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await expect(canvas).toHaveAttribute('data-media-clip', DesktopPetMotion.Happy);
    expect(await page.evaluate(() => window.mediaVideos.length)).toBe(2);
    expect(
      await page.evaluate(
        id =>
          window.mediaVideos
            .filter(video => video.getAttribute('src'))
            .every(video => video.src.includes(`/motion/${id}/`)),
        `${character.id}-original`,
      ),
    ).toBe(true);
  }
});

test('task failure interrupts celebration and hiding releases media without replaying its backlog', async ({
  page,
}) => {
  await bridge(page);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/desktop-pet.html');
  const canvas = page.locator('canvas');
  await expect(canvas).toHaveAttribute('data-media-clip', DesktopPetMotion.Idle);
  await page.evaluate(
    action => window.mediaEffect({ kind: 'action', action }),
    DesktopPetPlayableAction.Happy,
  );
  await expect(canvas).toHaveAttribute('data-media-clip', DesktopPetMotion.Happy);
  await page.evaluate(value => window.mediaState(value), snapshot(DesktopPetState.Error));
  await expect(canvas).toHaveAttribute('data-state', DesktopPetState.Error);
  await expect(canvas).toHaveAttribute('data-media-clip', DesktopPetMotion.Concern);
  await expect(canvas).toHaveAttribute('data-sequence', '');
  await page.evaluate(
    action => window.mediaEffect({ kind: 'action', action }),
    DesktopPetPlayableAction.Flutter,
  );
  await expect(canvas).toHaveAttribute('data-media-clip', DesktopPetMotion.Concern);
  await page.evaluate(
    kind => window.mediaEffect({ kind, visible: false }),
    DesktopPetEffectKind.Visibility,
  );
  expect(
    await page.evaluate(() =>
      window.mediaVideos.every(video => video.paused && !video.getAttribute('src')),
    ),
  ).toBe(true);
  await page.evaluate(value => window.mediaState(value), snapshot(DesktopPetState.Thinking));
  expect(
    await page.evaluate(() => window.mediaVideos.every(video => !video.getAttribute('src'))),
  ).toBe(true);
  await page.evaluate(
    kind => window.mediaEffect({ kind, visible: true }),
    DesktopPetEffectKind.Visibility,
  );
  await expect(canvas).toHaveAttribute('data-state', DesktopPetState.Thinking);
  await expect(canvas).toHaveAttribute('data-media-clip', DesktopPetMotion.Think);
  expect(await page.evaluate(() => window.mediaVideos.length)).toBe(2);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(canvas).toHaveAttribute('data-reduced-motion', 'true');
  expect(
    await page.evaluate(() =>
      window.mediaVideos.every(video => video.paused && !video.getAttribute('src')),
    ),
  ).toBe(true);
  const frozen = await canvas.evaluate(canvas => canvas.toDataURL());
  await page.waitForTimeout(250);
  expect(await canvas.evaluate(canvas => canvas.toDataURL())).toBe(frozen);
});

test('reduced motion never requests a video and invalid media leaves a visible static character', async ({
  page,
}) => {
  const requests = [];
  page.on('request', request => {
    if (request.resourceType() === 'media' && new URL(request.url()).pathname.endsWith('.webm'))
      requests.push(request.url());
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/desktop-pet.html');
  await expect(page.locator('canvas')).toHaveAttribute('data-state', DesktopPetState.Idle);
  expect(requests).toEqual([]);
  await page.route('**/*.webm', route =>
    route.fulfill({ status: 200, contentType: 'video/webm', body: 'invalid media fixture' }),
  );
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(page.locator('canvas')).toHaveAttribute('data-media-state', 'failed');
  expect(
    await page.locator('canvas').evaluate(canvas => {
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      return pixels.some((alpha, index) => index % 4 === 3 && alpha > 240);
    }),
  ).toBe(true);
});
