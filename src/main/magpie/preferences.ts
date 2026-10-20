import type {
  MagpieModelRef,
  MagpiePreferences,
  MagpiePreferencesPatch,
  MagpieSearchChoice,
} from '../../shared/magpie/preferences';
import { MAGPIE_PREFERENCE_PATCH_KEYS } from '../../shared/magpie/preferences';

const PATCH_KEYS = new Set<string>(MAGPIE_PREFERENCE_PATCH_KEYS);

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function bool(value: unknown): boolean {
  return value === true;
}

function number(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function strings(value: unknown, limit = 500): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string').slice(0, limit);
}

function projectModelRef(value: unknown): MagpieModelRef | null {
  const item = record(value);
  const id = text(item.id).trim();
  if (!id) return null;
  return {
    id,
    ...(text(item.name).trim() ? { name: text(item.name).trim() } : {}),
    ...(text(item.providerName).trim() ? { providerName: text(item.providerName).trim() } : {}),
    ...(item.vendorPicks === true ? { vendorPicks: true } : {}),
  };
}

function projectModelRefs(value: unknown): MagpieModelRef[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(projectModelRef)
    .filter((item): item is MagpieModelRef => item !== null)
    .slice(0, 500);
}

function projectSearchChoices(value: unknown): MagpieSearchChoice[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(item => {
      const choice = record(item);
      const id = text(choice.id).trim();
      const name = text(choice.name).trim();
      if (!id) return null;
      return {
        id,
        name: name || id,
        ...(choice.service === true ? { service: true } : {}),
        models: projectModelRefs(choice.models),
      };
    })
    .filter((item): item is MagpieSearchChoice => item !== null)
    .slice(0, 100);
}

function projectRedactKinds(value: unknown): Record<string, boolean> {
  const source = record(value);
  const result: Record<string, boolean> = {};
  for (const [key, enabled] of Object.entries(source).slice(0, 50)) {
    if (typeof enabled === 'boolean') result[key] = enabled;
  }
  return result;
}

export function projectMagpiePreferences(raw: unknown): MagpiePreferences {
  const value = record(raw);
  return {
    gateway: text(value.gateway),
    ...(text(value.publicURL) ? { publicUrl: text(value.publicURL) } : {}),
    proxy: text(value.proxy),
    proxyNow: text(value.proxyNow),
    proxySource: text(value.proxySource),
    bareModelIDs: bool(value.bareModelIDs),
    port: number(value.port),
    ...(text(value.addrEnv) ? { portEnv: text(value.addrEnv) } : {}),
    lan: bool(value.lan),
    onNetwork: bool(value.onNetwork),
    lanUrls: strings(value.lanURLs, 20),
    vision: text(value.vision),
    ...(text(value.visionAuto) ? { visionAuto: text(value.visionAuto) } : {}),
    ...(text(value.visionMissing) ? { visionMissing: text(value.visionMissing) } : {}),
    visionEffort: text(value.visionEffort),
    visionEfforts: strings(value.visionEfforts, 20),
    visionModels: projectModelRefs(value.visionModels),
    imageGen: text(value.imageGen),
    ...(text(value.imageGenAuto) ? { imageGenAuto: text(value.imageGenAuto) } : {}),
    ...(text(value.imageGenMissing) ? { imageGenMissing: text(value.imageGenMissing) } : {}),
    ...(text(value.imageGenShown) ? { imageGenShown: text(value.imageGenShown) } : {}),
    imageGenModels: projectModelRefs(value.imageGenModels),
    searcher: text(value.searcher),
    searcherEffort: text(value.searcherEffort),
    searchFirst: text(value.searchFirst),
    ...(text(value.searchAuto) ? { searchAuto: text(value.searchAuto) } : {}),
    ...(text(value.searchUnused) ? { searchUnused: text(value.searchUnused) } : {}),
    searchEfforts: strings(value.searchEfforts, 20),
    searchChoices: projectSearchChoices(value.searchChoices),
    ...(text(value.searchProvider) ? { searchProvider: text(value.searchProvider) } : {}),
    searchRelays: strings(value.searchRelays, 20),
    disabledModels: strings(value.disabledModels, 500),
    redact: bool(value.redact),
    redactPersonal: bool(value.redactPersonal),
    redactKinds: projectRedactKinds(value.redactKinds),
    redactWords: strings(value.redactWords, 200),
    noAccountDiscovery: bool(value.noAccountDiscovery),
    noAccountsEnv: bool(value.noAccountsEnv),
  };
}

