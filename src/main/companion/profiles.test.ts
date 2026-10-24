import { expect, test } from 'vitest';
import { DesktopPetBuiltinId } from '../../shared/desktopPet/catalog';
import { CompanionProfiles, type CompanionProfileStore } from './profiles';
import { companionInstructions } from './personas';

function fixture() {
  const values = new Map<string, unknown>();
  const store: CompanionProfileStore = {
    get: <T>(key: string) => values.get(key) as T | undefined,
    set: (key, value) => {
      values.set(key, structuredClone(value));
    },
  };
  return { values, store, profiles: new CompanionProfiles(store) };
}

test('creates seven persistent identities, with only one active companion', () => {
  const f = fixture();
  const first = f.profiles.snapshot();
  expect(first.profiles).toHaveLength(7);
  expect(new Set(first.profiles.map(profile => profile.petId)).size).toBe(7);
  expect(new CompanionProfiles(f.store).snapshot()).toEqual(first);
  expect(f.profiles.active().petId).toBe(first.activePetId);
});

test('changing appearance keeps identity and personality; selecting another companion is separate', () => {
  const f = fixture();
  const original = f.profiles.active();
  const changed = f.profiles.changeAppearance(original.petId, DesktopPetBuiltinId.Youli);
  expect(changed).toEqual({ ...original, characterId: DesktopPetBuiltinId.Youli });
  const other = f.profiles.snapshot().profiles[1];
  f.profiles.select(other.petId);
  expect(f.profiles.active()).toEqual(other);
  f.profiles.select(original.petId);
  expect(f.profiles.active()).toEqual(changed);
});

test('refuses corrupted identities instead of replacing them and stranding history', () => {
  const f = fixture();
  const state = f.profiles.snapshot();
  f.values.set('companion_profiles', {
    ...state,
    activePetId: state.profiles[1].petId,
    profiles: [state.profiles[0]],
  });
  expect(() => f.profiles.snapshot()).toThrow('inconsistent');
  f.values.set('companion_profiles', { invalid: true });
  expect(() => f.profiles.snapshot()).toThrow('Invalid');
});

test('all seven personalities have distinct concise native instructions and shared truthfulness boundaries', () => {
  const prompts = Object.values(DesktopPetBuiltinId).map(companionInstructions);
  expect(new Set(prompts).size).toBe(7);
  for (const prompt of prompts) {
    expect(prompt.length).toBeLessThan(650);
    expect(prompt).toContain('not accuracy or permissions');
    expect(prompt).toContain('Do not claim actions');
  }
});
