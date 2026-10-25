import { expect, test } from '@playwright/test';
import { DesktopPetState, DesktopPetEffectKind } from '../../../src/shared/desktopPet/constants.ts';
import { DesktopPetMotion } from '../../../src/shared/desktopPet/motionCatalog.ts';
import { attachConsoleGuards } from '../shared/harness.mjs';

async function openPet(page, random = 0.7) {
  await page.addInitScript(random => {
    Math.random = () => random;
    window.petVideos = [];
    window.petEnds = [];
    const create = Document.prototype.createElement;
    Document.prototype.createElement = function (...args) {
      const element = create.apply(this, args);
      if (args[0] === 'video') {
        window.petVideos.push(element);
        element.addEventListener('ended', () => {
          window.petEnds.push({ at: performance.now(), src: element.src });
        });
      }
      return element;
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
        window.petState = listener;
        return () => {};
      },
      onPose() {
        return () => {};
      },
      onEffect(listener) {
        window.petEffect = listener;
        return () => {};
      },
    };
  }, random);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/desktop-pet.html');
  await expect(page.locator('canvas')).toHaveAttribute('data-media-clip', DesktopPetMotion.Idle);
}

async function prepared(page, id) {
  await expect
    .poll(() =>
      page.evaluate(
        id =>
          window.petVideos.some(
            video =>
              video.src.endsWith(`/${id}.webm`) &&
              video.paused &&
              video.readyState >= 2 &&
              video.currentTime < 0.15,
          ),
        id,
      ),
    )
    .toBe(true);
}

test('the spare slot decodes ahead of a real end even with delayed media delivery', async ({
  page,
}) => {
  const failures = [];
  attachConsoleGuards(page, failures, 'prepared handoff');
  await page.route('**/*.webm', async route => {
    await new Promise(resolve => setTimeout(resolve, 500));
    await route.continue();
  });
  await openPet(page);
  await prepared(page, DesktopPetMotion.Idle);
  expect(await page.evaluate(() => window.petEnds)).toEqual([]);
  const result = await page.evaluate(async () => {
    const active = window.petVideos.find(video => !video.paused);
    const next = window.petVideos.find(video => video.paused);
    active.playbackRate = 4;
    const endedAt = await new Promise(resolve =>
      active.addEventListener('ended', () => resolve(performance.now()), { once: true }),
    );
    await new Promise(resolve => {
      function sample() {
        if (!next.paused && Number(document.querySelector('canvas').dataset.mediaTime) < 0.15)
          resolve();
        else requestAnimationFrame(sample);
      }
      requestAnimationFrame(sample);
    });
    return {
      gapMs: performance.now() - endedAt,
      slots: window.petVideos.length,
      oldPaused: active.paused,
    };
  });
  expect(result.slots).toBe(2);
  expect(result.oldPaused).toBe(true);
  // At least 500ms of fixture delivery happens before the end, not in this gap.
  expect(result.gapMs).toBeLessThan(150);
  test.info().annotations.push({ type: 'handoff', description: JSON.stringify(result) });
  await page
    .locator('canvas')
    .screenshot({ path: '/tmp/xiaoyuan-prepared-handoff.png', omitBackground: true });
  expect(failures).toEqual([]);
});

test('sleep preloads wake and hands off only after the authored sleep ending', async ({ page }) => {
  const failures = [];
  attachConsoleGuards(page, failures, 'sleep handoff');
  await openPet(page, 0.98);
  await prepared(page, DesktopPetMotion.Doze);
  await page.evaluate(() => {
    window.petVideos.find(video => !video.paused).playbackRate = 8;
  });
  await expect(page.locator('canvas')).toHaveAttribute('data-media-clip', DesktopPetMotion.Doze);
  await prepared(page, DesktopPetMotion.Wake);
  await expect(page.locator('canvas')).toHaveAttribute('data-media-clip', DesktopPetMotion.Doze);
  await page.evaluate(() => {
    window.petVideos.find(video => !video.paused).playbackRate = 8;
  });
  await expect(page.locator('canvas')).toHaveAttribute('data-media-clip', DesktopPetMotion.Wake);
  expect(
    await page.evaluate(() => window.petEnds.some(event => event.src.endsWith('/doze.webm'))),
  ).toBe(true);
  expect(await page.evaluate(() => window.petVideos.length)).toBe(2);
  expect(failures).toEqual([]);
});

test('task attention, hiding and reduced motion discard speculative idle media', async ({
  page,
}) => {
  const failures = [];
  attachConsoleGuards(page, failures, 'attention during preparation');
  await openPet(page, 0.98);
  await prepared(page, DesktopPetMotion.Doze);
  await page.evaluate(
    state =>
      window.petState({
        state,
        characterId: 'xiaoyuan',
        label: state,
        reducedMotion: false,
        bubble: null,
      }),
    DesktopPetState.Error,
  );
  await expect(page.locator('canvas')).toHaveAttribute('data-media-clip', DesktopPetMotion.Concern);
  expect(
    await page.evaluate(() =>
      window.petVideos
        .filter(video => video.getAttribute('src'))
        .map(video => new URL(video.src).pathname),
    ),
  ).toEqual([expect.stringContaining('/concern.webm')]);
  await page.evaluate(
    kind => window.petEffect({ kind, visible: false }),
    DesktopPetEffectKind.Visibility,
  );
  expect(
    await page.evaluate(() =>
      window.petVideos.every(video => video.paused && !video.getAttribute('src')),
    ),
  ).toBe(true);
  await page.evaluate(
    state =>
      window.petState({
        state,
        characterId: 'xiaoyuan',
        label: state,
        reducedMotion: false,
        bubble: null,
      }),
    DesktopPetState.Waiting,
  );
  await page.evaluate(
    kind => window.petEffect({ kind, visible: true }),
    DesktopPetEffectKind.Visibility,
  );
  await expect(page.locator('canvas')).toHaveAttribute('data-media-clip', DesktopPetMotion.Wait);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('canvas')).toHaveAttribute('data-reduced-motion', 'true');
  expect(
    await page.evaluate(() =>
      window.petVideos.every(video => video.paused && !video.getAttribute('src')),
    ),
  ).toBe(true);
  expect(await page.evaluate(() => window.petVideos.length)).toBe(2);
  expect(failures).toEqual([]);
});
