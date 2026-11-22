import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, expect, test, vi } from 'vitest';

import { SkillManager } from './skillManager';
import { skillRootRegistry } from './skillRootRegistry';
import { readSkillCatalog, type SkillCatalogInput } from './skills/skillRecords';
import type { SqliteStore } from './sqliteStore';
import { readSkillCatalogAsync } from './workbenchTask/artifactWorkerPool';

vi.mock('./workbenchTask/artifactWorkerPool', () => ({
  readSkillCatalogAsync: vi.fn(async (input: SkillCatalogInput) => readSkillCatalog(input)),
}));

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('discovers Skills from a registered additional root until it is unregistered', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyuan-additional-skills-'));
  temporaryDirectories.push(root);
  const skillDirectory = path.join(root, 'managed-demo');
  fs.mkdirSync(skillDirectory);
  fs.writeFileSync(
    path.join(skillDirectory, 'SKILL.md'),
    '---\nname: Managed Demo\ndescription: Managed by the host\n---\n\n# Managed Demo\n',
  );
  const store = {
    get: vi.fn(() => undefined),
    set: vi.fn(),
  } as unknown as SqliteStore;
  const manager = new SkillManager(() => store);
  const unregister = skillRootRegistry.register(root);

  try {
    expect(await manager.listSkills()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'managed-demo',
          name: 'Managed Demo',
          skillPath: path.join(skillDirectory, 'SKILL.md'),
        }),
      ]),
    );
  } finally {
    unregister();
  }

  expect((await manager.listSkills()).some(skill => skill.id === 'managed-demo')).toBe(false);
});

test('discards an in-flight catalog after a managed root is unregistered', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyuan-withdrawn-skills-'));
  temporaryDirectories.push(root);
  fs.writeFileSync(path.join(root, 'SKILL.md'), '---\nname: Withdrawn Skill\n---\n');
  const manager = new SkillManager(() => ({ get: vi.fn() }) as unknown as SqliteStore);
  const unregister = skillRootRegistry.register(root);
  const selected = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  vi.mocked(readSkillCatalogAsync).mockImplementationOnce(async input => {
    const snapshot = readSkillCatalog(input);
    expect(snapshot.some(skill => skill.name === 'Withdrawn Skill')).toBe(true);
    selected.resolve();
    await release.promise;
    return snapshot;
  });
  const pending = manager.listSkills();
  try {
    await Promise.race([selected.promise, pending]);
  } finally {
    unregister();
    release.resolve();
  }
  expect((await pending).some(skill => skill.name === 'Withdrawn Skill')).toBe(false);
});