function assertString(value: unknown, key: string, maxLength: number): string {
  if (typeof value !== 'string' || value.length > maxLength) {
    throw new Error(`Invalid ${key} preference`);
  }
  return value;
}

function assertBoolean(value: unknown, key: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`Invalid ${key} preference`);
  return value;
}

function assertStringList(
  value: unknown,
  key: string,
  maxItems: number,
  maxLength: number,
): string[] {
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new Error(`Invalid ${key} preference`);
  }
  return value.map(item => {
    if (typeof item !== 'string' || item.length > maxLength) {
      throw new Error(`Invalid ${key} preference`);
    }
    return item;
  });
}

function assertRedactKinds(value: unknown): Record<string, boolean> {
  const source = record(value);
  const entries = Object.entries(source);
  if (entries.length > 50) throw new Error('Invalid redactKinds preference');
  const result: Record<string, boolean> = {};
  for (const [key, enabled] of entries) {
    if (key.length === 0 || key.length > 40 || typeof enabled !== 'boolean') {
      throw new Error('Invalid redactKinds preference');
    }
    result[key] = enabled;
  }
  return result;
}

/**
 * Builds the full settings document upstream expects. Secrets and host-owned
 * fields are carried from the current document, never from the renderer.
 */
export function mergeMagpiePreferences(
  raw: unknown,
  patch: MagpiePreferencesPatch,
): Record<string, unknown> {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new Error('Invalid preferences patch');
  }
  for (const key of Object.keys(patch)) {
    if (!PATCH_KEYS.has(key)) throw new Error(`Unsupported preference: ${key}`);
  }
  const next = { ...record(raw) };
  if (patch.proxy !== undefined) next.proxy = assertString(patch.proxy, 'proxy', 2048);
  if (patch.bareModelIDs !== undefined) {
    next.bareModelIDs = assertBoolean(patch.bareModelIDs, 'bareModelIDs');
  }
  if (patch.vision !== undefined) next.vision = assertString(patch.vision, 'vision', 512);
  if (patch.visionEffort !== undefined) {
    next.visionEffort = assertString(patch.visionEffort, 'visionEffort', 80);
  }
  if (patch.imageGen !== undefined) next.imageGen = assertString(patch.imageGen, 'imageGen', 512);
  if (patch.searcher !== undefined) next.searcher = assertString(patch.searcher, 'searcher', 512);
  if (patch.searcherEffort !== undefined) {
    next.searcherEffort = assertString(patch.searcherEffort, 'searcherEffort', 80);
  }
  if (patch.searchFirst !== undefined) {
    next.searchFirst = assertString(patch.searchFirst, 'searchFirst', 20);
  }
  if (patch.disabledModels !== undefined) {
    next.disabledModels = assertStringList(patch.disabledModels, 'disabledModels', 500, 256);
  }
  if (patch.redact !== undefined) next.redact = assertBoolean(patch.redact, 'redact');
  if (patch.redactPersonal !== undefined) {
    next.redactPersonal = assertBoolean(patch.redactPersonal, 'redactPersonal');
  }
  if (patch.redactKinds !== undefined) next.redactKinds = assertRedactKinds(patch.redactKinds);
  if (patch.redactWords !== undefined) {
    next.redactWords = assertStringList(patch.redactWords, 'redactWords', 200, 256);
  }
  return next;
}
