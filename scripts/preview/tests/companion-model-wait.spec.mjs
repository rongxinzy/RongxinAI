import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { attachConsoleGuards } from '../shared/harness.mjs';
import {
  CompanionCapability,
  CompanionRequestState,
  CompanionUnavailableReason,
} from '../../../src/shared/companion/constants.ts';

async function pausedConversation(page, { image = false } = {}) {
  await page.evaluate(
    async ({ local, chat, accepted, stopped, reason }) => {
      const bootstrap = window.companion.bootstrap;
      const initial = await bootstrap();
      const receipt = { petId: initial.activePetId, requestId: 'paused-request', submissionId: 41 };
      window.modelRecovery = {
        available: false,
        reads: 0,
        polls: 0,
        submits: 0,
        pending: true,
        receipt,
      };
      window.companion.bootstrap = async () => {
        window.modelRecovery.reads++;
        const value = await bootstrap();
        const state = window.modelRecovery;
        return {
          ...value,
          availability: {
            capability: state.available ? chat : local,
            modelId: state.available ? 'existing-model' : null,
            imageInput: state.available,
            toolUse: false,
            ...(state.available ? {} : { reason }),
          },
          conversation: {
            messages: [{ id: 1, role: 'user', text: 'An already admitted request' }],
            pending: state.pending ? receipt : null,
            lastReply: { ...receipt, state: state.pending ? accepted : stopped },
          },
        };
      };
      window.companion.answer = async value => {
        window.modelRecovery.polls++;
        return { ...value, state: window.modelRecovery.pending ? accepted : stopped, text: '' };
      };
      window.companion.submit = async () => {
        window.modelRecovery.submits++;
        throw new Error('Must resume the admitted input');
      };
      window.companion.stop = async () => {
        window.modelRecovery.pending = false;
      };
      await window.companion.select(initial.activePetId);
    },
    {
      local: CompanionCapability.Local,
      chat: CompanionCapability.Chat,
      accepted: CompanionRequestState.Accepted,
      stopped: CompanionRequestState.Stopped,
      reason: image
        ? CompanionUnavailableReason.ImageUnavailable
        : CompanionUnavailableReason.NoModel,
    },
  );
}

for (const language of ['zh', 'en'])
  for (const theme of ['light', 'dark']) {
    test(`paused replies wait honestly and resume in ${language} ${theme}`, async ({ page }) => {
      const failures = [];
      attachConsoleGuards(page, failures, 'model waiting');
      await page.setViewportSize({ width: 448, height: 400 });
      await page.goto(`/companion.html?language=${language}&theme=${theme}`);
      const input = page.getByRole('textbox');
      await expect(input).toBeEnabled();
      await pausedConversation(page, { image: theme === 'dark' });
      const waiting =
        theme === 'dark'
          ? language === 'zh'
            ? '等待可看图片的模型'
            : 'Waiting for a model that can view images'
          : language === 'zh'
            ? '等待可用模型'
            : 'Waiting for a model';
      await expect(page.getByRole('status')).toContainText(waiting);
      await expect(
        page.getByText(language === 'zh' ? '正在回复' : 'Replying', { exact: true }),
      ).toHaveCount(0);
      await input.fill('Keep the next draft while the old request waits');
      await page.waitForTimeout(1100);
      expect(await page.evaluate(() => window.modelRecovery.polls)).toBe(0);
      expect(await page.evaluate(() => window.modelRecovery.submits)).toBe(0);
      for (const height of [400, 240]) {
        await page.setViewportSize({ width: 448, height });
        const resume = page.getByRole('button', {
          name: language === 'zh' ? '继续回复' : 'Continue',
          exact: true,
        });
        await resume.scrollIntoViewIfNeeded();
        await expect(resume).toBeInViewport({ ratio: 1 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
          false,
        );
      }
      await page.setViewportSize({ width: 448, height: 400 });
      await page.screenshot({
        path: `/tmp/companion-model-wait-${language}-${theme}.png`,
        omitBackground: true,
      });
      expect(
        (await new AxeBuilder({ page }).include('[data-companion-bubble]').analyze()).violations,
      ).toEqual([]);
      await page.evaluate(() => {
        window.modelRecovery.available = true;
      });
      if (language === 'zh') {
        await page.getByRole('button', { name: '继续回复', exact: true }).click();
      } else {
        await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      }
      await expect(page.getByRole('status')).toHaveText(
        language === 'zh' ? '正在回复' : 'Replying',
      );
      await expect(input).toHaveValue('Keep the next draft while the old request waits');
      expect(await page.evaluate(() => window.modelRecovery.submits)).toBe(0);
      expect(await page.evaluate(() => window.modelRecovery.receipt.submissionId)).toBe(41);
      await expect.poll(() => page.evaluate(() => window.modelRecovery.polls)).toBeGreaterThan(0);
      await page
        .getByRole('button', {
          name: language === 'zh' ? '停止回复' : 'Stop replying',
          exact: true,
        })
        .click();
      await expect(page.getByRole('status')).toHaveText(
        language === 'zh' ? '已停止回复' : 'Reply stopped',
      );
      await expect(page.getByRole('alert')).toHaveCount(0);
      expect(failures).toEqual([]);
    });
  }

test('a waiting reply can be stopped without a model and normal focus does not keep refreshing it', async ({
  page,
}) => {
  await page.goto('/companion.html');
  await expect(page.getByRole('textbox')).toBeEnabled();
  await pausedConversation(page);
  await expect(page.getByRole('status')).toContainText('等待可用模型');
  await page.getByRole('button', { name: '停止回复', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('已停止回复');
  const reads = await page.evaluate(() => window.modelRecovery.reads);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => window.modelRecovery.reads)).toBe(reads);
  expect(await page.evaluate(() => window.modelRecovery.polls)).toBe(0);
});

test('hidden prewarming and focus do not bootstrap a conversation', async ({ page }) => {
  await page.addInitScript(() => {
    let current;
    window.hiddenRecoveryReads = 0;
    Object.defineProperty(window, 'companion', {
      configurable: true,
      get: () => current,
      set: api => {
        current = api;
        const bootstrap = api.bootstrap;
        api.bootstrap = async () => {
          window.hiddenRecoveryReads++;
          return bootstrap();
        };
        api.visibility = async () => false;
      },
    });
  });
  await page.goto('/companion.html');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => window.hiddenRecoveryReads)).toBe(0);
  await expect(page.getByRole('textbox')).toBeDisabled();
});

test('focus recovery cannot replace a file operation or its error while a reply waits', async ({
  page,
}) => {
  await page.goto('/companion.html');
  await expect(page.getByRole('textbox')).toBeEnabled();
  await pausedConversation(page);
  await expect(page.getByRole('status')).toContainText('等待可用模型');
  await page.evaluate(() => {
    window.companion.chooseFiles = () =>
      new Promise((_resolve, reject) => {
        window.rejectWaitingFiles = () => reject(new Error('Controlled file picker failure'));
      });
  });
  await page.getByRole('button', { name: '添加附件', exact: true }).click();
  await expect(page.getByRole('button', { name: '添加附件', exact: true })).toBeDisabled();
  const before = await page.evaluate(() => window.modelRecovery.reads);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => window.modelRecovery.reads)).toBe(before);
  await page.evaluate(() => window.rejectWaitingFiles());
  await expect(page.getByRole('alert')).toContainText('没能添加附件');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => window.modelRecovery.reads)).toBe(before);
  await expect(page.getByRole('alert')).toContainText('没能添加附件');
});
