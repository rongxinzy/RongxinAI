import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  DESKTOP_PET_BUILTINS,
  DesktopPetBuiltinId,
  desktopPetBuiltin,
} from '../../shared/desktopPet/catalog';
import { DESKTOP_PET_STORE_KEY } from '../../shared/desktopPet/constants';
import { isDesktopPetReleased } from '../../shared/desktopPet/availability';
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
type ProfileSnapshot = z.infer<typeof saved>;

export interface CompanionProfileStore {
  get<T>(key: string): T | undefined;
  set(key: string, value: unknown): void;
  onDidChange(key: string, listener: (value: unknown, previous: unknown) => void): () => void;
}

/** One host-owned identity collection; appearances never serve as storage keys. */
export class CompanionProfiles {
  constructor(
    private readonly store: CompanionProfileStore,
    private readonly available: (id: string) => boolean = isDesktopPetReleased,
  ) {}

  private storedSnapshot(): ProfileSnapshot | undefined {
    const raw = this.store.get(STORE_KEY);
    if (raw === undefined) return;
    // Never replace an existing malformed identity collection and strand its history.
    const result = saved.safeParse(raw);
    if (!result.success) throw new Error('Invalid companion identities');
    const ids = new Set(result.data.profiles.map(item => item.petId));
    if (ids.size !== result.data.profiles.length || !ids.has(result.data.activePetId))
      throw new Error('Companion identities are inconsistent');
    return result.data;
  }

  snapshot(): ProfileSnapshot {
    const state = this.storedSnapshot();
    if (state) return state;
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

  private visibleProfiles(state: ProfileSnapshot): ProfileSnapshot {
    const profiles = state.profiles
      .filter(item => this.available(item.personaId))
      .map(item =>
        this.available(item.characterId) ? item : { ...item, characterId: item.personaId },
      );
    const active = profiles.find(item => item.petId === state.activePetId) ?? profiles[0];
    if (!active) throw new Error('No released companion identity is available');
    return { activePetId: active.petId, profiles };
  }

  visibleSnapshot(): ProfileSnapshot {
    return this.visibleProfiles(this.snapshot());
  }

  onChanged(listener: (activePetChanged: boolean) => void): () => void {
    return this.store.onDidChange(STORE_KEY, (value, previous) => {
      if (previous === undefined) return;
      listener(
        (value as ProfileSnapshot | undefined)?.activePetId !==
          (previous as ProfileSnapshot | null)?.activePetId,
      );
    });
  }

  storedActive(): CompanionProfile | undefined {
    try {
      const state = this.storedSnapshot();
      if (!state) return;
      const visible = this.visibleProfiles(state);
      return visible.profiles.find(item => item.petId === visible.activePetId);
    } catch (error) {
      console.warn('[Companion] Failed to restore the active appearance:', error);
    }
  }

  active(): CompanionProfile {
    const state = this.visibleSnapshot();
    return state.profiles.find(item => item.petId === state.activePetId)!;
  }

  select(petId: string): CompanionProfile {
    const state = this.snapshot();
    const selected = state.profiles.find(
      item => item.petId === petId && this.available(item.personaId),
    );
    if (!selected) throw new Error('Unknown companion');
    this.store.set(STORE_KEY, { ...state, activePetId: petId });
    return this.available(selected.characterId)
      ? selected
      : { ...selected, characterId: selected.personaId };
  }

  changeAppearance(petId: string, characterId: DesktopPetBuiltinId): CompanionProfile {
    character.parse(characterId);
    if (!this.available(characterId)) throw new Error('Companion appearance is not released');
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
