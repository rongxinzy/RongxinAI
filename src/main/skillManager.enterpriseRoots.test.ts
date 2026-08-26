import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, expect, test, vi } from 'vitest';

import { SkillManager } from './skillManager';
import { skillRootRegistry } from './skillRootRegistry';
import type { SqliteStore } from './sqliteStore';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('discovers Skills from a registered additional root until it is unregistered', () => {
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
    expect(manager.listSkills()).toEqual(
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

  expect(manager.listSkills().some(skill => skill.id === 'managed-demo')).toBe(false);
});
