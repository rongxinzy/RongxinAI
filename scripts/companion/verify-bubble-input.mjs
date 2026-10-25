import { _electron as electron } from 'playwright';
import { expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { CompanionCapability } from '../../src/shared/companion/constants.ts';
import { startCompanionModelFixture } from './task-model-fixture.mjs';

// Manual acceptance against an isolated Electron app. No external model requests.
// CDP uses Chromium's IME composition path; it does not drive the OS candidate UI.
const root = fileURLToPath(new URL('../..', import.meta.url));
const userData = await fs.mkdtemp('/tmp/companion-input-native-');
const port = Number(process.env.PREVIEW_PORT ?? 5194);
const bundledRenderer = process.env.COMPANION_INPUT_BUNDLED === '1';
const { server, requestKinds } = await startCompanionModelFixture();
const env = {
  ...process.env,
  NODE_ENV: 'development',
  ELECTRON_START_URL: `http://127.0.0.1:${port}`,
  ZHIYUAN_MEMORY_LEAK_TEST_USER_DATA: userData,
};
delete env.ELECTRON_RUN_AS_NODE;
let application;
let cdp;
try {
  application = await electron.launch({ args: ['.'], cwd: root, env, timeout: 60_000 });
  const main = await application.firstWindow();
  main.setDefaultTimeout(15_000);
  await main.context().addInitScript(() => {
    window.nativeReadyFocusWallTime = null;
    const ready = () => {
      const input = document.activeElement;
      if (
        window.nativeReadyFocusWallTime === null &&
        location.pathname.endsWith('/companion.html') &&
        document.hasFocus() &&
        input instanceof HTMLTextAreaElement &&
        !input.disabled
      )
        window.nativeReadyFocusWallTime = Date.now();
    };
    window.addEventListener('focus', ready, true);
    document.addEventListener('focusin', ready, true);
  });
  await main.getByTestId('sidebar-new-conversation').waitFor({ timeout: 60_000 });
  expect(application.windows().some(page => page.url().includes('companion.html'))).toBe(false);
  await main.evaluate(async port => {
    await window.electron.magpie.start();
    await window.electron.magpie.setSubscriptionAccounts(false);
    await window.electron.magpie.saveProvider({
      id: 'aaa-input-fixture',
      name: 'Isolated input fixture',
      api: 'openai-completions',
      baseUrl: `http://127.0.0.1:${port}/v1`,
      models: ['fixture-model'],
    });
    const catalog = await window.electron.magpie.catalog();
    const model = catalog.models.find(model => model.id.includes('fixture-model'));
    if (!model) throw new Error('Local input fixture model not found');
    await window.electron.magpie.selectDefault(model.id);
    await window.electron.desktopPet.setSettings({ enabled: true, roaming: false, chatter: false });
  }, server.address().port);
  const closeSettings = main.getByRole('button', { name: /^(关闭|Close)$/ });
  if (await closeSettings.isVisible()) await closeSettings.click();
  await main.getByTestId('sidebar-new-conversation').click();
  await expect(main.getByRole('textbox')).toBeFocused();
  await main.getByRole('textbox').fill('Keep the workbench draft while using the pet');
  await expect
    .poll(() => application.windows().some(page => page.url().includes('desktop-pet.html')))
    .toBe(true);
  const pet = application.windows().find(page => page.url().includes('desktop-pet.html'));
  await pet.locator('canvas').waitFor();
  const openStarted = performance.now();
  const openStartedWallTime = Date.now();
  const prepared = application.windows().find(page => page.url().includes('companion.html'));
  const opened = prepared
    ? Promise.resolve(prepared)
    : application.waitForEvent('window', { timeout: 15_000 });
  await pet.locator('canvas').click({ position: { x: 96, y: 96 } });
  const bubble = await opened;
  bubble.setDefaultTimeout(15_000);
  const input = bubble.getByRole('textbox');
  await expect(input).toBeFocused();
  await input.pressSequentially('a');
  await expect(input).toHaveValue('a');
  const firstOpenMs = performance.now() - openStarted;
  const readyWallTime = await bubble.evaluate(() => window.nativeReadyFocusWallTime);
  expect(readyWallTime).toBeGreaterThanOrEqual(openStartedWallTime);
  const firstInputReadyMs = readyWallTime - openStartedWallTime;
  expect(firstInputReadyMs).toBeLessThanOrEqual(firstOpenMs + 2);
  const visible = () =>
    application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find(window => window.webContents.getURL().includes('companion.html'))
        .isVisible(),
    );
  const hide = async () => {
    await input.press('Escape');
    await expect.poll(visible).toBe(false);
  };
  const reopen = async () => {
    await pet.locator('canvas').click({ position: { x: 96, y: 96 } });
    await expect(input).toBeFocused();
  };
  const warmOpenMs = [];
  for (let index = 0; index < 30; index++) {
    await hide();
    const started = performance.now();
    await reopen();
    await input.pressSequentially('a');
    await expect(input).toHaveValue('a'.repeat(index + 2));
    warmOpenMs.push(performance.now() - started);
  }
  console.log(JSON.stringify({ firstOpenMs, warmOpenMs, userData }));
  const bootstrap = await bubble.evaluate(() => window.companion.bootstrap());
  expect(bootstrap.availability.capability).toBe(CompanionCapability.Chat);
  expect(bootstrap.conversation.messages).toEqual([]);
  cdp = await bubble.context().newCDPSession(bubble);
  await bubble.evaluate(() => {
    window.nativeInputEvents = [];
    window.nativeInputSubmits = 0;
    const input = document.querySelector('textarea');
    for (const type of ['compositionstart', 'compositionupdate', 'compositionend', 'keydown']) {
      input.addEventListener(type, event => {
        window.nativeInputEvents.push({
          type,
          key: event.key,
          keyCode: event.keyCode,
          isComposing: event.isComposing,
          data: event.data,
        });
      });
    }
    input.form.addEventListener('submit', () => window.nativeInputSubmits++);
  });
  const compose = text =>
    cdp.send('Input.imeSetComposition', {
      text,
      selectionStart: text.length,
      selectionEnd: text.length,
    });
  const key = async (key, code) => {
    for (const type of ['keyDown', 'keyUp'])
      await cdp.send('Input.dispatchKeyEvent', {
        type,
        key,
        code: key,
        windowsVirtualKeyCode: code,
      });
  };
  const modeResults = [];
  for (const mode of ['chat', 'task']) {
    if (mode === 'task')
      await bubble.getByRole('tab', { name: /^(交代任务|Give a task)$/ }).click();
    await input.fill('');
    await input.focus();
    await bubble.evaluate(() => {
      window.nativeInputEvents = [];
      window.nativeInputSubmits = 0;
    });
    await compose('小远');
    await expect(input).toHaveValue('小远');
    await key('Enter', 13);
    expect(await bubble.evaluate(() => window.nativeInputSubmits)).toBe(0);
    await expect(bubble.getByRole('alert')).toHaveCount(0);
    await compose('');
    await compose('候选词');
    await expect(input).toHaveValue('候选词');
    await key('Escape', 27);
    expect(await visible()).toBe(true);
    expect(await bubble.evaluate(() => window.nativeInputSubmits)).toBe(0);
    await cdp.send('Input.insertText', { text: '确认输入' });
    await expect(input).toHaveValue('确认输入');
    const events = await bubble.evaluate(() => window.nativeInputEvents);
    expect(events.some(event => event.type === 'compositionstart')).toBe(true);
    expect(events.some(event => event.type === 'compositionend')).toBe(true);
    expect(
      events.find(event => event.type === 'keydown' && event.key === 'Enter')?.isComposing,
    ).toBe(true);
    expect(
      events.find(event => event.type === 'keydown' && event.key === 'Escape')?.isComposing,
    ).toBe(true);
    await hide();
    await reopen();
    await expect(input).toHaveValue('确认输入');
    await input.fill('第一行');
    await input.press('Shift+Enter');
    await input.pressSequentially('第二行');
    await expect(input).toHaveValue('第一行\n第二行');
    expect(await bubble.evaluate(() => window.nativeInputSubmits)).toBe(0);
    modeResults.push({ mode, events, committedDraftSurvivesHide: true, shiftEnterAddsLine: true });
  }
  await bubble.getByRole('tab', { name: /^(聊天|Chat)$/ }).click();
  await input.fill('Native shared conversation，确认输入。');
  await input.press('Enter');
  await expect(bubble.getByText('Native companion reply is shared', { exact: true })).toBeVisible();
  expect(requestKinds.filter(request => request.kind === 'companion-chat')).toHaveLength(1);
  const admitted = await bubble.evaluate(() => window.companion.bootstrap());
  expect(admitted.conversation.messages).toHaveLength(2);
  expect(admitted.conversation.messages[0].text).toBe('Native shared conversation，确认输入。');
  await main.evaluate(() => window.electron.magpie.deleteProvider('aaa-input-fixture'));
  await expect
    .poll(
      async () =>
        (await bubble.evaluate(() => window.companion.bootstrap())).availability.capability,
    )
    .toBe(CompanionCapability.Local);
  await bubble.evaluate(() => {
    window.nativeInputSubmits = 0;
  });
  await input.fill('没有模型时保留这条草稿。');
  await input.press('Enter');
  await expect(bubble.getByRole('alert')).toContainText(/内容已保留|draft is saved/);
  await expect(input).toHaveValue('没有模型时保留这条草稿。');
  expect(await bubble.evaluate(() => window.nativeInputSubmits)).toBe(1);
  await hide();
  await reopen();
  await expect(input).toHaveValue('没有模型时保留这条草稿。');
  const after = await bubble.evaluate(() => window.companion.bootstrap());
  expect(after.conversation.messages).toEqual(admitted.conversation.messages);
  await expect(main.getByRole('textbox')).toHaveText(
    'Keep the workbench draft while using the pet',
  );
  const sorted = [...warmOpenMs].sort((a, b) => a - b);
  const warmP95Ms = sorted[Math.ceil(sorted.length * 0.95) - 1];
  const result = {
    userData,
    platform: process.platform,
    environment: bundledRenderer
      ? 'production renderer over loopback, isolated development shell, automation round trip included'
      : 'development Vite, isolated user data, automation round trip included',
    bundledRenderer,
    preparedBeforeFirstClick: Boolean(prepared),
    firstOpenMs,
    firstInputReadyMs,
    readyTimingSource: 'focused enabled textarea event, host and renderer wall clocks',
    firstInputTargetMet: firstInputReadyMs <= 200,
    warmOpenMs,
    warmP95Ms,
    warmTargetMs: 200,
    warmTargetMet: warmP95Ms <= 200,
    modeResults,
    singleCommittedChatRoundTrip: true,
    localModelRequests: requestKinds.length,
    unavailableModelKeepsDraft: true,
    noDurableMessageAdmittedWhenUnavailable: true,
    workbenchDraftSeparate: true,
    operatingSystemCandidateWindow: 'not verified',
    productionStartupLatency: 'not verified',
  };
  await fs.writeFile(path.join(userData, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} catch (error) {
  console.error(error);
  for (const [index, page] of (application?.windows() ?? []).entries()) {
    if (!page.url().startsWith(`http://127.0.0.1:${port}/`)) continue;
    await page
      .screenshot({ path: path.join(userData, `failure-${index}.png`), timeout: 3000 })
      .catch(() => {});
    if (page.url().includes('companion.html'))
      console.log(
        JSON.stringify({ inputEvents: await page.evaluate(() => window.nativeInputEvents) }),
      );
    console.log(JSON.stringify({ index, url: page.url(), userData }));
  }
  throw error;
} finally {
  await cdp?.detach().catch(() => {});
  await application?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
