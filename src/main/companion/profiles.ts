import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  DESKTOP_PET_BUILTINS,
  DesktopPetBuiltinId,
  desktopPetBuiltin,
} from '../../shared/desktopPet/catalog';
import { DESKTOP_PET_STORE_KEY } from '../../shared/desktopPet/constants';
import type { CompanionProfile } from '../../shared/companion/types';

const STORE_KEY = 'companion_profiles';
const character = z.enum(Object.values(DesktopPetBuiltinId));
const profile = z.object({
  petId: z.uuid(),
  personaId: character,
  characterId: character,
  createdAt: z.number().int().nonnegative(),
});
const saved = z.object({ activePetId: z.uuid(), profiles: z.array(profile).min(1).max(32) });

export interface CompanionProfileStore {
  get<T>(key: string): T | undefined;
  set(key: string, value: unknown): void;
}

/** One host-owned identity collection; appearances never serve as storage keys. */
export class CompanionProfiles {
  constructor(private readonly store: CompanionProfileStore) {}

  snapshot(): { activePetId: string; profiles: CompanionProfile[] } {
    const result = saved.safeParse(this.store.get(STORE_KEY));
    if (result.success) {
      const ids = new Set(result.data.profiles.map(item => item.petId));
      if (ids.size === result.data.profiles.length && ids.has(result.data.activePetId))
        return result.data;
      throw new Error('Companion identities are inconsistent');
    }
    // Never replace an existing malformed identity collection and strand its history.
    if (this.store.get(STORE_KEY) !== undefined) throw new Error('Invalid companion identities');
    const profiles = DESKTOP_PET_BUILTINS.map(item => ({
      petId: randomUUID(),
      personaId: item.id,
      characterId: item.id,
      createdAt: Date.now(),
    }));
    const value = { activePetId: profiles[0].petId, profiles };
    const appearance = this.store.get<{ characterId?: string }>(DESKTOP_PET_STORE_KEY)?.characterId;
    const selected = appearance ? desktopPetBuiltin(appearance) : undefined;
    if (selected) profiles[0].characterId = selected.id;
    this.store.set(STORE_KEY, value);
    return value;
  }

  active(): CompanionProfile {
    const state = this.snapshot();
    return state.profiles.find(item => item.petId === state.activePetId)!;
  }

  select(petId: string): CompanionProfile {
    const state = this.snapshot();
    const selected = state.profiles.find(item => item.petId === petId);
    if (!selected) throw new Error('Unknown companion');
    this.store.set(STORE_KEY, { ...state, activePetId: petId });
    return selected;
  }

  changeAppearance(petId: string, characterId: DesktopPetBuiltinId): CompanionProfile {
    character.parse(characterId);
    const state = this.snapshot();
    const selected = state.profiles.find(item => item.petId === petId);
    if (!selected) throw new Error('Unknown companion');
    const updated = { ...selected, characterId };
    this.store.set(STORE_KEY, {
      ...state,
      profiles: state.profiles.map(item => (item.petId === petId ? updated : item)),
    });
    return updated;
  }
}
