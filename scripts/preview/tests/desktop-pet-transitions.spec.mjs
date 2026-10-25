import { expect, test } from '@playwright/test';
import {
  DesktopPetEffectKind,
  DesktopPetPlayableAction,
  DesktopPetState,
} from '../../../src/shared/desktopPet/constants.ts';
import { DesktopPetMotion } from '../../../src/shared/desktopPet/motionCatalog.ts';
import { PetOrientation } from '../../../src/shared/desktopPet/surfaces/constants.ts';
import { attachConsoleGuards } from '../shared/harness.mjs';

async function bridge(page) {
  await page.addInitScript(() => {
    window.transitionVideos = [];
    window.transitionDraws = [];
    const create = Document.prototype.createElement;
    Document.prototype.createElement = function (...args) {
      const element = create.apply(this, args);
      if (args[0] === 'video') window.transitionVideos.push(element);
      return element;
    };
    const draw = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (...args) {
      if (this.canvas.id === 'desktop-pet') {
        window.transitionDraws.push({
          video: args[0] instanceof HTMLVideoElement,
          source: args[0].src,
          alpha: this.globalAlpha,
        });
        if (window.transitionDraws.length > 240) window.transitionDraws.shift();
      }
      return draw.apply(this, args);
    };
    window.desktopPet = {
      ready() {},
      motion() {},
      dragStart() {},
      dragEnd() {},
      menu() {},
      open() {},
      hitMask() {},
      onState(listener) {
        window.transitionState = listener;
        return () => {};
      },
      onPose(listener) {
        window.transitionPose = listener;
        return () => {};
      },
      onEffect(listener) {
        window.transitionEffect = listener;
        return () => {};
      },
    };
  });
}

for (const colorScheme of ['light', 'dark']) {
  test(`walking waits for a decoded successor without a static flash in ${colorScheme}`, async ({
    page,
  }) => {
    const failures = [];
    attachConsoleGuards(page, failures, 'pet transition');
    await bridge(page);
    await page.emulateMedia({ colorScheme, reducedMotion: 'no-preference' });
    let release;
    const held = new Promise(resolve => (release = resolve));
    let requested;
    const request = new Promise(resolve => (requested = resolve));
    await page.route('**/walk.webm', async route => {
      requested();
      await held;
      await route.continue();
    });
    try {
      await page.goto('/desktop-pet.html');
      const canvas = page.locator('canvas');
      await expect(canvas).toHaveAttribute('data-media-clip', DesktopPetMotion.Idle);
      await page.evaluate(orientation => {
        window.transitionDraws = [];
        window.transitionPose({ facing: 1, walking: true, orientation });
      }, PetOrientation.Upright);
      await request;
      await expect(canvas).toHaveAttribute('data-media-state', 'loading');
      await expect(canvas).toHaveAttribute('data-media-clip', DesktopPetMotion.Idle);
      const previousTime = Number(await canvas.getAttribute('data-media-time'));
      await expect
        .poll(async () => Number(await canvas.getAttribute('data-media-time')))
        .toBeGreaterThan(previousTime + 0.1);
      const waiting = await page.evaluate(() => ({
        slots: window.transitionVideos.length,
        draws: window.transitionDraws,
      }));
      expect(waiting.slots).toBe(2);
      expect(waiting.draws.length).toBeGreaterThan(2);
      expect(waiting.draws.every(draw => draw.video)).toBe(true);
      release();
      await expect(canvas).toHaveAttribute('data-media-clip', DesktopPetMotion.Walk);
      await expect
        .poll(() =>
          page.evaluate(() =>
            window.transitionDraws.some(
              draw => draw.source.endsWith('/walk.webm') && draw.alpha > 0 && draw.alpha < 1,
            ),
          ),
        )
        .toBe(true);
      await canvas.screenshot({
        path: `/tmp/companion-walk-transition-${colorScheme}.png`,
        omitBackground: true,
      });
      await page.evaluate(orientation => {
        window.transitionDraws = [];
        window.transitionPose({ facing: 1, walking: false, orientation });
      }, PetOrientation.Upright);
      await expect(canvas).toHaveAttribute('data-media-clip', DesktopPetMotion.Idle);
      expect(await page.evaluate(() => window.transitionDraws.every(draw => draw.video))).toBe(
        true,
      );
      expect(await page.evaluate(() => window.transitionVideos.length)).toBe(2);
      expect(failures).toEqual([]);
    } finally {
      release();
    }
  });
}

test('failure cuts away celebration immediately and keeps its expression phase during pose updates', async ({
  page,
}) => {
  const failures = [];
  attachConsoleGuards(page, failures, 'pet attention transition');
  await bridge(page);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/desktop-pet.html');
  const canvas = page.locator('canvas');
  await expect(canvas).toHaveAttribute('data-media-clip', DesktopPetMotion.Idle);
  await page.evaluate(({ kind, action }) => window.transitionEffect({ kind, action }), {
    kind: DesktopPetEffectKind.Action,
    action: DesktopPetPlayableAction.Happy,
  });
  await expect(canvas).toHaveAttribute('data-media-clip', DesktopPetMotion.Happy);
  const immediate = await page.evaluate(state => {
    window.transitionState({
      state,
      characterId: 'xiaoyuan',
      label: 'Task failed',
      reducedMotion: false,
      bubble: null,
    });
    return {
      drawnClip: document.querySelector('canvas').dataset.mediaClip,
      sources: window.transitionVideos.map(video => video.getAttribute('src')),
    };
  }, DesktopPetState.Error);
  expect(immediate.drawnClip).not.toBe(DesktopPetMotion.Happy);
  expect(immediate.sources.every(source => !source || source.endsWith('/concern.webm'))).toBe(true);
  await expect(canvas).toHaveAttribute('data-media-clip', DesktopPetMotion.Concern);
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-media-time')))
    .toBeGreaterThan(0.2);
  const before = Number(await canvas.getAttribute('data-media-time'));
  await page.evaluate(orientation => {
    window.transitionPose({ facing: 1, walking: true, orientation });
    window.transitionPose({ facing: 1, walking: false, orientation });
  }, PetOrientation.Upright);
  await expect(canvas).toHaveAttribute('data-media-state', 'playing');
  await expect(canvas).toHaveAttribute('data-media-clip', DesktopPetMotion.Concern);
  expect(Number(await canvas.getAttribute('data-media-time'))).toBeGreaterThanOrEqual(before);
  expect(await page.evaluate(() => window.transitionVideos.length)).toBe(2);
  expect(failures).toEqual([]);
});
