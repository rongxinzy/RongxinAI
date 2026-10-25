import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';
import { expect } from '@playwright/test';
import yaml from 'js-yaml';

// Manual check: actual owned IPC and a unique, verified test directory; no model calls.
const root = fileURLToPath(new URL('../..', import.meta.url));
const userData = await fs.mkdtemp('/tmp/companion-skill-create-');
const id = `native-ui-${randomUUID()}`.slice(0, 40);
const directory = path.join(root, 'SKILLs', id);
const markdownFile = path.join(directory, 'SKILL.md');
await fs.access(directory).then(
  () => {
    throw new Error('Test directory already exists');
  },
  error => {
    if (error.code !== 'ENOENT') throw error;
  },
);
const env = {
  ...process.env,
  NODE_ENV: 'development',
  ELECTRON_START_URL: `http://127.0.0.1:${process.env.PREVIEW_PORT ?? 5194}`,
  ZHIYUAN_MEMORY_LEAK_TEST_USER_DATA: userData,
};
delete env.ELECTRON_RUN_AS_NODE;
let application;
try {
  application = await electron.launch({ args: ['.'], cwd: root, env, timeout: 60_000 });
  const page = await application.firstWindow();
  page.setDefaultTimeout(20_000);
  await page.getByRole('button', { name: /^(专家|Expert)$/ }).click();
  await page.getByRole('tab', { name: /^(技能|Skills)$/ }).click();
  await page.getByRole('button', { name: /^(新建技能|New skill)$/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toHaveCSS('opacity', '1');
  const input = dialog.getByLabel(/^(标识|Identifier)$/);
  // The persisted identifier limit is 40; use a unique bounded suffix.
  const boundedId = id;
  await input.fill(boundedId);
  await dialog.getByLabel(/^(名称|Name)$/).fill('Native UI verification');
  await dialog
    .getByLabel(/^(用途与使用时机|Purpose and when to use)$/)
    .fill('Review native UI evidence');
  const content = await dialog
    .getByLabel(/^(执行说明（Markdown）|Instructions \(Markdown\))$/)
    .inputValue();
  expect(content).not.toContain('---');
  await page.screenshot({ path: path.join(userData, 'create-skill.png') });
  await dialog.getByRole('button', { name: /^(保存|Save)$/ }).click();
  await expect(dialog).toBeHidden();
  const result = await page.evaluate(
    async id => (await window.electron.skills.list()).skills.find(skill => skill.id === id),
    boundedId,
  );
  expect(result?.enabled).toBe(true);
  const file = path.join(root, 'SKILLs', boundedId, 'SKILL.md');
  const saved = await fs.readFile(file, 'utf8');
  const parts = saved.split(/^---\s*$/m);
  expect(parts).toHaveLength(3);
  expect(yaml.load(parts[1])).toMatchObject({
    name: boundedId,
    description: 'Review native UI evidence',
  });
  expect(parts[2]).toContain('# Native UI verification');
  expect(parts[2].trimEnd()).toContain(content.trim());
  const report = {
    passed: true,
    userData,
    boundedId,
    ownedIpc: true,
    enabledAfterCreate: true,
    singleFrontmatter: true,
    bodyPreserved: true,
    modelCallsRequested: false,
  };
  await fs.writeFile(path.join(userData, 'result.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  await application?.close();
  // Never remove an unexpected directory: verify our exact identifier and known title first.
  const content = await fs.readFile(markdownFile, 'utf8').catch(() => null);
  if (content?.includes('name: ' + id) && content.includes('# Native UI verification'))
    await fs.rm(directory, { recursive: true });
}
