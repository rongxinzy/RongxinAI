import { expect } from '@playwright/test';

import { settingsTabs, sidebarViews } from './constants.mjs';
import {
  home,
  openConnectors,
  openSkillsPage,
  previewSearch,
  settle,
  waitForGeneralSettingsPanel,
} from './harness.mjs';

/**
 * @param {import('@playwright/test').Page} page
 * @param {object} options
 * @param {string} options.baseUrl
 * @param {string} options.search
 * @param {'light' | 'dark'} options.scheme
 * @param {import('@playwright/test').TestInfo} [options.testInfo]
 * @param {boolean} [options.captureStream]
 * @param {boolean} [options.liteEdition]
 * @param {string} [options.snapshotPrefix]
 * @param {string[]} failures
 */
export async function walkScreens(
  page,
  {
    baseUrl,
    search,
    scheme,
    testInfo,
    captureStream = true,
    liteEdition = false,
    snapshotPrefix = '',
  },
  failures,
) {
  const shot = async name => {
    await settle(page);
    if (testInfo) {
      const fileName = snapshotPrefix
        ? `${snapshotPrefix}-${name}-${scheme}.png`
        : `${name}-${scheme}.png`;
      await expect(page).toHaveScreenshot(fileName, { fullPage: true });
    }
  };

  const step = async (name, action) => {
    try {
      await action();
    } catch (error) {
      const message = error instanceof Error ? error.message.split('\n')[0] : String(error);
      failures.push(`${scheme} ${name}: ${message}`);
    }
  };

  if (search.includes('previewScenario=error')) {
    await step('init-error', async () => {
      await home(page, baseUrl, search);
      await shot('init-error');
    });
    return;
  }

  const isEmpty = search.includes('previewScenario=empty');
  const isLoading = search.includes('previewScenario=loading');

  await step('workbench', async () => {
    await home(page, baseUrl, search);
    await shot('workbench');
  });

  if (liteEdition) {
    await step('settings-general-lite', async () => {
      await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
      await page.getByRole('button', { name: 'General', exact: true }).first().click();
      await waitForGeneralSettingsPanel(page);
      await shot('settings-general');
    });
    return;
  }

  if (isEmpty) {
    await step('skills-empty', async () => {
      await openSkillsPage(page, { empty: true });
      await shot('skills');
    });
    await step('mcp-empty', async () => {
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'New Task', exact: true }).click();
      await openConnectors(page, { empty: true });
      await shot('mcp');
    });
    await step('todo-empty', async () => {
      await page.getByRole('button', { name: 'Todo', exact: true }).click();
      await shot('todo');
    });
    await step('activity-empty', async () => {
      await page.getByRole('button', { name: 'Activity', exact: true }).click();
      await shot('activity');
    });
    return;
  }

  if (isLoading) {
    await step('local-inference-loading', async () => {
      await page.getByRole('button', { name: 'Local Inference', exact: true }).click();
      await shot('local-inference');
    });
    return;
  }

  await step('chat', async () => {
    await page.getByText('Build a React calculator app').first().click();
    await page.getByText('Scaffold a').first().waitFor({ timeout: 20_000 });
    await shot('chat');
  });

  if (captureStream && testInfo) {
    await step('stream', async () => {
      const input = page.getByRole('textbox').last();
      await input.click();
      await page.keyboard.type('Add a percent key');
      await page.keyboard.press('Enter');
      await page.getByText('Browser preview reply is ready').waitFor({ timeout: 20_000 });
      await shot('chat-stream');
    });
  }

  await step('chat-mode', async () => {
    await page.getByRole('switch', { name: 'Work / Chat' }).click();
    await page.getByText('Draft a weekly update').first().waitFor({ timeout: 20_000 });
    await shot('chat-mode');
    await page.getByRole('switch', { name: 'Work / Chat' }).click();
    await page.getByText('Calculator', { exact: true }).first().waitFor();
  });

  await step('settings', async () => {
    await page.getByText('Login', { exact: true }).first().click();
    await page.getByRole('menuitem', { name: 'Settings' }).click();
    for (const [name, label] of settingsTabs) {
      await page.getByRole('button', { name: label, exact: true }).first().click();
      if (name === 'settings-general') {
        await waitForGeneralSettingsPanel(page);
      }
      await shot(name);
    }
  });

  await step('sidebar', async () => {
    await page.getByRole('button', { name: 'New Task', exact: true }).click();
    await page.getByText('Calculator', { exact: true }).first().waitFor();
    for (const [name, label, ready] of sidebarViews) {
      await page.getByRole('button', { name: label, exact: true }).click();
      if (ready) await page.getByText(ready).first().waitFor({ timeout: 20_000 });
      await shot(name);
    }
  });

  await step('skills', async () => {
    await page.getByRole('button', { name: 'New Task', exact: true }).click();
    await openSkillsPage(page);
    await shot('skills');
  });

  await step('connectors', async () => {
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'New Task', exact: true }).click();
    await openConnectors(page);
    await shot('mcp');
  });

  await step('model log', async () => {
    const logQuery = previewSearch({
      scenario: search.includes('previewScenario=loading')
        ? 'loading'
        : search.includes('previewScenario=empty')
          ? 'empty'
          : 'default',
      edition: search.includes('previewEdition=xiaoruan') ? 'xiaoruan' : 'zhiyuan',
      skipBoot: true,
      extra: {
        view: 'llamacpp-model-launch-log',
        sessionId: 'preview-log',
        modelName: 'preview-model',
      },
    });
    await page.goto(`${baseUrl}${logQuery}`, { waitUntil: 'domcontentloaded' });
    await page.getByText('preview model server listening').waitFor({ timeout: 20_000 });
    await shot('model-launch-log');
  });
}
