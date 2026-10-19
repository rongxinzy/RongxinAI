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
