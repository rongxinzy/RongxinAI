import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { attachConsoleGuards } from '../shared/harness.mjs';
import {
  CompanionCapability,
  CompanionUnavailableReason,
} from '../../../src/shared/companion/constants.ts';
import { CompanionImageIssue } from '../../../src/shared/companion/images.ts';

async function pasteImage(page, name = '参考画面.png') {
  await page.getByRole('textbox').evaluate((input, name) => {
    const bytes = Uint8Array.from(
      atob(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      ),
      character => character.charCodeAt(0),
    );
    const data = new DataTransfer();
    data.items.add(new File([bytes], name, { type: 'image/png' }));
    input.dispatchEvent(
      new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }),
    );
  }, name);
  await expect(page.getByText(name, { exact: true })).toBeVisible();
}

for (const language of ['zh', 'en'])
  for (const theme of ['light', 'dark'])
    test(`image drafts, automatic degradation and admission in ${language} ${theme}`, async ({
      page,
    }) => {
      const failures = [];
      attachConsoleGuards(page, failures, 'companion images');
      await page.setViewportSize({ width: 448, height: 400 });
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      await page.goto(`/companion.html?language=${language}&theme=${theme}`);
      const input = page.getByRole('textbox');
      const send = page.getByRole('button', {
        name: language === 'zh' ? '发送' : 'Send',
        exact: true,
      });
      await expect(input).toBeEnabled();
      await page.evaluate(
        ({ capability, reason }) => {
          const submit = window.companion.submit;
          window.imageRequests = [];
          window.imagesAvailable = false;
          window.companion.submit = request => {
            window.imageRequests.push(request);
            return window.imagesAvailable
              ? submit(request)
              : Promise.resolve({
                  availability: {
                    capability,
                    reason,
                    modelId: null,
                    imageInput: false,
                    toolUse: false,
                  },
                  receipt: null,
                });
          };
        },
        {
          capability: CompanionCapability.Local,
          reason: CompanionUnavailableReason.ImageUnavailable,
        },
      );
      await input.fill('这张图怎样排版更好？');
      await pasteImage(page);
      await send.click();
      await expect(page.getByRole('alert')).toContainText(
        language === 'zh' ? '没有可看图片的模型' : 'No image-capable model',
      );
      await expect(input).toHaveValue('这张图怎样排版更好？');
      await expect(
        page.getByRole('button', { name: language === 'zh' ? '移除' : 'Remove', exact: true }),
      ).toHaveCount(1);
      await expect(page.getByText('参考画面.png', { exact: true })).toBeInViewport({ ratio: 1 });
      await expect(
        page.getByRole('button', { name: language === 'zh' ? '移除' : 'Remove', exact: true }),
      ).toBeInViewport({ ratio: 1 });
      const persisted = await page.evaluate(() =>
        Object.keys(localStorage)
          .filter(key => key.startsWith('zhiyuan-companion-draft:'))
          .map(key => JSON.parse(localStorage.getItem(key))),
      );
      expect(persisted[0].attachments[0]).toEqual({
        id: expect.any(String),
        name: '参考画面.png',
        bytes: expect.any(Number),
      });
      expect(JSON.stringify(persisted)).not.toMatch(/base64|data:image|\/private\//);
      for (const width of [760, 560, 480, 448]) {
        await page.setViewportSize({ width, height: 400 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        await expect(send).toBeVisible();
      }
      expect(
        (await new AxeBuilder({ page }).include('main').analyze()).violations.map(item => item.id),
      ).toEqual([]);
      await page.screenshot({ path: `/tmp/companion-images-${language}-${theme}.png` });
      await page.evaluate(() => {
        window.imagesAvailable = true;
      });
      await send.click();
      await expect(input).toHaveValue('');
      await expect(
        page.getByRole('button', { name: language === 'zh' ? '移除' : 'Remove', exact: true }),
      ).toHaveCount(0);
      await expect(page.getByText('参考画面.png', { exact: true })).toBeVisible();
      const requests = await page.evaluate(() => window.imageRequests);
      expect(requests).toHaveLength(2);
      expect(requests[1]).toEqual(requests[0]);
      expect(Object.keys(requests[0]).sort()).toEqual([
        'attachmentIds',
        'petId',
        'requestId',
        'text',
      ]);
      expect(failures).toEqual([]);
    });

test('an image can be sent without text and an old receipt cannot erase new edits', async ({
  page,
}) => {
  await page.goto('/companion.html?language=en');
  const input = page.getByRole('textbox');
  await pasteImage(page, 'image-only.png');
  await page.evaluate(() => {
    const submit = window.companion.submit;
    window.companion.submit = async request => {
      window.imageOnlyRequest = request;
      await new Promise(resolve => {
        window.finishImage = resolve;
      });
      return submit(request);
    };
  });
  const send = page.getByRole('button', { name: 'Send', exact: true });
  await expect(send).toBeEnabled();
  await input.press('Enter');
  await expect
    .poll(() => page.evaluate(() => window.imageOnlyRequest?.attachmentIds.length))
    .toBe(1);
  expect(await page.evaluate(() => window.imageOnlyRequest.text)).toBe('');
  await input.fill('A new message while this image is being admitted');
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await page.evaluate(() => window.finishImage());
  await expect(input).toHaveValue('A new message while this image is being admitted');
  await expect(page.getByText('image-only.png', { exact: true })).toBeVisible();
});

test('invalid image errors retain the attachment and show no internal paths', async ({ page }) => {
  const failures = [];
  attachConsoleGuards(page, failures, 'invalid companion image');
  await page.goto('/companion.html?language=en&theme=dark');
  await pasteImage(page, 'damaged.png');
  await page.evaluate(issue => {
    window.companion.submit = async () => {
      throw new Error(`${issue}: /private/internal/photo.png`);
    };
  }, CompanionImageIssue.Invalid);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Couldn’t read the image');
  await expect(page.getByRole('alert')).not.toContainText('/private/');
  await expect(page.getByText('damaged.png', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove', exact: true })).toHaveCount(1);
  expect(failures).toEqual([]);
});
