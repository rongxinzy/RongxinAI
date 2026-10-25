import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {
  MemoryDeliveryStatus,
  MemoryKind,
  MemoryLifecycleStatus,
  MemorySourceKind,
} from '../../../src/shared/memory/constants.ts';
import { contrast } from '../shared/contrast.mjs';

const labels = {
  zh: {
    memory: '记忆',
    review: '查看',
    waiting: '待确认',
    sync: '待同步',
    remember: '记住',
    remembered: '已记住',
    cancel: '取消',
    heading: '记住这条内容？',
    content: '内容',
    edit: '编辑记忆',
    share: '共享记忆',
    draft: '说说你在想什么…',
  },
  en: {
    memory: 'Memory',
    review: 'Review',
    waiting: 'Needs review',
    sync: 'Waiting to sync',
    remember: 'Remember',
    remembered: 'Remembered',
    cancel: 'Cancel',
    heading: 'Remember this?',
    content: 'Content',
    edit: 'Edit memory',
    share: 'Share memory',
    draft: 'What’s on your mind?',
  },
};

async function settleDialog(dialog) {
  await expect(dialog).toHaveCSS('opacity', '1');
  await dialog.evaluate(async element => {
    await Promise.all(
      element.getAnimations({ subtree: true }).map(animation => animation.finished),
    );
  });
}

async function seed(page) {
  return page.evaluate(
    async ({ status, source, completed, decision, preference }) => {
      const api = window.companion;
      const petId = (await api.bootstrap()).activePetId;
      const record = await api.saveMemory({
        petId,
        requestId: crypto.randomUUID(),
        title: 'Paper kite decision',
        content: 'The paper kite uses bamboo. '.repeat(90),
        kind: decision,
      });
      Object.assign(record, { memoryId: null, status, sourceKind: source, deliveryStatus: null });
      const offline = await api.saveMemory({
        petId,
        requestId: crypto.randomUUID(),
        title: 'Offline explicit memory',
        content: 'A previously approved fact.',
        kind: preference,
      });
      offline.memoryId = null;
      offline.deliveryStatus = completed;
      const confirm = api.confirmMemory;
      window.reviewInputs = [];
      window.reviewShares = [];
      api.confirmMemory = async input => {
        window.reviewInputs.push(input);
        return confirm(input);
      };
      api.shareMemory = async input => {
        window.reviewShares.push(input);
        return { id: 'shared', available: true };
      };
      return { id: record.id, title: record.title, content: record.content };
    },
    {
      status: MemoryLifecycleStatus.NeedsReview,
      source: MemorySourceKind.TaskVerifier,
      completed: MemoryDeliveryStatus.Pending,
      decision: MemoryKind.Decision,
      preference: MemoryKind.Preference,
    },
  );
}

