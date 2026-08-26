import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, test, vi } from 'vitest';

import { ZHIYUAN_ENTERPRISE_SKILL_CAPABILITY_API_VERSION } from './contract';
import { ZhiyuanEnterpriseSkillBridge } from './skillBridge';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('Zhiyuan enterprise Skill bridge', () => {
  test('registers a host-owned managed directory and refreshes on demand', () => {
    const userDataPath = createTemporaryDirectory();
    const refreshSkills = vi.fn();
    const unregisterRoot = vi.fn();
    const registerSkillRoot = vi.fn(() => unregisterRoot);
    const bridge = new ZhiyuanEnterpriseSkillBridge({
      userDataPath,
      refreshSkills,
      registerSkillRoot,
    });

    const registration = bridge.registerManagedRoot();
    const expectedDirectory = path.join(userDataPath, 'zhiyuan-enterprise', 'managed-skills');
    expect(bridge.apiVersion).toBe(ZHIYUAN_ENTERPRISE_SKILL_CAPABILITY_API_VERSION);
    expect(registration.directory).toBe(expectedDirectory);
    expect(fs.statSync(expectedDirectory).isDirectory()).toBe(true);
    expect(registerSkillRoot).toHaveBeenCalledWith(expectedDirectory);

    registration.notifyChanged();
    expect(refreshSkills).toHaveBeenCalledOnce();
  });

  test('allows one active registration and releases it idempotently', () => {
    const unregisterRoot = vi.fn();
    const bridge = new ZhiyuanEnterpriseSkillBridge({
      userDataPath: createTemporaryDirectory(),
      refreshSkills: vi.fn(),
      registerSkillRoot: () => unregisterRoot,
    });
    const registration = bridge.registerManagedRoot();

    expect(() => bridge.registerManagedRoot()).toThrow(/already registered/);
    registration.unregister();
    registration.unregister();
    registration.notifyChanged();
    expect(unregisterRoot).toHaveBeenCalledOnce();

    expect(() => bridge.registerManagedRoot()).not.toThrow();
  });

  test('rejects a relative user data path', () => {
    expect(
      () =>
        new ZhiyuanEnterpriseSkillBridge({
          userDataPath: 'relative',
          refreshSkills: vi.fn(),
        }),
    ).toThrow(/absolute/);
  });
});

function createTemporaryDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyuan-skill-bridge-'));
  temporaryDirectories.push(directory);
  return directory;
}
