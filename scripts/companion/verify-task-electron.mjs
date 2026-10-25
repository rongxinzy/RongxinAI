import { _electron as electron } from 'playwright';
import { expect } from '@playwright/test';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { DesktopPetState } from '../../src/shared/desktopPet/constants.ts';
import { DesktopPetMotion } from '../../src/shared/desktopPet/motionCatalog.ts';
import { WorkbenchRunStatus } from '../../src/shared/workbenchTask/constants.ts';
import { stressMedia } from './stress-media.mjs';
import { verifyHomeSurfaces } from './verify-home-surfaces.mjs';
import { createTaskFileFixture, chooseTaskFile } from './verify-task-files.mjs';
import { verifyWorkbenchCopy } from './verify-workbench-copy.mjs';
import { verifyAllMedia } from './verify-all-media.mjs';
import { verifyCompanionMemory } from './verify-memory.mjs';
import {
  createTaskMemoryFixture,
  approveTaskMemory,
  prepareTaskMemory,
  verifyTaskMemory,
} from './verify-task-memory.mjs';

import { startCompanionModelFixture } from './task-model-fixture.mjs';
import { createMemoryReviewFixture, verifyMemoryReview } from './verify-memory-review.mjs';

// Manual native acceptance only: isolated storage, local model fixture, no real account keys.
// Prerequisites: verified Magpie resource, build:electron:dev and web:preview.
const root = fileURLToPath(new URL('../..', import.meta.url));
const port = Number(process.env.PREVIEW_PORT ?? 5176);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid preview port');
const userData = await fs.mkdtemp('/tmp/companion-task-native-');
const workspace = await fs.mkdtemp('/tmp/companion-task-workspace-');
const fileFixture =
  process.env.COMPANION_VERIFY_FILES === '1' ? await createTaskFileFixture(userData) : null;
const taskMemoryFixture =
  process.env.COMPANION_VERIFY_TASK_MEMORY === '1' ? createTaskMemoryFixture() : null;
const reviewFixture =
  process.env.COMPANION_VERIFY_MEMORY_REVIEW === '1' ? createMemoryReviewFixture() : null;
