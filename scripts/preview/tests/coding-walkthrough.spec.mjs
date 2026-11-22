import { expect, test } from '@playwright/test';

import { PreviewScenario } from '../shared/constants.mjs';
import {
  applyDeterministicRendering,
  attachConsoleGuards,
  previewSearch,
} from '../shared/harness.mjs';

test('the coding sidebar can open agent management before the workbench loads', async ({
  page,
  baseURL,
}) => {
  const failures = [];
  attachConsoleGuards(page, failures, 'coding agent manager');
  await applyDeterministicRendering(page);
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  const workbench = Promise.withResolvers();
  const workbenchModule = '**/src/renderer/components/coding/CodingWorkbenchView.tsx*';
  await page.route(workbenchModule, async route => {
    await workbench.promise;
    await route.continue();
  });
  const trigger = page.getByRole('button', { name: 'Scan and manage agents' });
  const dialog = page.getByRole('dialog', { name: 'Agent management' });
  const coding = page.getByRole('button', { name: 'Coding' });
  try {
    await page.goto(`${baseURL}${previewSearch({ scenario: PreviewScenario.Coding })}`, {
      waitUntil: 'domcontentloaded',
    });
    await Promise.all([page.waitForRequest(workbenchModule), coding.click()]);
    await trigger.press('Enter');
    await expect(dialog).toHaveCount(0);
    workbench.resolve();
    await expect(dialog).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();

    await trigger.click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press('ControlOrMeta+N');
    await expect(trigger).toBeHidden();
    await expect(dialog).toBeHidden();
    await coding.click();
    await expect(trigger).toBeVisible();
    await expect(dialog).toBeHidden();
    expect(failures).toEqual([]);
  } finally {
    workbench.resolve();
  }
});

