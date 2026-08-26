import path from 'node:path';

import { describe, expect, test } from 'vitest';

import { SkillRootRegistry } from './skillRootRegistry';

describe('Skill root registry', () => {
  test('appends registered absolute roots without duplicating existing roots', () => {
    const registry = new SkillRootRegistry();
    const primary = path.resolve('primary-skills');
    const managed = path.resolve('managed-skills');
    registry.register(primary);
    registry.register(managed);

    expect(registry.appendTo([primary])).toEqual([primary, managed]);
  });

  test('reference-counts duplicate registrations and unregisters idempotently', () => {
    const registry = new SkillRootRegistry();
    const managed = path.resolve('managed-skills');
    const unregisterFirst = registry.register(managed);
    const unregisterSecond = registry.register(managed);

    unregisterFirst();
    unregisterFirst();
    expect(registry.appendTo([])).toEqual([managed]);

    unregisterSecond();
    expect(registry.appendTo([])).toEqual([]);
  });

  test('rejects relative roots', () => {
    expect(() => new SkillRootRegistry().register('relative/skills')).toThrow(/absolute/);
  });
});