for (const theme of ['light', 'dark'])
  for (const language of ['zh', 'en']) {
    test(`review private task memory in ${language} ${theme}`, async ({ page }) => {
      const t = labels[language];
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => {
        if (message.type() === 'error') errors.push(message.text());
      });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto(`/companion.html?theme=${theme}&language=${language}`);
      await expect(page).toHaveURL(/\/companion\.html\?/);
      await expect(page).toHaveTitle('知远智能体 (ZhiYuan Agent)');
      const draft = page.getByRole('textbox', { name: t.draft });
      await draft.fill('Keep this draft');
      const snapshot = await seed(page);
      const entry = page.getByRole('button', { name: t.memory, exact: true });
      await entry.click();
      const dialog = page.getByRole('dialog');
      await settleDialog(dialog);
      await expect(dialog.getByText(t.waiting, { exact: true })).toBeVisible();
      await expect(dialog.getByText(t.sync, { exact: true })).toBeVisible();
      await expect(
        dialog.getByRole('button', { name: `${t.edit}: Offline explicit memory` }),
      ).toBeDisabled();
      await expect(
        dialog.getByRole('button', { name: `${t.review}: Offline explicit memory` }),
      ).toHaveCount(0);
      const review = dialog.getByRole('button', { name: `${t.review}: ${snapshot.title}` });
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await expect(review).toHaveCSS('transition-duration', '0.12s');
      await review.hover();
      await expect(review).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
      expect((await contrast(review)).text).toBeGreaterThanOrEqual(4.5);
      await review.focus();
      await page.keyboard.press('Tab');
      await page.keyboard.press('Shift+Tab');
      const focus = await contrast(review);
      expect(focus.focus).toBeGreaterThanOrEqual(3);
      expect(focus.focusVisible).toBe(true);
      expect(focus.outlineWidth).toBe('2px');
      expect(focus.outlineStyle).toBe('solid');
      await page.keyboard.down('Space');
      await expect(review).toHaveCSS('translate', '0px 1px');
      await page.keyboard.up('Space');
      await dialog.getByRole('button', { name: t.cancel, exact: true }).click();
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await settleDialog(dialog);
      await expect(review).toBeVisible();
      await review.focus();
      await expect(review).toBeFocused();
      await review.press('Enter');
      await expect(dialog.getByRole('heading')).toHaveText(t.heading);
      await expect(dialog.getByRole('region', { name: t.content })).toHaveText(
        snapshot.title + snapshot.content,
      );
      expect(await page.evaluate(() => window.reviewInputs)).toEqual([]);
      await dialog.getByRole('button', { name: t.cancel, exact: true }).click();
      expect(await page.evaluate(() => window.reviewInputs)).toEqual([]);
      await review.click();
      for (const [width, height] of [
        [1440, 900],
        [1280, 800],
        [1024, 768],
        [940, 700],
        [760, 700],
        [448, 640],
      ]) {
        await page.setViewportSize({ width, height });
        await expect(dialog.getByRole('button', { name: t.remember, exact: true })).toBeInViewport({
          ratio: 1,
        });
        await expect(dialog.getByRole('button', { name: t.cancel, exact: true })).toBeInViewport({
          ratio: 1,
        });
        expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(
          true,
        );
      }
      const region = dialog.getByRole('region', { name: t.content });
      await region.focus();
      await region.press('End');
      await expect.poll(() => region.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
      await expect(dialog).toHaveCSS('opacity', '1');
      await dialog.evaluate(async element => {
        await Promise.all(
          element.getAnimations({ subtree: true }).map(animation => animation.finished),
        );
      });
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      await page.screenshot({ path: `/tmp/companion-memory-review-${language}-${theme}.png` });
      await dialog.getByRole('button', { name: t.remember, exact: true }).click();
      await expect(dialog.getByRole('status')).toHaveText(t.remembered);
      await expect(
        dialog.getByRole('button', { name: `${t.edit}: ${snapshot.title}` }),
      ).toBeEnabled();
      const inputs = await page.evaluate(() => window.reviewInputs);
      expect(inputs).toHaveLength(1);
      expect(inputs[0]).toMatchObject({
        id: snapshot.id,
        title: snapshot.title,
        content: snapshot.content,
        confirmed: true,
      });
      expect(await page.evaluate(() => window.reviewShares)).toEqual([]);
      await page.keyboard.press('Escape');
      await expect(entry).toBeFocused();
      await expect(draft).toHaveValue('Keep this draft');
      expect(errors).toEqual([]);
    });
  }

