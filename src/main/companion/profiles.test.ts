import { expect, test } from 'vitest';
import { DesktopPetBuiltinId } from '../../shared/desktopPet/catalog';
import { DESKTOP_PET_STORE_KEY } from '../../shared/desktopPet/constants';
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
  // Exercise retained multi-companion behavior separately from the single-character release.
  return { values, store, profiles: new CompanionProfiles(store, () => true) };
}

test('creates seven persistent identities, with only one active companion', () => {
  const f = fixture();
  const first = f.profiles.snapshot();
  expect(first.profiles).toHaveLength(7);
  expect(new Set(first.profiles.map(profile => profile.petId)).size).toBe(7);
  expect(new CompanionProfiles(f.store).snapshot()).toEqual(first);
  expect(f.profiles.active().petId).toBe(first.activePetId);
});

test('preserves the current appearance when creating the first companion identity', () => {
  const f = fixture();
  f.values.set(DESKTOP_PET_STORE_KEY, { characterId: DesktopPetBuiltinId.Yunmo });
  expect(f.profiles.active()).toMatchObject({
    personaId: DesktopPetBuiltinId.Xiaoyuan,
    characterId: DesktopPetBuiltinId.Yunmo,
  });
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

test('the release hides dormant identities without rewriting their saved appearance or active owner', () => {
  const f = fixture();
  const all = f.profiles.snapshot();
  f.profiles.changeAppearance(all.profiles[0].petId, DesktopPetBuiltinId.Youli);
  f.profiles.select(all.profiles[1].petId);
  const preserved = structuredClone(f.values.get('companion_profiles'));
  const released = new CompanionProfiles(f.store, id => id === DesktopPetBuiltinId.Xiaoyuan);
  expect(released.visibleSnapshot().profiles).toEqual([
    { ...all.profiles[0], characterId: DesktopPetBuiltinId.Xiaoyuan },
  ]);
  expect(released.active().petId).toBe(all.profiles[0].petId);
  expect(() => released.select(all.profiles[1].petId)).toThrow('Unknown');
  expect(() => released.changeAppearance(all.profiles[0].petId, DesktopPetBuiltinId.Youli)).toThrow(
    'not released',
  );
  expect(f.values.get('companion_profiles')).toEqual(preserved);
  expect(new CompanionProfiles(f.store, () => true).active().petId).toBe(all.profiles[1].petId);
});

test('all seven released identities restore their saved owner and appearance without replacing history keys', () => {
  const f = fixture();
  const state = f.profiles.snapshot();
  f.profiles.select(state.profiles[3].petId);
  const preserved = structuredClone(f.values.get('companion_profiles'));
  const released = new CompanionProfiles(f.store);
  expect(released.visibleSnapshot().profiles).toEqual(state.profiles);
  expect(released.active().petId).toBe(state.profiles[3].petId);
  expect(f.values.get('companion_profiles')).toEqual(preserved);
  for (const item of state.profiles) {
    expect(released.select(item.petId)).toEqual(item);
    expect(released.changeAppearance(item.petId, item.characterId)).toEqual(item);
  }
});
