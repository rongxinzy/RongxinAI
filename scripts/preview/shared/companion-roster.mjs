import { DESKTOP_PET_BUILTINS } from '../../../src/shared/desktopPet/catalog.ts';

/** Preserve dormant multi-owner UI coverage without any production URL/setting escape hatch. */
export async function useDormantCompanionRoster(page) {
  await page.route('**/src/renderer/companion/main.tsx*', async route => {
    const response = await route.fetch();
    const source = await response.text();
    await route.fulfill({
      response,
      body: `import { createCompanionPreviewApi as testCompanionFactory } from '/src/renderer/companion/previewApi.ts';
window.companion = testCompanionFactory(${JSON.stringify(DESKTOP_PET_BUILTINS.map(pet => pet.id))});
document.documentElement.dataset.companionPreview = 'true';\n${source}`,
    });
  });
}