const modelFixture = await startCompanionModelFixture(
  fileFixture,
  taskMemoryFixture,
  reviewFixture,
);
const { server, requestKinds } = modelFixture;
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
  // Retain only this module's window diagnostics; never dump general app/model logs.
  for (const output of [application.process().stdout, application.process().stderr]) {
    let buffer = '';
    output?.on('data', chunk => {
      buffer = (buffer + chunk.toString()).slice(-8192);
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) if (line.includes('[DesktopPet]')) console.log(line);
    });
  }
  const main = await application.firstWindow();
  await main.getByTestId('sidebar-new-conversation').waitFor({ timeout: 60_000 });
  const configured = await main.evaluate(
    async ({ port, workspace }) => {
      const status = await window.electron.magpie.start();
      if (status.state !== 'running')
        throw new Error(`Fixture gateway did not start: ${JSON.stringify(status)}`);
      await window.electron.magpie.setSubscriptionAccounts(false);
      await window.electron.magpie.saveProvider({
        id: 'aaa-companion-fixture',
        name: 'Isolated companion fixture',
        api: 'openai-completions',
        baseUrl: `http://127.0.0.1:${port}/v1`,
        models: ['fixture-model'],
      });
      const catalog = await window.electron.magpie.catalog();
      const selected = catalog.models.find(model => model.id.includes('fixture-model'));
      if (!selected) throw new Error('Fixture model missing from real gateway catalog');
      await window.electron.magpie.selectDefault(selected.id);
      await window.electron.cowork.ensureWorkspace({
        path: workspace,
        name: 'Isolated task project',
      });
      await window.electron.desktopPet.setSettings({ enabled: true, roaming: false });
      return {
        gateway: { state: catalog.status.state, enabled: catalog.status.enabled },
        selected,
      };
    },
    { port: server.address().port, workspace },
  );
  console.log(JSON.stringify(configured));
  const actor = await application
    .waitForEvent('window', {
      predicate: page => page.url().includes('desktop-pet.html'),
      timeout: 15_000,
    })
    .catch(() => application.windows().find(page => page.url().includes('desktop-pet.html')));
  if (!actor) {
    console.log(
      JSON.stringify({
        userData,
        windows: await application.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows().map(window => ({
            id: window.id,
            url: window.webContents.getURL(),
          })),
        ),
        settings: await main.evaluate(() => window.electron.desktopPet.getSettings()),
      }),
    );
    throw new Error('Native companion actor missing');
  }
  await actor.waitForFunction(() => Boolean(window.desktopPet));
  // The preload exists before loadURL completes. Reloading then aborts the app's own load.
  await actor.waitForLoadState('load');
  await actor.locator('canvas').waitFor();
  await actor.addInitScript(() => {
    window.acceptanceVideos = [];
    const create = Document.prototype.createElement;
    Document.prototype.createElement = function (...args) {
      const element = create.apply(this, args);
      if (args[0] === 'video') window.acceptanceVideos.push(element);
      return element;
    };
  });
  await actor.emulateMedia({ reducedMotion: 'no-preference' });
  await actor.reload();
  await expect(actor.locator('canvas')).toHaveAttribute('data-media-state', 'playing');
  await expect.poll(() => actor.evaluate(() => window.acceptanceVideos.length)).toBe(2);
  await application.evaluate(({ Menu }) => {
    Menu.prototype.popup = function () {
      const item = this.items.find(item => ['聊两句', 'Have a chat'].includes(item.label));
      if (!item) throw new Error('Companion menu item missing');
      item.click();
    };
  });
  const prepared = application.windows().find(page => page.url().includes('companion.html'));
  const opened = prepared
    ? Promise.resolve(prepared)
    : application.waitForEvent('window', { timeout: 15_000 });
  await actor.evaluate(() => window.desktopPet.menu());
  const chat = await opened;
  const taskMemoryAdmission = taskMemoryFixture ? await prepareTaskMemory(chat) : null;
  const home =
    process.env.COMPANION_VERIFY_HOME === '1'
      ? await verifyHomeSurfaces(main, chat, userData)
      : null;
  await chat.getByRole('tab', { name: '交代任务', exact: true }).waitFor();
  await chat.getByRole('tab', { name: '交代任务', exact: true }).click();
  await chat.getByRole('combobox', { name: '工作区', exact: true }).click();
  await chat.getByRole('option', { name: 'Isolated task project', exact: true }).click();
  const attachmentIds = fileFixture
    ? await chooseTaskFile(application, chat, fileFixture, userData)
    : undefined;
  await chat.getByRole('textbox').fill('整理项目资料，并告诉我接下来该做什么。');
  await chat.getByRole('textbox').press('Enter');
  await chat.getByRole('textbox').evaluate(async element => {
    if (element.value !== '') await new Promise(resolve => setTimeout(resolve, 300));
  });
  try {
    await expect
      .poll(async () => (await chat.evaluate(() => window.companion.tasks())).tasks.length, {
        timeout: 30_000,
      })
      .toBe(1);
  } catch (error) {
    console.error(error);
    await chat
      .screenshot({ path: path.join(userData, 'task-rejected.png'), timeout: 3000 })
      .catch(failure => console.warn('Task rejection screenshot unavailable:', failure.message));
    console.log(
      JSON.stringify({
        alerts: await chat.getByRole('alert').allTextContents(),
        state: await chat.evaluate(() => window.companion.bootstrap()),
        requests: modelFixture.requestCount(),
      }),
    );
    throw error;
  }
  const {
    tasks: [task],
  } = await chat.evaluate(() => window.companion.tasks());
  const receipt = task.receipt;
  await expect(actor.locator('canvas')).toHaveAttribute('data-state', DesktopPetState.Thinking);
  await expect(actor.locator('canvas')).toHaveAttribute('data-media-clip', DesktopPetMotion.Think);
  await main.evaluate(() => window.electron.desktopPet.setSettings({ doNotDisturb: true }));
  await expect(actor.locator('canvas')).toHaveAttribute('data-visible', 'false');
  expect(
    await actor.evaluate(() =>
      window.acceptanceVideos.every(video => video.paused && !video.getAttribute('src')),
    ),
  ).toBe(true);
  const taskRequest = await chat.evaluate(
    async ({ receipt, attachmentIds }) => ({
      petId: receipt.petId,
      requestId: receipt.requestId,
      text: '整理项目资料，并告诉我接下来该做什么。',
      workspaceId: (await window.companion.bootstrap()).workspaces.find(
        workspace => workspace.name === 'Isolated task project',
      ).id,
      ...(attachmentIds ? { attachmentIds } : {}),
    }),
    { receipt, attachmentIds },
  );
  const retry = await chat.evaluate(request => window.companion.submitTask(request), taskRequest);
  if (JSON.stringify(retry.receipt) !== JSON.stringify(receipt))
    throw new Error('Receipt changed on retry');
  if (taskMemoryAdmission) await approveTaskMemory(main, chat, receipt);
  await expect
    .poll(
      async () =>
        [
          WorkbenchRunStatus.Succeeded,
          WorkbenchRunStatus.NeedsReview,
          WorkbenchRunStatus.Failed,
        ].includes((await chat.evaluate(() => window.companion.tasks())).tasks[0]?.status),
      { timeout: 90_000 },
    )
    .toBe(true);
  const {
    tasks: [finished],
  } = await chat.evaluate(() => window.companion.tasks());
  if (fileFixture) {
    expect(fileFixture.observed).toBe(true);
    await fs.rm(fileFixture.file);
    expect(
      (await chat.evaluate(request => window.companion.submitTask(request), taskRequest)).receipt,
    ).toEqual(receipt);
  }
  if (finished.status === WorkbenchRunStatus.Failed) {
    const detail = await main.evaluate(
      taskId => window.electron.workbenchTask.getDetail(taskId),
      receipt.taskId,
    );
    throw new Error(
      `Native work run failed: ${JSON.stringify(detail.detail?.runs.map(run => ({ id: run.id, status: run.status, failure: run.failure })))}`,
    );
  }
  expect(
    await actor.evaluate(() => window.acceptanceVideos.every(video => !video.getAttribute('src'))),
  ).toBe(true);
  await main.evaluate(() => window.electron.desktopPet.setSettings({ doNotDisturb: false }));
  await expect(actor.locator('canvas')).toHaveAttribute('data-state', DesktopPetState.Completed);
  await expect(actor.locator('canvas')).toHaveAttribute('data-media-clip', DesktopPetMotion.Happy);
  const media = await actor.evaluate(() => {
    const canvas = document.querySelector('canvas');
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let transparent = 0,
      opaque = 0;
    for (let index = 3; index < pixels.length; index += 4) {
      if (pixels[index] === 0) transparent++;
      if (pixels[index] > 240) opaque++;
    }
    return {
      decoderSlots: window.acceptanceVideos.length,
      clip: canvas.dataset.mediaClip,
      transparent,
      opaque,
      devicePixelRatio: window.devicePixelRatio,
    };
  });
  expect(media.transparent).toBeGreaterThan(10_000);
  expect(media.opaque).toBeGreaterThan(5000);
  expect(media.decoderSlots).toBe(2);
  await actor.screenshot({ path: path.join(userData, 'motion-window.png'), omitBackground: true });
  // DND hides the bubble too; lifting DND must not reopen it without user intent.
  expect(
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find(window => window.webContents.getURL().includes('companion.html'))
        .isVisible(),
    ),
  ).toBe(false);
  await actor.evaluate(() => window.desktopPet.menu());
  await expect(chat.getByRole('textbox')).toBeFocused();
  await chat.screenshot({ path: path.join(userData, 'task-window.png') });
  await chat.evaluate(sessionId => window.companion.openWorkbench(sessionId), receipt.sessionId);
  await expect(main.getByTestId('sidebar-view-workbench')).toHaveAttribute('aria-current', 'page');
  await expect(main.getByRole('log')).toContainText('整理项目资料，并告诉我接下来该做什么。', {
    timeout: 30_000,
  });
  const detail = await main.evaluate(
    taskId => window.electron.workbenchTask.getDetail(taskId),
    receipt.taskId,
  );
  if (
    !detail.success ||
    detail.detail?.task.id !== receipt.taskId ||
    detail.detail.runs[0]?.id !== receipt.runId
  )
    throw new Error('Workbench task identity changed');
  const expectedKinds = home
    ? ['companion-chat', 'project-memory', 'session-memory', 'task']
    : ['project-memory', 'session-memory', 'task'];
  if (fileFixture) expectedKinds.push('task');
  if (taskMemoryFixture) expectedKinds.push('task');
  await expect
    .poll(() => requestKinds.map(item => item.kind).sort(), { timeout: 10_000 })
    .toEqual(expectedKinds.sort());
  if (fileFixture) {
    await expect(main.getByText('attachment-notes.md', { exact: true }).first()).toBeVisible();
    await main.mouse.move(10, 10);
    await main.screenshot({ path: path.join(userData, 'task-file-workbench.png') });
  }
  const allMedia =
    process.env.COMPANION_VERIFY_ALL_MEDIA === '1'
      ? await verifyAllMedia(application, main, actor, userData)
      : null;
  const stress = process.env.COMPANION_MEDIA_STRESS_SECONDS
    ? await stressMedia(
        application,
        main,
        actor,
        Number(process.env.COMPANION_MEDIA_STRESS_SECONDS),
      )
    : null;
  const copy =
    process.env.COMPANION_VERIFY_COPY === '1' ? await verifyWorkbenchCopy(main, userData) : null;
  const memory =
    process.env.COMPANION_VERIFY_MEMORY === '1'
      ? await verifyCompanionMemory(application, main, chat, userData, requestKinds)
      : null;
  const taskMemory = taskMemoryAdmission
    ? await verifyTaskMemory(main, chat, taskMemoryAdmission, receipt, requestKinds)
    : null;
  const memoryReview = reviewFixture
    ? await verifyMemoryReview(application, main, chat, userData, requestKinds)
    : null;
  console.log(
    JSON.stringify({
      passed: true,
      status: finished.status,
      receipt,
      requests: modelFixture.requestCount(),
      taskExecutions: detail.detail.runs.length,
      taskModelRequests: requestKinds.filter(item => item.kind === 'task').length,
      chatExecutions: requestKinds.filter(item => item.kind === 'companion-chat').length,
      maintenanceRequests: requestKinds.filter(
        item => item.kind === 'project-memory' || item.kind === 'session-memory',
      ).length,
      detailAvailable: Boolean(detail),
      media,
      allMedia,
      home,
      files: fileFixture
        ? {
            intake: fileFixture.intake,
            binaryMatchesSource: fileFixture.binaryMatchesSource ?? null,
            readThroughNativeTool: fileFixture.observed,
            opaqueDraft: true,
            lostReplyAfterRemoval: true,
          }
        : null,
      stress,
      copy,
      memory,
      taskMemory,
      memoryReview,
      userData,
      workspace,
    }),
  );
} finally {
  await application?.close();
  await new Promise(resolve => server.close(resolve));
}
