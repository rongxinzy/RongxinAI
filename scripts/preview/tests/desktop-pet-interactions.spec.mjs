import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 192, height: 232 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    window.petInput = { starts: 0, ends: [], opens: 0, menus: 0 };
    window.desktopPet = {
      ready() {},
      motion() {},
      hitMask() {},
      dragStart() {
        window.petInput.starts++;
      },
      dragEnd(cancelled) {
        window.petInput.ends.push(cancelled);
      },
      open() {
        window.petInput.opens++;
      },
      menu() {
        window.petInput.menus++;
      },
      onState() {
        return () => {};
      },
      onPose() {
        return () => {};
      },
      onEffect() {
        return () => {};
      },
    };
  });
  await page.goto('/desktop-pet.html');
  await expect(page.locator('canvas')).toHaveAttribute('data-state', 'idle');
});

test('single click stays quiet, double click opens once, and right click only requests the menu', async ({
  page,
}) => {
  const canvas = page.locator('canvas');
  await canvas.click();
  expect(await page.evaluate(() => window.petInput)).toEqual({
    starts: 1,
    ends: [false],
    opens: 0,
    menus: 0,
  });
  await canvas.dblclick();
  expect(await page.evaluate(() => window.petInput.opens)).toBe(1);
  await canvas.click({ button: 'right' });
  expect(await page.evaluate(() => window.petInput)).toEqual({
    starts: 3,
    ends: [false, false, false],
    opens: 1,
    menus: 1,
  });
});

test('dragging out and back does not become a chat double click', async ({ page }) => {
  await page.mouse.move(96, 136);
  await page.mouse.down();
  await page.mouse.move(150, 136, { steps: 4 });
  await page.mouse.move(96, 136, { steps: 4 });
  await page.mouse.up();
  await page.locator('canvas').dispatchEvent('dblclick');
  expect(await page.evaluate(() => window.petInput)).toEqual({
    starts: 1,
    ends: [false],
    opens: 0,
    menus: 0,
  });
});

for (const event of ['pointercancel', 'lostpointercapture']) {
  test(`${event} ends the drag once without opening chat`, async ({ page }) => {
    await page.mouse.move(96, 136);
    await page.mouse.down();
    await page.mouse.move(130, 136);
    const canvas = page.locator('canvas');
    await canvas.dispatchEvent(event, { pointerId: 1, screenX: 130, screenY: 136 });
    await page.mouse.up();
    await canvas.dispatchEvent('dblclick');
    expect(await page.evaluate(() => window.petInput)).toEqual({
      starts: 1,
      ends: [true],
      opens: 0,
      menus: 0,
    });
  });
}
