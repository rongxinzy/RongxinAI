import fs from 'node:fs';
import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import yaml from 'js-yaml';
import { attachConsoleGuards } from '../shared/harness.mjs';
import { changeProviderLanguage } from '../shared/provider-editor.mjs';

const registry = JSON.parse(
  fs.readFileSync(new URL('../../../MCPs/registry.json', import.meta.url), 'utf8'),
);
const marketplace = {
  categories: registry.categories,
  servers: registry.servers
    .filter(server => ['notion', 'github'].includes(server.id))
    .map(server => ({
      ...server,
      presentation: yaml.load(
        fs.readFileSync(new URL(`../../../MCPs/${server.metadataPath}`, import.meta.url), 'utf8'),
      ).presentation,
    })),
};

async function open(page, language, theme) {
  await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
  await page.addInitScript(
    ({ language, marketplace }) => {
      let api;
      Object.defineProperty(window, 'electron', {
        configurable: true,
        get: () => api,
        set(value) {
          value.appInfo.getSystemLocale = async () => (language === 'zh' ? 'zh-CN' : 'en-US');
          const get = value.store.get;
          value.store.get = async key =>
            key === 'app_config'
              ? { ...(await get(key)), language, language_initialized: true, theme: 'system' }
              : get(key);
          window.skillCreateCalls = [];
          value.skills.createCustom = async input => {
            window.skillCreateCalls.push(input);
            if (window.holdSkillCreate)
              return new Promise(resolve => {
                window.finishSkillCreate = resolve;
              });
            return { success: false, error: 'Skill "existing" already exists' };
          };
          value.mcp.fetchMarketplace = async () => ({ success: true, data: marketplace });
          api = value;
        },
      });
    },
    { language, marketplace },
  );
  await page.goto('/?previewSkipBoot=1');
  await page
    .getByRole('button', { name: language === 'zh' ? '专家' : 'Expert', exact: true })
    .click();
  await page.getByRole('tab', { name: language === 'zh' ? '技能' : 'Skills', exact: true }).click();
}

const strings = {
  zh: {
    create: '新建技能',
    id: '标识',
    name: '名称',
    description: '用途与使用时机',
    body: '执行说明（Markdown）',
    template: '使用模板',
    save: '保存',
    close: '关闭',
    missing: '请填写标识。',
    duplicate: '这个标识已被使用，请换一个。',
    connectors: '连接器',
    market: '市场',
    search: '搜索连接器',
    connect: '连接',
    data: '工具调用所需内容会发送给服务方。',
    removed: '移除连接',
  },
  en: {
    create: 'New skill',
    id: 'Identifier',
    name: 'Name',
    description: 'Purpose and when to use',
    body: 'Instructions (Markdown)',
    template: 'Use template',
    save: 'Save',
    close: 'Close',
    missing: 'Enter an identifier.',
    duplicate: 'This identifier is already in use. Choose another.',
    connectors: 'Connectors',
    market: 'Marketplace',
    search: 'Search connectors',
    connect: 'Connect',
    data: 'Content needed for tool calls is sent to the service.',
    removed: 'Remove connection',
  },
};

