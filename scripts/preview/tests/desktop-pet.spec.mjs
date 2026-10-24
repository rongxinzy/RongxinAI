import { test, expect } from '@playwright/test';

const states = ['idle', 'thinking', 'waiting', 'completed', 'error', 'greeting'];

for (const colorScheme of ['light', 'dark']) {
  test(`desktop companion has six transparent poses in ${colorScheme} mode`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 192, height: 192 });
    for (const state of states) {
      await page.goto(`/desktop-pet.html?state=${state}`);
      const canvas = page.locator('canvas');
      await expect(canvas).toHaveAttribute('data-state', state);
      const pixels = await canvas.evaluate(element => {
        const data = element.getContext('2d').getImageData(0, 0, 192, 192).data;
        let transparent = 0;
        let opaque = 0;
        for (let i = 3; i < data.length; i += 4) {
          if (data[i] === 0) transparent++;
          if (data[i] > 240) opaque++;
        }
        return { transparent, opaque };
      });
      expect(pixels.transparent).toBeGreaterThan(10_000);
      expect(pixels.opaque).toBeGreaterThan(5000);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(192);
      const frozen = await canvas.evaluate(element => element.toDataURL());
      await page.waitForTimeout(100);
      expect(await canvas.evaluate(element => element.toDataURL())).toBe(frozen);
    }
    await page.locator('canvas').click();
    await expect(page.locator('canvas')).toHaveAttribute('data-state', 'greeting');
    await page.emulateMedia({
      colorScheme: colorScheme === 'light' ? 'dark' : 'light',
      reducedMotion: 'reduce',
    });
    await expect(page.locator('canvas')).toHaveAttribute('data-state', 'greeting');
    expect(errors).toEqual([]);
  });
}

test('desktop companion refreshes with animation frames and freezes immediately for reduced motion', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.setViewportSize({ width: 192, height: 192 });
  await page.clock.install();
  await page.addInitScript(() => {
    window.petFrames = 0;
    window.petMasks = [];
    const clear = CanvasRenderingContext2D.prototype.clearRect;
    CanvasRenderingContext2D.prototype.clearRect = function (...args) {
      if (this.canvas.id === 'desktop-pet') window.petFrames++;
      return clear.apply(this, args);
    };
    window.desktopPet = {
      ready() {},
      motion(reduced) {
        window.petReduced = reduced;
      },
      dragStart() {},
      dragEnd() {},
      open() {},
      menu() {},
      hitMask(mask) {
        window.petMasks.push(Array.from(mask));
      },
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
  });
  await page.goto('/desktop-pet.html');
  await expect(page.locator('canvas')).toHaveAttribute('data-state', 'idle');
  const start = await page.evaluate(() => window.petFrames);
  await page.clock.runFor(1000);
  const frames = (await page.evaluate(() => window.petFrames)) - start;
  expect(frames).toBeGreaterThan(50);
  expect(frames).toBeLessThan(70);
  await page.evaluate(() => {
    for (let i = 0; i < 10; i++)
      window.petState({ state: 'thinking', label: '思考', reducedMotion: false });
    window.petEffect({ kind: 'drag', active: true });
  });
  const updated = await page.evaluate(() => window.petFrames);
  await page.clock.runFor(1000);
  expect((await page.evaluate(() => window.petFrames)) - updated).toBeLessThan(70);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const hiddenFrames = await page.evaluate(() => window.petFrames);
  await page.clock.runFor(1000);
  expect(await page.evaluate(() => window.petFrames)).toBe(hiddenFrames);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.evaluate(() => {
    window.petState({ state: 'greeting', label: '挥手', reducedMotion: false });
    window.petEffect({ kind: 'drag', active: false });
    window.petEffect({ kind: 'impact', strength: 1 });
  });
  await page.clock.runFor(80);
  await page.screenshot({ path: '/tmp/zhiyuan-pet-smooth-transition.png', omitBackground: true });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(() => page.evaluate(() => window.petReduced)).toBe(true);
  const frozen = await page.locator('canvas').evaluate(canvas => canvas.toDataURL());
  await page.clock.runFor(500);
  expect((await page.locator('canvas').evaluate(canvas => canvas.toDataURL())) === frozen).toBe(
    true,
  );
  const masks = await page.evaluate(() => window.petMasks);
  expect(masks.length).toBeLessThan(20);
  expect(
    masks.every(mask => mask.length === 192 * 192 && mask[0] === 0 && mask[96 * 192 + 96] > 32),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test.describe('desktop companion on a Retina display', () => {
  test.use({ deviceScaleFactor: 2 });
  test('keeps 192 DIP geometry with a crisp backing canvas', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 192, height: 192 });
    await page.goto('/desktop-pet.html?state=greeting');
    await expect(page.locator('canvas')).toHaveAttribute('data-state', 'greeting');
    const geometry = await page.locator('canvas').evaluate(canvas => ({
      width: canvas.width,
      height: canvas.height,
      logical: canvas.getBoundingClientRect().width,
      overflow: document.documentElement.scrollWidth,
    }));
    expect(geometry).toEqual({ width: 384, height: 384, logical: 192, overflow: 192 });
    await page.screenshot({ path: '/tmp/zhiyuan-pet-smooth-retina.png', omitBackground: true });
    await page.setViewportSize({ width: 1280, height: 800 });
    expect(
      await page.locator('canvas').evaluate(canvas => canvas.getBoundingClientRect().width),
    ).toBe(192);
  });
});
