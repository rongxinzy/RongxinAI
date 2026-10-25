import { _electron as electron } from 'playwright';
import { expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startCompanionModelFixture } from './task-model-fixture.mjs';
import { createChatMemoryFixture } from './chat-memory-fixture.mjs';
import { stressMedia } from './stress-media.mjs';
import { verifyManagedMemory } from './verify-managed-memory.mjs';
import { DesktopPetMotion } from '../../src/shared/desktopPet/motionCatalog.ts';
import { DESKTOP_PET_CANVAS_TOP } from '../../src/shared/desktopPet/layout.ts';

// Manual acceptance: isolated application storage, synthetic local provider, actual Magpie/Pi/Engram.
const root = fileURLToPath(new URL('../..', import.meta.url));
const userData = await fs.mkdtemp('/tmp/companion-bubble-native-');
const port = Number(process.env.PREVIEW_PORT ?? 5194);
const memoryFixture = createChatMemoryFixture();
const { server, requestKinds } = await startCompanionModelFixture(
  undefined,
  undefined,
  undefined,
  memoryFixture,
);
const env = {
  ...process.env,
  NODE_ENV: 'development',
  ELECTRON_START_URL: `http://127.0.0.1:${port}`,
  ZHIYUAN_MEMORY_LEAK_TEST_USER_DATA: userData,
};
delete env.ELECTRON_RUN_AS_NODE;
let application;
try {
  application = await electron.launch({ args: ['.'], cwd: root, env, timeout: 60_000 });
  const main = await application.firstWindow();
  main.setDefaultTimeout(15_000);
  await main.getByTestId('sidebar-new-conversation').waitFor({ timeout: 60_000 });
  await expect(main.getByTestId('sidebar-view-companion')).toHaveCount(0);
  await expect(main.locator('[data-companion-bubble]')).toHaveCount(0);
  await main.evaluate(async port => {
    await window.electron.magpie.start();
    await window.electron.magpie.setSubscriptionAccounts(false);
    await window.electron.magpie.saveProvider({
      id: 'aaa-bubble-fixture',
      name: 'Isolated bubble fixture',
      api: 'openai-completions',
      baseUrl: `http://127.0.0.1:${port}/v1`,
      models: ['fixture-model'],
    });
    const catalog = await window.electron.magpie.catalog();
    const selected = catalog.models.find(model => model.id.includes('fixture-model'));
    if (!selected) throw new Error('Local fixture model not found');
    await window.electron.magpie.selectDefault(selected.id);
    await window.electron.desktopPet.setSettings({ enabled: true, roaming: false });
  }, server.address().port);
  // First-run model setup can leave the settings sheet open after provider setup.
  const closeSettings = main.getByRole('button', { name: /^(关闭|Close)$/ });
  if (await closeSettings.isVisible()) await closeSettings.click();
  await main.getByTestId('sidebar-new-conversation').click();
  // New-conversation clears and focuses on its deferred UI event. Enter the draft afterward.
  await expect(main.getByRole('textbox')).toBeFocused();
  await main.getByRole('textbox').fill('Keep the workbench draft');
  await expect(main.getByRole('textbox')).toHaveText('Keep the workbench draft');
  await expect
    .poll(() => application.windows().some(page => page.url().includes('desktop-pet.html')))
    .toBe(true);
  const pet = application.windows().find(page => page.url().includes('desktop-pet.html'));
  pet.on('framenavigated', frame => {
    if (frame === pet.mainFrame()) console.log(JSON.stringify({ petNavigation: frame.url() }));
  });
  pet.on('crash', () => console.error('Native pet renderer crashed'));
  await pet.locator('canvas').waitFor();
  if (process.env.COMPANION_MEDIA_STRESS_SECONDS) {
    await pet.addInitScript(() => {
      window.acceptanceVideos = [];
      window.acceptanceCanvases = 0;
      const create = Document.prototype.createElement;
      Document.prototype.createElement = function (...args) {
        const element = create.apply(this, args);
        if (args[0] === 'video') window.acceptanceVideos.push(element);
        if (args[0] === 'canvas') window.acceptanceCanvases++;
        return element;
      };
    });
    await pet.waitForLoadState('load');
    await pet.reload();
  }
  await pet.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(pet.locator('canvas')).toHaveAttribute('data-media-clip', DesktopPetMotion.Idle);
  const prepared = application.windows().find(page => page.url().includes('companion.html'));
  const opened = prepared
    ? Promise.resolve(prepared)
    : application.waitForEvent('window', { timeout: 15_000 });
  // Actual pointer click, not invoking the companion IPC from the workbench.
  await pet.locator('canvas').click({ position: { x: 96, y: 96 } });
  const bubble = await opened;
  const input = bubble.getByRole('textbox');
  await expect(input).toBeFocused();
  await expect(bubble.getByRole('heading')).toHaveClass('sr-only');
  await expect(bubble.locator('.theme-companion-sketch')).toBeVisible();
  await expect(pet.locator('canvas')).toHaveAttribute('data-media-clip', DesktopPetMotion.Wave);
  await expect
    .poll(async () => Number(await pet.locator('canvas').getAttribute('data-media-time')))
    .toBeGreaterThan(2.8);
  await pet.screenshot({
    path: path.join(userData, 'pet-original-wave.png'),
    omitBackground: true,
  });
  await pet.emulateMedia({ reducedMotion: 'reduce' });
  await expect(pet.locator('canvas')).toHaveAttribute('data-media-clip', '');
  const frozenPet = await pet.locator('canvas').evaluate(canvas => canvas.toDataURL());
  await pet.evaluate(() => new Promise(resolve => setTimeout(resolve, 150)));
  expect(await pet.locator('canvas').evaluate(canvas => canvas.toDataURL())).toBe(frozenPet);
  // Pet-media inspection targets another webContents. Start the follow/focus check
  // with an actual click in the bubble, then require movement to retain that focus.
  await input.click();
  await input.fill('A bubble draft survives hiding');
  await expect(input).toBeFocused();
  const bounds = async page =>
    application.evaluate(
      ({ BrowserWindow }, url) =>
        BrowserWindow.getAllWindows()
          .find(window => window.webContents.getURL() === url)
          .getBounds(),
      page.url(),
    );
  const movePet = async point =>
    application.evaluate(
      ({ BrowserWindow }, { url, point }) =>
        BrowserWindow.getAllWindows()
          .find(window => window.webContents.getURL() === url)
          .setPosition(point.x, point.y),
      { url: pet.url(), point },
    );
  const area = await application.evaluate(({ screen }) => screen.getPrimaryDisplay().workArea);
  expect(area.height).toBeGreaterThanOrEqual(680);
  const petSize = await bounds(pet);
  console.log(
    JSON.stringify({
      nativeFollowListeners: await application.evaluate(({ BrowserWindow }, url) => {
        const actor = BrowserWindow.getAllWindows().find(
          window => window.webContents.getURL() === url,
        );
        return { move: actor.listenerCount('move'), resize: actor.listenerCount('resize') };
      }, pet.url()),
    }),
  );
  const bottomPoint = {
    x: area.x + Math.round((area.width - petSize.width) / 2),
    y: area.y + area.height - petSize.height - 24,
  };
  const topPoint = { x: bottomPoint.x, y: area.y + 8 };
  await movePet(bottomPoint);
  console.log(JSON.stringify({ area, pet: await bounds(pet), bubble: await bounds(bubble) }));
  await expect.poll(async () => (await bounds(pet)).y).toBe(bottomPoint.y);
  await expect
    .poll(async () => {
      const position = await bounds(bubble);
      return position.y + position.height + 8 - (await bounds(pet)).y;
    })
    .toBe(DESKTOP_PET_CANVAS_TOP);
  await expect(input).toBeFocused();
  await movePet(topPoint);
  await expect.poll(async () => (await bounds(pet)).y).toBe(topPoint.y);
  await expect
    .poll(async () => {
      const actor = await bounds(pet);
      return (await bounds(bubble)).y - actor.y - actor.height;
    })
    .toBe(8);
  await expect(input).toHaveValue('A bubble draft survives hiding');
  await main.evaluate(() => window.electron.desktopPet.setSettings({ doNotDisturb: true }));
  await expect
    .poll(() =>
      application.evaluate(
        ({ BrowserWindow }, url) =>
          BrowserWindow.getAllWindows()
            .find(window => window.webContents.getURL() === url)
            .isVisible(),
        bubble.url(),
      ),
    )
    .toBe(false);
  await main.evaluate(() => window.electron.desktopPet.setSettings({ doNotDisturb: false }));
  await pet.locator('canvas').click({ position: { x: 96, y: 96 } });
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('A bubble draft survives hiding');
  expect(requestKinds).toHaveLength(0);
  await movePet(bottomPoint);
  const initial = await bubble.evaluate(() => window.companion.bootstrap());
  const a = initial.activePetId;
  expect(initial.profiles).toHaveLength(1);
  expect(initial.profiles[0].personaId).toBe('xiaoyuan');
  expect(
    await bubble.evaluate(async () => {
      try {
        await window.companion.select('hidden-companion');
        return false;
      } catch {
        return true;
      }
    }),
  ).toBe(true);
  const send = async operation => {
    await input.fill(`Native shared conversation: ${operation}`);
    await expect(bubble.getByRole('button', { name: '发送', exact: true })).toBeEnabled();
    await input.press('Enter');
    await expect(input).toHaveValue('');
    await expect.poll(() => memoryFixture.results.length).toBeGreaterThan(send.previous);
    send.previous = memoryFixture.results.length;
    await expect
      .poll(
        async () =>
          (await bubble.evaluate(() => window.companion.bootstrap())).conversation.pending,
      )
      .toBeNull();
  };
  send.previous = 0;
  await send('remember-kite');
  const saved = (await bubble.evaluate(id => window.companion.listMemories(id), a))[0];
  expect(saved.content).toBe('The paper kite is blue.');
  await send('correct-kite');
  const corrected = (await bubble.evaluate(id => window.companion.listMemories(id), a))[0];
  expect(corrected.content).toBe('The paper kite is green.');
  expect(corrected.id).not.toBe(saved.id);
  await send('recall-kite');
  expect(memoryFixture.results.at(-1).result.memories[0].content).toContain('is green');
  await send('forget-kite');
  expect(await bubble.evaluate(id => window.companion.listMemories(id), a)).toEqual([]);
  expect((await main.evaluate(() => window.electron.memory.list({}))).data).toEqual([]);
  await expect(main.getByRole('textbox')).toHaveText('Keep the workbench draft');
  for (const theme of ['light', 'dark']) {
    await main.evaluate(async theme => {
      const config = await window.electron.store.get('app_config');
      await window.electron.store.set('app_config', { ...config, theme });
    }, theme);
    await expect(bubble.locator('html')).toHaveClass(new RegExp(theme));
    await input.fill(theme === 'light' ? '今天想从哪件事开始？' : '陪我把这个想法理一理。');
    await bubble.screenshot({
      path: path.join(userData, `bubble-${theme}.png`),
      omitBackground: true,
    });
  }
  let managedMemory = null;
  if (process.env.COMPANION_VERIFY_MANAGED_MEMORY === '1') {
    await input.press('Escape');
    managedMemory = await verifyManagedMemory(main, userData);
  }
  const mediaStress = process.env.COMPANION_MEDIA_STRESS_SECONDS
    ? await (async () => {
        await pet.emulateMedia({ reducedMotion: 'no-preference' });
        return stressMedia(
          application,
          main,
          pet,
          Number(process.env.COMPANION_MEDIA_STRESS_SECONDS),
        );
      })()
    : null;
  const result = {
    userData,
    platform: process.platform,
    pointerOpensBubble: true,
    animatedGreeting: true,
    reducedMotionFreezes: true,
    anchoredAbove: true,
    flipsBelow: true,
    movementRetainsFocus: true,
    dndHidesBoth: true,
    hidingRetainsDraft: true,
    workbenchSeparate: true,
    privateMemoryTools: true,
    singleReleasedProfile: true,
    rejectsUnavailableProfile: true,
    chatToolsLeaveSharedMemoryUnchanged: true,
    modelRequests: requestKinds.length,
    managedMemory,
    mediaStress,
    actualExternalModelQuality: 'not verified',
    windowsNativeSurfaces: 'not verified',
  };
  await fs.writeFile(path.join(userData, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} catch (error) {
  console.error(error);
  if (application)
    console.log(
      JSON.stringify({
        failedGeometry: await application.evaluate(({ BrowserWindow, screen }) => ({
          displays: screen.getAllDisplays().map(display => display.workArea),
          windows: BrowserWindow.getAllWindows()
            .filter(window => window.webContents.getURL().startsWith('http://127.0.0.1:'))
            .map(window => ({
              path: new URL(window.webContents.getURL()).pathname,
              bounds: window.getBounds(),
              visible: window.isVisible(),
              moveListeners: window.listenerCount('move'),
            })),
        })),
      }),
    );
  for (const [index, page] of (application?.windows() ?? []).entries()) {
    if (!page.url().startsWith(`http://127.0.0.1:${port}/`)) continue;
    await page
      .screenshot({ path: path.join(userData, `failure-${index}.png`), timeout: 3000 })
      .catch(() => {});
    console.log(JSON.stringify({ index, url: page.url(), userData }));
  }
  throw error;
} finally {
  await application?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