test('the coding sidebar keeps a new session request until the workbench loads', async ({
  page,
  baseURL,
}) => {
  const failures = [];
  attachConsoleGuards(page, failures, 'coding session');
  await applyDeterministicRendering(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const workbench = Promise.withResolvers();
  const workbenchModule = '**/src/renderer/components/coding/CodingWorkbenchView.tsx*';
  await page.route(workbenchModule, async route => {
    await workbench.promise;
    await route.continue();
  });
  const sidebar = page.locator('aside[data-active-view="coding"]');
  const dialog = page.getByRole('dialog', { name: 'Choose an agent to start coding' });
  const composer = page.getByRole('textbox', { name: 'Send to current agent…' });
  try {
    await page.goto(`${baseURL}${previewSearch({ scenario: PreviewScenario.Coding })}`, {
      waitUntil: 'domcontentloaded',
    });
    await expect(page).toHaveTitle('ZhiYuan Agent');
    await Promise.all([
      page.waitForRequest(workbenchModule),
      page.getByRole('button', { name: 'Coding' }).click(),
    ]);
    await sidebar.getByRole('button', { name: 'New coding session', exact: true }).press('Enter');
    await expect(composer).toHaveCount(0);
    await expect(dialog).toHaveCount(0);
    workbench.resolve();
    await expect(composer).toBeVisible();
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    await dialog.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(sidebar.getByText('New session', { exact: true })).toBeVisible();
    await composer.fill('Keep this coding draft');
    await expect(composer).toHaveValue('Keep this coding draft');
    await sidebar.getByRole('button', { name: 'New coding session', exact: true }).click();
    await expect(dialog).toBeVisible();
    await sidebar.getByRole('treeitem', { name: /现状报告/ }).click();
    await expect(dialog).toBeHidden();

    await page.evaluate(async () => {
      const { codingAgent, dialog } = window.electron;
      const { workspaces } = await codingAgent.listWorkspaces();
      const preparedRoot = '/preview/prepared';
      const bootstrap = codingAgent.bootstrap;
      codingAgent.bootstrap = async root => {
        const result = await bootstrap(root);
        if (root !== preparedRoot) return result;
        const { snapshot } = result;
        return {
          ...result,
          snapshot: {
            ...snapshot,
            room: {
              ...snapshot.room,
              workspaceRoot: root,
              activeLaneId: null,
              activeMissionId: null,
            },
            lanes: [],
            missions: [],
            events: [],
          },
        };
      };
      dialog.selectDirectory = async () => ({ success: true, path: preparedRoot });
      codingAgent.createWorkspace = async ({ name, defaultProfileId, sourceFolders }) => {
        const workspace = {
          id: 'prepared-workspace',
          name,
          defaultProfileId,
          primaryRoot: sourceFolders[0],
          sources: [
            {
              id: 'prepared-source',
              workspaceId: 'prepared-workspace',
              path: sourceFolders[0],
              isPrimary: true,
            },
          ],
          sessions: [],
          activeSessionId: null,
        };
        const result = { success: true, workspaces: [...workspaces, workspace] };
        codingAgent.listWorkspaces = async () => result;
        return result;
      };
    });
    await sidebar.getByRole('button', { name: 'Add workspace', exact: true }).click();
    const workspaceDialog = page.getByRole('dialog', { name: 'New coding workspace' });
    await workspaceDialog.getByRole('button', { name: 'Add folder', exact: true }).click();
    await workspaceDialog.getByRole('combobox').click();
    await page.getByRole('option', { name: /知远内置/ }).click();
    await workspaceDialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(workspaceDialog).toBeHidden();
    await expect(sidebar.getByRole('treeitem', { name: /^New session/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('vite-error-overlay')).toHaveCount(0);
    expect(failures).toEqual([]);
  } finally {
    workbench.resolve();
  }
});

test('coding workspace creation uses the same form from the canvas and sidebar', async ({
  page,
  baseURL,
}) => {
  const failures = [];
  attachConsoleGuards(page, failures, 'coding workspace');
  await applyDeterministicRendering(page);
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await page.goto(`${baseURL}${previewSearch()}`, { waitUntil: 'domcontentloaded' });
  const coding = page.getByRole('button', { name: 'Coding' });
  await coding.click();
  await page.getByRole('button', { name: 'Collapse', exact: true }).click();

  const canvas = page.locator('[data-main-canvas]');
  const add = canvas.getByRole('button', { name: 'Add workspace' });
  const dialog = page.getByRole('dialog', { name: 'New coding workspace' });
  const workspaceName = dialog.getByRole('textbox', { name: 'Workspace name' });
  await add.press('Enter');
  await expect(workspaceName).toBeFocused();
  await workspaceName.fill('Unsaved workspace');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(add).toBeFocused();

  await canvas.getByRole('button', { name: 'Expand', exact: true }).click();
  const sidebarAdd = page
    .locator('aside[data-active-view="coding"]')
    .getByRole('button', { name: 'Add workspace', exact: true });
  await sidebarAdd.click();
  await expect(workspaceName).toHaveValue('');
  await page.keyboard.press('Escape');
  await expect(sidebarAdd).toBeFocused();
  await sidebarAdd.press('Enter');
  await expect(dialog).toBeVisible();
  await page.keyboard.press('ControlOrMeta+N');
  await expect(sidebarAdd).toBeHidden();
  await coding.click();
  await expect(sidebarAdd).toBeVisible();
  await expect(dialog).toBeHidden();
  expect(failures).toEqual([]);
});

test('coding mode streams reasoning + markdown and surfaces artifact and elicitation cards', async ({
  page,
  baseURL,
}) => {
  const failures = [];
  attachConsoleGuards(page, failures, 'coding');
  await applyDeterministicRendering(page);
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });

  await page.goto(`${baseURL}${previewSearch({ scenario: PreviewScenario.Coding })}`, {
    waitUntil: 'domcontentloaded',
  });
  await page.getByRole('button', { name: 'Coding' }).click();

  // Streaming indicator + settled Replace-mode assistant markdown.
  await expect(page.getByRole('button', { name: /Thinking/ })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/详见报告：目录共 87 个文件/)).toBeVisible({ timeout: 20_000 });

  // Reasoning is collapsed behind the indicator; reveal it.
  await page.getByRole('button', { name: /Thinking/ }).click();
  await expect(page.getByText('先扫描目录结构，再按模块给出重构优先级。')).toBeVisible({
    timeout: 10_000,
  });

  // Artifact preview card anchors to the streaming message.
  await expect(page.getByText('目录现状报告.md').first()).toBeVisible({ timeout: 10_000 });

  // Switch to the waiting-elicitation session to see the clarification card.
  await page.getByText('重构范围确认').first().click();
  await expect(page.getByText(/这次重构是只做目录梳理/)).toBeVisible({ timeout: 10_000 });

  expect(failures).toEqual([]);
});
