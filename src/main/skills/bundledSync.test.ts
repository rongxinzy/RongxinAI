import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { recoverInterruptedUpgrades, syncBundledSkillsToUserData } from './bundledSync';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })),
  );
});

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bundled-skills-'));
  temporaryRoots.push(root);
  const bundled = path.join(root, 'bundled');
  const user = path.join(root, '资料');
  const addFile = async (base: string, relative: string, content: string) => {
    const file = path.join(base, relative);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content);
  };
  return { bundled, user, addFile };
}

const skillVersion = (version: string) => `---\nname: sample\nversion: ${version}\n---\n`;

test('publishes bundled upgrades and repairs while retaining user configuration', async () => {
  const { addFile, bundled, user } = await fixture();
  await addFile(
    bundled,
    'skills.config.json',
    JSON.stringify({ defaults: { sample: {}, repair: {} }, retired: ['old'] }),
  );
  await addFile(bundled, 'sample/SKILL.md', skillVersion('2.0.0'));
  await addFile(bundled, 'sample/scripts/示例.txt', 'new file');
  await addFile(bundled, 'repair/SKILL.md', skillVersion('1.0.0'));
  await addFile(bundled, 'repair/requirements.txt', 'new requirement');
  await addFile(user, 'sample/SKILL.md', skillVersion('1.0.0'));
  await addFile(user, 'sample/.env', 'fixture setting');
  await addFile(user, 'sample/stale.txt', 'old file');
  await addFile(user, 'repair/SKILL.md', skillVersion('1.0.0'));
  await addFile(user, 'repair/user.txt', 'keep me');
  await addFile(user, 'old/SKILL.md', skillVersion('1.0.0'));

  await syncBundledSkillsToUserData(user, bundled);

  await expect(fs.readFile(path.join(user, 'sample/SKILL.md'), 'utf8')).resolves.toBe(
    skillVersion('2.0.0'),
  );
  await expect(fs.readFile(path.join(user, 'sample/scripts/示例.txt'), 'utf8')).resolves.toBe(
    'new file',
  );
  await expect(fs.readFile(path.join(user, 'sample/.env'), 'utf8')).resolves.toBe(
    'fixture setting',
  );
  await expect(fs.stat(path.join(user, 'sample/stale.txt'))).rejects.toMatchObject({
    code: 'ENOENT',
  });
  await expect(fs.stat(path.join(user, 'old'))).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(fs.readFile(path.join(user, 'repair/requirements.txt'), 'utf8')).resolves.toBe(
    'new requirement',
  );
  await expect(fs.readFile(path.join(user, 'repair/user.txt'), 'utf8')).resolves.toBe('keep me');
  expect(await fs.readdir(user)).toEqual(
    expect.arrayContaining(['sample', 'repair', 'skills.config.json']),
  );
  expect((await fs.readdir(user)).some(name => name.startsWith('.bundled-sync-'))).toBe(false);
});

test('recovers the previous tree and keeps it when a new bundle cannot be copied', async () => {
  const { addFile, bundled, user } = await fixture();
  await addFile(bundled, 'sample/SKILL.md', skillVersion('1.0.0'));
  await addFile(bundled, 'sample/requirements.txt', 'needs a repair');
  await addFile(bundled, 'sample/scripts', 'conflicts with existing directory');
  await addFile(user, 'sample.upgrading/SKILL.md', skillVersion('1.0.0'));
  await addFile(user, 'sample.upgrading/scripts/old.txt', 'old file');
  await addFile(user, 'sample/partial', 'interrupted file');
  await addFile(user, '.bundled-sync-ab12CD/incoming/SKILL.md', skillVersion('1.1.0'));
  await recoverInterruptedUpgrades(user);
  await expect(fs.stat(path.join(user, 'sample/partial'))).rejects.toMatchObject({
    code: 'ENOENT',
  });
  await expect(fs.stat(path.join(user, '.bundled-sync-ab12CD'))).rejects.toMatchObject({
    code: 'ENOENT',
  });

  await syncBundledSkillsToUserData(user, bundled);
  await expect(fs.readFile(path.join(user, 'sample/SKILL.md'), 'utf8')).resolves.toBe(
    skillVersion('1.0.0'),
  );
  await expect(fs.readFile(path.join(user, 'sample/scripts/old.txt'), 'utf8')).resolves.toBe(
    'old file',
  );
  await expect(fs.stat(path.join(user, 'sample/requirements.txt'))).rejects.toMatchObject({
    code: 'ENOENT',
  });
});

test('preserves the running standalone Web Search instance control on upgrade', async () => {
  const { addFile, bundled, user } = await fixture();
  const control = 'web-search/.server-control.local.json';
  await addFile(bundled, 'web-search/SKILL.md', skillVersion('2.0.0'));
  await addFile(user, 'web-search/SKILL.md', skillVersion('1.0.0'));
  await addFile(user, control, 'instance control fixture');

  await syncBundledSkillsToUserData(user, bundled);

  await expect(fs.readFile(path.join(user, 'web-search/SKILL.md'), 'utf8')).resolves.toBe(
    skillVersion('2.0.0'),
  );
  await expect(fs.readFile(path.join(user, control), 'utf8')).resolves.toBe(
    'instance control fixture',
  );
});
