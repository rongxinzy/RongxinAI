import { expect } from '@playwright/test';
import path from 'node:path';
import { DESKTOP_PET_BUILTINS } from '../../src/shared/desktopPet/catalog.ts';
import { DesktopPetState } from '../../src/shared/desktopPet/constants.ts';
import { DesktopPetMotion } from '../../src/shared/desktopPet/motionCatalog.ts';

/** Optional real Electron verification; called only with the isolated acceptance app. */
export async function verifyAllMedia(application, main, actor, output) {
  const original = await main.evaluate(() => window.electron.desktopPet.getSettings());
  const results = [];
  await main.evaluate(() => window.electron.desktopPet.setSettings({ chatter: false }));
  await expect(actor.locator('canvas')).toHaveAttribute('data-state', DesktopPetState.Idle, {
    timeout: 30_000,
  });
  try {
    for (const character of DESKTOP_PET_BUILTINS.slice(1)) {
      await main.evaluate(
        characterId => window.electron.desktopPet.setSettings({ characterId }),
        character.id,
      );
      const canvas = actor.locator('canvas');
      await expect(canvas).toHaveAttribute('data-character', character.id);
      await expect(canvas).toHaveAttribute('data-media-clip', DesktopPetMotion.Idle);
      for (const [labels, clip] of [
        [['侧看一眼', 'Peek sideways'], DesktopPetMotion.Peek],
        [['舒展一下', 'Stretch out'], DesktopPetMotion.Flutter],
      ]) {
        await application.evaluate(({ Menu }, labels) => {
          Menu.prototype.popup = function () {
            const item = this.items.find(item => labels.includes(item.label));
            if (!item) throw new Error('Native companion action missing');
            item.click();
          };
        }, labels);
        await actor.evaluate(() => window.desktopPet.menu());
        await expect(canvas).toHaveAttribute('data-media-clip', clip);
        await expect
          .poll(async () => Number(await canvas.getAttribute('data-media-time')))
          .toBeGreaterThan(0.4);
      }
      const decoded = await actor.evaluate(id => {
        const canvas = document.querySelector('canvas');
        const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        return {
          slots: window.acceptanceVideos.length,
          sources: window.acceptanceVideos.filter(video => video.getAttribute('src')).length,
          onlyCurrentCharacter: window.acceptanceVideos
            .filter(video => video.getAttribute('src'))
            .every(video => video.src.includes(`/motion/${id}/`)),
          opaque: pixels.filter((alpha, index) => index % 4 === 3 && alpha > 240).length,
          transparent: pixels.filter((alpha, index) => index % 4 === 3 && alpha === 0).length,
        };
      }, character.id);
      expect(decoded.slots).toBe(2);
      expect(decoded.sources).toBeLessThanOrEqual(2);
      expect(decoded.onlyCurrentCharacter).toBe(true);
      expect(decoded.opaque).toBeGreaterThan(5000);
      expect(decoded.transparent).toBeGreaterThan(10_000);
      await actor.screenshot({
        path: path.join(output, `native-${character.id}.png`),
        omitBackground: true,
      });
      await main.evaluate(() => window.electron.desktopPet.setSettings({ doNotDisturb: true }));
      await expect(canvas).toHaveAttribute('data-visible', 'false');
      expect(
        await actor.evaluate(() =>
          window.acceptanceVideos.every(video => video.paused && !video.getAttribute('src')),
        ),
      ).toBe(true);
      await main.evaluate(() => window.electron.desktopPet.setSettings({ doNotDisturb: false }));
      await expect(canvas).toHaveAttribute('data-media-clip', DesktopPetMotion.Idle);
      results.push({ character: character.id, ...decoded, hiddenReleased: true });
    }
  } finally {
    await main.evaluate(settings => window.electron.desktopPet.setSettings(settings), original);
  }
  return results;
}
