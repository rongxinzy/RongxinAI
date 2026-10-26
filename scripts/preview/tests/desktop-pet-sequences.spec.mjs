import { test, expect } from '@playwright/test';
import { DesktopPetBuiltinId } from '../../../src/shared/desktopPet/catalog.ts';
import { DesktopPetMotion } from '../../../src/shared/desktopPet/motionCatalog.ts';

const characters = ['xiaoyuan', 'youli', 'tuantuan', 'mianmian', 'zhuli', 'yunmo', 'maixiao'];
const states = ['idle', 'thinking', 'waiting', 'completed', 'error', 'greeting'];

test('all twelve source frames have transparent borders without neighboring sprite fragments', async ({
  page,
}) => {
  await page.goto('/desktop-pet.html');
  await expect(page.locator('canvas')).toHaveAttribute('data-character', 'xiaoyuan');
  // This module is loaded by the browser from Vite, not from a Node filesystem root.
  const moduleUrl = new URL('/src/renderer/desktopPet/atlas.ts', page.url()).href;
  const boundaries = await page.evaluate(async atlasModuleUrl => {
    const { DesktopPetAtlas } = await import(atlasModuleUrl);
    const results = [];
    for (const id of ['youli', 'tuantuan', 'mianmian', 'zhuli', 'yunmo', 'maixiao']) {
      const atlas = new DesktopPetAtlas();
      await atlas.select(id);
      const image = atlas.image;
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let crossing = 0;
      for (let index = 0; index < 12; index++) {
        const frame = atlas.frame(index);
        for (let y = frame.y; y < frame.y + frame.height; y++)
          for (let x = frame.x; x < frame.x + frame.width; x++)
            if (
              (x < frame.x + 2 ||
                x >= frame.x + frame.width - 2 ||
                y < frame.y + 2 ||
                y >= frame.y + frame.height - 2) &&
              pixels[(y * canvas.width + x) * 4 + 3] > 64
            )
              crossing++;
      }
      results.push({ id, crossing });
    }
    return results;
  }, moduleUrl);
  expect(boundaries).toEqual(characters.slice(1).map(id => ({ id, crossing: 0 })));
});

async function bridge(page) {
  await page.addInitScript(() => {
    window.petMask = [];
    window.desktopPet = {
      ready() {},
      motion() {},
      dragStart() {},
      dragEnd() {},
      open() {},
      menu() {},
      hitMask(mask) {
        window.petMask = Array.from(mask);
      },
      onState(fn) {
        window.petState = fn;
        return () => {};
      },
      onPose(fn) {
        window.petPose = fn;
        return () => {};
      },
      onEffect(fn) {
        window.petEffect = fn;
        return () => {};
      },
    };
  });
}

for (const colorScheme of ['light', 'dark']) {
  test(`all seven original characters retain task poses with transparent edges in ${colorScheme}`, async ({
    page,
  }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await bridge(page);
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    await page.goto('/desktop-pet.html');
    for (const character of characters) {
      for (const state of states) {
        // The native window receives state changes in place; do not churn 42 HMR connections.
        await page.evaluate(
          ({ characterId, state }) =>
            window.petState({
              characterId,
              state,
              label: 'Companion',
              bubble: null,
              reducedMotion: true,
            }),
          { characterId: character, state },
        );
        const canvas = page.locator('canvas');
        await expect(canvas).toHaveAttribute('data-character', character);
        await expect(canvas).toHaveAttribute('data-state', state);
        const pixels = await canvas.evaluate(element => {
          const data = element.getContext('2d').getImageData(0, 0, 192, 192).data;
          let opaque = 0,
            edge = 0;
          for (let y = 0; y < 192; y++)
            for (let x = 0; x < 192; x++) {
              const alpha = data[(y * 192 + x) * 4 + 3];
              if (alpha > 240) opaque++;
              if ((x === 0 || x === 191 || y === 0 || y === 191) && alpha > 32) edge++;
            }
          return { opaque, edge };
        });
        expect(pixels.opaque).toBeGreaterThan(2500);
        expect(pixels.edge).toBe(0);
      }
    }
    expect(errors).toEqual([]);
  });
}