test('unknown confirmation results keep the reviewed snapshot for an identical retry', async ({
  page,
}) => {
  await page.goto('/companion.html');
  const snapshot = await seed(page);
  await page.evaluate(() => {
    const confirm = window.companion.confirmMemory;
    let first = true;
    window.companion.confirmMemory = async input => {
      const result = await confirm(input);
      if (first) {
        first = false;
        throw new Error('Simulated lost review reply');
      }
      return result;
    };
  });
  await page.getByRole('button', { name: '记忆', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: `查看: ${snapshot.title}` }).click();
  await dialog.getByRole('button', { name: '记住', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('没能确认修改结果');
  await expect(dialog.getByRole('region')).toContainText(snapshot.content);
  await dialog.getByRole('button', { name: '记住', exact: true }).click();
  await expect(dialog.getByRole('status')).toHaveText('已记住');
  const inputs = await page.evaluate(() => window.reviewInputs);
  expect(inputs).toHaveLength(2);
  expect(inputs[0]).toEqual(inputs[1]);
});

test('review snapshots, focus and scroll survive live theme and language changes', async ({
  page,
}) => {
  await page.addInitScript(() => {
    let api;
    Object.defineProperty(window, 'companion', {
      configurable: true,
      get: () => api,
      set(value) {
        const subscribe = value.onContext;
        value.onContext = listener => {
          window.reviewContext = listener;
          return subscribe(listener);
        };
        api = value;
      },
    });
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 448, height: 640 });
  await page.goto('/companion.html');
  const snapshot = await seed(page);
  await page.getByRole('button', { name: '记忆', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await settleDialog(dialog);
  await dialog.getByRole('button', { name: `查看: ${snapshot.title}` }).click();
  await settleDialog(dialog);
  const region = dialog.getByRole('region', { name: '内容', exact: true });
  await region.focus();
  await expect(region).toBeFocused();
  await region.press('End');
  await expect.poll(() => region.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  await expect
    .poll(() =>
      region.evaluate(element => element.scrollTop === element.scrollHeight - element.clientHeight),
    )
    .toBe(true);
  const top = await region.evaluate(element => element.scrollTop);
  expect(top).toBeGreaterThan(0);
  await expect(region).toBeFocused();
  await page.evaluate(() =>
    window.reviewContext({ language: 'en', theme: 'dark', themeStyle: '' }),
  );
  const changed = dialog.getByRole('region', { name: 'Content', exact: true });
  await expect(changed).toBeFocused();
  await expect(changed).toContainText(snapshot.content);
  expect(await changed.evaluate(element => element.scrollTop)).toBe(top);
  await expect(dialog.getByRole('button', { name: 'Remember', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.reviewInputs)).toEqual([]);
  await page.evaluate(() =>
    window.reviewContext({ language: 'zh', theme: 'light', themeStyle: '' }),
  );
  await expect(region).toBeFocused();
  expect(await region.evaluate(element => element.scrollTop)).toBe(top);
  await expect(dialog.getByRole('button', { name: '记住', exact: true })).toBeVisible();
});

test('a changed event refreshes an open list and in-flight review prevents duplicate submission', async ({
  page,
}) => {
  await page.addInitScript(() => {
    let api;
    Object.defineProperty(window, 'companion', {
      configurable: true,
      get: () => api,
      set(value) {
        const subscribe = value.onChanged;
        window.memoryChanged = [];
        value.onChanged = listener => {
          window.memoryChanged.push(listener);
          return subscribe(listener);
        };
        api = value;
      },
    });
  });
  await page.goto('/companion.html');
  const snapshot = await seed(page);
  await page.getByRole('button', { name: '记忆', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: `查看: ${snapshot.title}` }).click();
  await page.evaluate(() => {
    const confirm = window.companion.confirmMemory;
    window.companion.confirmMemory = async input => {
      await new Promise(resolve => {
        window.reviewRelease = resolve;
      });
      return confirm(input);
    };
  });
  await dialog.getByRole('button', { name: '记住', exact: true }).click();
  await expect(dialog.getByRole('button', { name: '记住', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: '取消', exact: true })).toBeDisabled();
  await page.evaluate(() => window.reviewRelease());
  await expect(dialog.getByRole('status')).toHaveText('已记住');
  expect(await page.evaluate(() => window.reviewInputs.length)).toBe(1);
  await page.evaluate(async id => {
    const api = window.companion;
    await api.forgetMemory((await api.bootstrap()).activePetId, id);
    window.memoryChanged.forEach(listener => listener());
  }, snapshot.id);
  await expect(dialog.getByText(snapshot.title, { exact: true })).toHaveCount(0);
});
