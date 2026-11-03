import type { Knobs } from '@/companion/looseleaf/ink/builder';
import type { Tier } from '@/companion/looseleaf/ink/types';
import {
  bucketBox,
  knobsKey,
  orderLayers,
  runCounter,
  runRecipe,
  stableStringify,
  type Box,
  type Density,
  type Dir,
  type InkLayerName,
  type RawFrame,
  type Recipe,
} from '@/companion/looseleaf/ink/recipes';

export interface FrameRequest<P> {
  box: Box;
  params: P;
  seed: string;
  tier: Tier;
  density: Density;
  dir: Dir;
  knobs: Knobs;
  pad?: number;
  lazy?: readonly InkLayerName[];
  paramsKey?: string;
}

export interface Frame {
  key: string;
  parts: Partial<Record<InkLayerName, string>>;
  layers: InkLayerName[];
  pad: number;
  w: number;
  h: number;
  chars: number;
}

interface Entry {
  raw: RawFrame;
  lazy: Partial<Record<InkLayerName, string>>;
  chars: number;
}

class InkCache {
  private map = new Map<string, Entry>();
  private max = 600;
  private maxChars = 6_000_000;
  private chars = 0;
  hits = 0;
  misses = 0;

  get(key: string): Entry | undefined {
    const e = this.map.get(key);
    if (e) {
      this.map.delete(key);
      this.map.set(key, e);
    }
    return e;
  }

  set(key: string, e: Entry): void {
    const old = this.map.get(key);
    if (old) this.chars -= old.chars;
    this.map.delete(key);
    this.map.set(key, e);
    this.chars += e.chars;
    this.evict();
  }

  grow(e: Entry, chars: number): void {
    e.chars += chars;
    this.chars += chars;
    this.evict();
  }

  private evict(): void {
    for (const k of this.map.keys()) {
      if (this.map.size <= 1 || (this.map.size <= this.max && this.chars <= this.maxChars)) break;
      const e = this.map.get(k);
      if (e) this.chars -= e.chars;
      this.map.delete(k);
    }
  }

  resize(o: { max?: number; maxChars?: number }): void {
    if (o.max !== undefined) this.max = Math.max(1, o.max);
    if (o.maxChars !== undefined) this.maxChars = Math.max(1, o.maxChars);
    this.evict();
  }

  clear(): void {
    this.map.clear();
    this.chars = 0;
  }

  stats(): { hits: number; misses: number; runs: number; size: number; chars: number } {
    return {
      hits: this.hits,
      misses: this.misses,
      runs: runCounter.runs,
      size: this.map.size,
      chars: this.chars,
    };
  }
}

const inkCache = new InkCache();

const sum = (parts: Partial<Record<string, string>>): number => {
  let c = 0;
  for (const k in parts) c += parts[k]?.length ?? 0;
  return c;
};

function frameKey<P>(recipe: Recipe<P>, req: FrameRequest<P>): string {
  const b = bucketBox(req.box.w, req.box.h);
  const tier = req.density === 'calm' ? 'lo' : req.tier;
  return [
    `${recipe.id}@${recipe.rev}`,
    `${b.w}x${b.h}`,
    req.seed,
    tier,
    req.density,
    req.dir,
    req.pad ?? '',
    req.paramsKey ?? stableStringify(req.params),
    knobsKey(req.knobs),
  ].join('|');
}

export function inkFrame<P>(recipe: Recipe<P>, req: FrameRequest<P>): Frame {
  const key = frameKey(recipe, req);
  const box = bucketBox(req.box.w, req.box.h);
  const want = (req.lazy ?? []).filter(l => recipe.lazy.includes(l));
  const run = (lazy: readonly InkLayerName[], lazyOnly: boolean): RawFrame =>
    runRecipe(recipe, { ...req, box, lazy, lazyOnly });
  let entry = inkCache.get(key);
  if (entry) inkCache.hits++;
  else {
    inkCache.misses++;
    const raw = run(want, false);
    const lazy: Entry['lazy'] = {};
    const parts: RawFrame['parts'] = {};
    for (const k of raw.layers) {
      if (raw.lazyLayers.includes(k)) lazy[k] = raw.parts[k];
      else parts[k] = raw.parts[k];
    }
    for (const l of want) lazy[l] ??= '';
    entry = {
      raw: { ...raw, parts, layers: orderLayers(Object.keys(parts) as InkLayerName[]) },
      lazy,
      chars: sum(parts) + sum(lazy),
    };
    inkCache.set(key, entry);
  }
  const missing = want.filter(l => entry.lazy[l] === undefined);
  if (missing.length) {
    const raw = run(missing, true);
    for (const l of missing) entry.lazy[l] = raw.parts[l] ?? '';
    inkCache.grow(entry, sum(raw.parts));
  }
  const parts: Frame['parts'] = { ...entry.raw.parts };
  for (const l of want) if (entry.lazy[l]) parts[l] = entry.lazy[l];
  return {
    key,
    parts,
    layers: orderLayers(Object.keys(parts) as InkLayerName[]),
    pad: entry.raw.pad,
    w: box.w,
    h: box.h,
    chars: sum(parts),
  };
}