test('long playback renders multiple beats, stays inside the mask and yields to task failures', async ({
  page,
}) => {
  await bridge(page);
  await page.clock.install();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/desktop-pet.html');
  await expect(page.locator('canvas')).toHaveAttribute('data-character', 'xiaoyuan');
  for (const character of [DesktopPetBuiltinId.Xiaoyuan]) {
    await page.evaluate(
      characterId =>
        window.petState({
          characterId,
          state: 'idle',
          label: 'Companion',
          bubble: null,
          reducedMotion: false,
        }),
      character,
    );
    await expect(page.locator('canvas')).toHaveAttribute('data-character', character);
    await page.evaluate(() => window.petEffect({ kind: 'action', action: 'happy' }));
    const samples = [];
    let elapsed = 0;
    for (const interval of [500, 500, 900, 1600]) {
      elapsed += interval;
      await expect(page.locator('canvas')).toHaveAttribute(
        'data-media-clip',
        DesktopPetMotion.Happy,
      );
      // Browser video time comes from the actual decoder, not an advanced JS test clock.
      await expect
        .poll(async () => Number(await page.locator('canvas').getAttribute('data-media-time')))
        .toBeGreaterThan(elapsed / 1000);
      samples.push(
        await page.locator('canvas').evaluate(canvas => {
          const data = canvas.getContext('2d').getImageData(0, 0, 192, 192).data;
          let missing = 0;
          for (let i = 0; i < 192 * 192; i++)
            if (data[i * 4 + 3] > 64 && window.petMask[i] <= 32) missing++;
          return { image: canvas.toDataURL(), missing };
        }),
      );
    }
    expect(new Set(samples.map(sample => sample.image)).size).toBe(4);
    expect(samples.map(sample => sample.missing)).toEqual([0, 0, 0, 0]);
    await page.evaluate(characterId => {
      window.petState({
        characterId,
        state: 'error',
        label: 'Failed task',
        bubble: 'Failed',
        reducedMotion: false,
      });
      window.petEffect({ kind: 'action', action: 'happy' });
    }, character);
    await page.clock.runFor(200);
    await expect(page.locator('canvas')).toHaveAttribute('data-state', 'error');
    await expect(page.locator('canvas')).toHaveAttribute('data-sequence', '');
    await expect(page.locator('canvas')).toHaveAttribute(
      'data-media-clip',
      DesktopPetMotion.Concern,
    );
    await expect(page.locator('#desktop-pet-bubble')).toHaveText('Failed');
  }
});

test('hidden and reduced-motion windows discard choreography and never replay backlog', async ({
  page,
}) => {
  await bridge(page);
  await page.clock.install();
  await page.goto('/desktop-pet.html');
  await expect(page.locator('canvas')).toHaveAttribute('data-character', 'xiaoyuan');
  await page.evaluate(
    characterId =>
      window.petState({
        characterId,
        state: 'idle',
        label: 'Companion',
        bubble: null,
        reducedMotion: false,
      }),
    DesktopPetBuiltinId.Xiaoyuan,
  );
  await expect(page.locator('canvas')).toHaveAttribute(
    'data-character',
    DesktopPetBuiltinId.Xiaoyuan,
  );
  await page.evaluate(() => window.petEffect({ kind: 'action', action: 'peek' }));
  await expect(page.locator('canvas')).toHaveAttribute('data-media-clip', DesktopPetMotion.Peek);
  await expect
    .poll(async () => Number(await page.locator('canvas').getAttribute('data-media-time')))
    .toBeGreaterThan(0.15);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const frozen = await page.locator('canvas').evaluate(canvas => canvas.toDataURL());
  await page.clock.runFor(60_000);
  expect(await page.locator('canvas').evaluate(canvas => canvas.toDataURL())).toBe(frozen);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.locator('canvas')).toHaveAttribute('data-sequence', '');
  await expect.poll(() => page.locator('canvas').getAttribute('data-media-clip')).toBe('idle');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('canvas')).toHaveAttribute('data-reduced-motion', 'true');
  await page.evaluate(() => window.petEffect({ kind: 'action', action: 'happy' }));
  const still = await page.locator('canvas').evaluate(canvas => canvas.toDataURL());
  await page.clock.runFor(10_000);
  expect(await page.locator('canvas').evaluate(canvas => canvas.toDataURL())).toBe(still);
});

test('native visibility messages stop frames even when Electron reports the document visible', async ({
  page,
}) => {
  await bridge(page);
  await page.clock.install();
  await page.goto('/desktop-pet.html');
  await expect(page.locator('canvas')).toHaveAttribute('data-character', 'xiaoyuan');
  await page.evaluate(() => window.petEffect({ kind: 'action', action: 'happy' }));
  await page.clock.runFor(1000);
  await page.evaluate(() => window.petEffect({ kind: 'visibility', visible: false }));
  expect(await page.evaluate(() => document.hidden)).toBe(false);
  const frozen = await page.locator('canvas').evaluate(canvas => canvas.toDataURL());
  await page.clock.runFor(60_000);
  expect(await page.locator('canvas').evaluate(canvas => canvas.toDataURL())).toBe(frozen);
  await page.evaluate(() => window.petEffect({ kind: 'visibility', visible: true }));
  await expect(page.locator('canvas')).toHaveAttribute('data-sequence', '');
});
