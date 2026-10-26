import { expect, test } from '@playwright/test';
import { DESKTOP_PET_BUILTINS } from '../../../src/shared/desktopPet/catalog.ts';

test('six original-art idle videos preserve the atlas face, silhouette and proportions at actual size', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/desktop-pet.html');
  await expect(page.locator('canvas')).toHaveAttribute('data-character', 'xiaoyuan');
  const results = await page.evaluate(
    async ({ ids, atlasModule, drawModule }) => {
      const { DesktopPetAtlas } = await import(atlasModule);
      const { drawPetPose } = await import(drawModule);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 192;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      const results = [];
      for (const id of ids) {
        const atlas = new DesktopPetAtlas();
        await atlas.select(id);
        context.clearRect(0, 0, 192, 192);
        drawPetPose(context, atlas, 0);
        const original = context.getImageData(0, 0, 192, 192).data;
        const referenceImage = canvas.toDataURL();
        const video = document.createElement('video');
        video.muted = true;
        const loaded = new Promise((resolve, reject) => {
          video.onloadeddata = resolve;
          video.onerror = reject;
        });
        video.src = `/src/renderer/assets/desktop-pet/motion/${id}-original/idle.webm`;
        await loaded;
        const seeked = new Promise(resolve =>
          video.addEventListener('seeked', resolve, { once: true }),
        );
        video.currentTime = 0.001;
        await seeked;
        context.clearRect(0, 0, 192, 192);
        context.drawImage(video, 0, 0, 192, 192);
        const decodedImage = canvas.toDataURL();
        const decoded = context.getImageData(0, 0, 192, 192).data;
        let difference = 0,
          count = 0,
          silhouette = 0;
        for (let pixel = 0; pixel < original.length; pixel += 4) {
          if (original[pixel + 3] > 32 || decoded[pixel + 3] > 32) {
            for (let channel = 0; channel < 3; channel++)
              difference += Math.abs(original[pixel + channel] - decoded[pixel + channel]);
            count += 3;
          }
          if (original[pixel + 3] > 128 !== decoded[pixel + 3] > 128) silhouette++;
        }
        results.push({ id, error: difference / count, silhouette, referenceImage, decodedImage });
        video.removeAttribute('src');
        video.load();
      }
      return results;
    },
    {
      ids: DESKTOP_PET_BUILTINS.slice(1).map(pet => pet.id),
      // Browser-served Vite URLs, not filesystem imports in the Node test runner.
      atlasModule: new URL('/src/renderer/desktopPet/atlas.ts', page.url()).href,
      drawModule: new URL('/src/renderer/desktopPet/draw.ts', page.url()).href,
    },
  );
  for (const result of results) {
    await page.evaluate(({ referenceImage, decodedImage }) => {
      document.body.innerHTML = `<img src="${referenceImage}"><img src="${decodedImage}">`;
    }, result);
    await page.screenshot({ path: `/tmp/pet-original-comparison-${result.id}.png` });
    expect(result.error, result.id).toBeLessThan(12);
    expect(result.silhouette, JSON.stringify(result)).toBeLessThan(300);
  }
  expect(errors).toEqual([]);
});
