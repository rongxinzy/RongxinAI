import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, expect, test, vi } from 'vitest';

import { SkillManager } from './skillManager';
import { skillRootRegistry } from './skillRootRegistry';
import { SKILL_STATE_KEY } from './skills/constants';
import type { SqliteStore } from './sqliteStore';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

const createManager = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyuan-skill-state-'));
  temporaryDirectories.push(root);
  const managedDirectory = path.join(root, 'managed-demo');
  fs.mkdirSync(managedDirectory);
  fs.writeFileSync(
    path.join(managedDirectory, 'SKILL.md'),
    '---\nname: Managed Demo\ndescription: Managed by the host\n---\n\n# Managed Demo\n',
  );
  const persisted = new Map<string, unknown>();
  const store = {
    get: vi.fn((key: string) => persisted.get(key)),
    set: vi.fn((key: string, value: unknown) => {
      persisted.set(key, value);
    }),
  } as unknown as SqliteStore;
  const unregister = skillRootRegistry.register(root);
  const manager = new SkillManager(() => store);
  return { manager, store, unregister };
};

const persistedState = (store: SqliteStore) => {
  const writes = vi.mocked(store.set).mock.calls.filter(call => call[0] === SKILL_STATE_KEY);
  return (writes.at(-1)?.[1] ?? null) as Record<
    string,
    { enabled: boolean; pinned?: boolean }
  > | null;
};

test('enabling an unknown Skill never writes state for it', () => {
  const { manager, store, unregister } = createManager();
  try {
    manager.setSkillEnabled('skill-that-does-not-exist', true);
    expect(persistedState(store)).toBeNull();
    expect(store.set).not.toHaveBeenCalled();
  } finally {
    unregister();
  }
});

test('pinning an unknown Skill never writes state for it', () => {
  const { manager, store, unregister } = createManager();
  try {
    manager.setSkillPinned('skill-that-does-not-exist', true);
    expect(store.set).not.toHaveBeenCalled();
  } finally {
    unregister();
  }
});

test('batch enable filters unknown ids but keeps known ones', () => {
  const { manager, store, unregister } = createManager();
  try {
    manager.setSkillsEnabled(['managed-demo', 'skill-that-does-not-exist'], false);
    expect(persistedState(store)).toEqual({ 'managed-demo': { enabled: false } });
  } finally {
    unregister();
  }
});

test('known Skills still toggle and pin', () => {
  const { manager, store, unregister } = createManager();
  try {
    const disabled = manager.setSkillEnabled('managed-demo', false);
    expect(disabled.find(skill => skill.id === 'managed-demo')?.enabled).toBe(false);
    expect(persistedState(store)).toEqual({ 'managed-demo': { enabled: false } });

    manager.setSkillPinned('managed-demo', true);
    expect(persistedState(store)).toEqual({ 'managed-demo': { enabled: false, pinned: true } });
  } finally {
    unregister();
  }
});

test('core Skills still refuse to be disabled without writing state', () => {
  const { manager, store, unregister } = createManager();
  try {
    manager.setSkillEnabled('docx', false);
    expect(store.set).not.toHaveBeenCalled();
  } finally {
    unregister();
  }
});