for (const language of ['zh', 'en'])
  for (const theme of ['light', 'dark']) {
    test(`skill creation uses readable localized instructions in ${language} ${theme}`, async ({
      page,
    }) => {
      const failures = [];
      attachConsoleGuards(page, failures, 'skill creation copy');
      const copy = strings[language];
      await open(page, language, theme);
      await page.getByRole('button', { name: copy.create, exact: true }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toHaveCSS('opacity', '1');
      const id = dialog.getByLabel(copy.id, { exact: true });
      const content = dialog.getByLabel(copy.body, { exact: true });
      await expect(id).toBeFocused();
      expect(await content.inputValue()).not.toContain('---');
      if (language === 'en') expect(await dialog.innerText()).not.toMatch(/[\u4e00-\u9fff]/);
      await dialog.getByRole('button', { name: copy.save, exact: true }).click();
      await expect(dialog.getByRole('alert')).toHaveText(copy.missing);
      await id.fill('review-notes');
      await dialog.getByLabel(copy.name, { exact: true }).fill('Review notes');
      await dialog.getByLabel(copy.description, { exact: true }).fill('Review meeting notes');
      await content.fill('## Keep my draft\n\nRead the source and cite the result.');
      await content.focus();
      await content.evaluate(element => element.setSelectionRange(3, 10));
      await page.emulateMedia({ colorScheme: theme === 'light' ? 'dark' : 'light' });
      await expect(content).toBeFocused();
      expect(
        await content.evaluate(element => [element.selectionStart, element.selectionEnd]),
      ).toEqual([3, 10]);
      const other = language === 'zh' ? 'en' : 'zh';
      await changeProviderLanguage(page, other);
      await expect(
        dialog.getByRole('heading', { name: strings[other].create, exact: true }),
      ).toBeVisible();
      await expect(dialog.locator('textarea')).toBeFocused();
      await expect(dialog.locator('textarea')).toHaveValue(
        '## Keep my draft\n\nRead the source and cite the result.',
      );
      await changeProviderLanguage(page, language);
      await expect(content).toBeFocused();
      for (const [width, height] of [
        [1440, 900],
        [1280, 800],
        [1024, 768],
        [940, 700],
        [760, 700],
        [448, 640],
      ]) {
        await page.setViewportSize({ width, height });
        const metrics = await dialog.evaluate(element => {
          const rect = element.getBoundingClientRect();
          return {
            fits:
              rect.left >= 0 &&
              rect.right <= innerWidth &&
              rect.top >= 0 &&
              rect.bottom <= innerHeight,
            overflow: element.scrollWidth > element.clientWidth,
            small: [...element.querySelectorAll('label, input, textarea, button')]
              .filter(node => node.getBoundingClientRect().height > 0)
              .some(node => parseFloat(getComputedStyle(node).fontSize) < 14),
          };
        });
        expect(metrics).toEqual({ fits: true, overflow: false, small: false });
        await expect(dialog.getByRole('button', { name: copy.save, exact: true })).toBeInViewport();
      }
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.emulateMedia({ colorScheme: theme });
      await dialog.getByRole('button', { name: copy.save, exact: true }).click();
      await expect(dialog.getByRole('alert')).toHaveText(copy.duplicate);
      await expect(content).toHaveValue('## Keep my draft\n\nRead the source and cite the result.');
      expect(await page.evaluate(() => window.skillCreateCalls[0])).toMatchObject({
        id: 'review-notes',
        name: 'Review notes',
        description: 'Review meeting notes',
        content: '## Keep my draft\n\nRead the source and cite the result.',
      });
      await dialog.getByRole('button', { name: copy.template, exact: true }).click();
      expect(await content.inputValue()).not.toContain('---');
      expect(
        (await new AxeBuilder({ page }).include('[role="dialog"]').analyze()).violations,
      ).toEqual([]);
      await page.screenshot({ path: `/tmp/companion-skill-create-${language}-${theme}.png` });
      await page.evaluate(() => {
        window.holdSkillCreate = true;
      });
      await dialog.getByRole('button', { name: copy.save, exact: true }).click();
      await expect(content).toBeDisabled();
      await page.keyboard.press('Escape');
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('button', { name: copy.close, exact: true })).toHaveCount(0);
      expect(await page.evaluate(() => window.skillCreateCalls.length)).toBe(2);
      await page.evaluate(() => window.finishSkillCreate({ success: true }));
      await expect(dialog).toBeHidden();
      expect(failures).toEqual([]);
    });

    test(`connector permissions describe actual boundaries in ${language} ${theme}`, async ({
      page,
    }) => {
      const copy = strings[language];
      await open(page, language, theme);
      await page.getByRole('tab', { name: copy.connectors, exact: true }).click();
      await page.getByRole('tab', { name: new RegExp(`^${copy.market}`) }).click();
      await page.getByRole('textbox', { name: copy.search, exact: true }).fill('Notion');
      await page.getByRole('button', { name: copy.connect, exact: true }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toHaveCSS('opacity', '1');
      await expect(dialog.getByText(copy.removed, { exact: true })).toBeVisible();
      await expect(dialog.getByText(copy.data, { exact: false })).toBeVisible();
      expect(await dialog.innerText()).not.toMatch(
        /始终可控|安全授权|You stay in control|Secure authorization/,
      );
      for (const width of [1280, 1024, 760, 448]) {
        await page.setViewportSize({ width, height: 700 });
        expect(
          await dialog.evaluate(
            element =>
              element.scrollWidth <= element.clientWidth &&
              element.getBoundingClientRect().bottom <= innerHeight,
          ),
        ).toBe(true);
        await expect(
          dialog.getByRole('button', { name: copy.connect, exact: true }),
        ).toBeInViewport();
      }
      expect(
        (await new AxeBuilder({ page }).include('[role="dialog"]').analyze()).violations,
      ).toEqual([]);
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.screenshot({ path: `/tmp/companion-connect-copy-${language}-${theme}.png` });
    });
  }
