import { Ink, type InkOptions, type Knobs } from '@/companion/looseleaf/ink/builder';
import type { LayerName, Tier } from '@/companion/looseleaf/ink/types';

export type InkLayerName = LayerName | 'indeterminate' | 'open' | 'busy';
export type Density = 'comfortable' | 'compact' | 'calm';
export type Dir = 'ltr' | 'rtl';

export interface Box {
  w: number;
  h: number;
}

const INK_LAYER_ORDER: readonly InkLayerName[] = [
  'rest',
  'disabled',
  'invalid',
  'checked',
  'indeterminate',
  'open',
  'busy',
  'hover',
  'pressed',
  'focus',
];

export function orderLayers<T extends string>(names: readonly T[]): T[] {
  const rank = (k: string) => {
    const i = INK_LAYER_ORDER.indexOf(k as InkLayerName);
    return i < 0 ? INK_LAYER_ORDER.length : i;
  };
  return [...names].sort((a, b) => rank(a) - rank(b));
}

interface RecipeContext {
  readonly tier: Tier;
  readonly density: Density;
  readonly calm: boolean;
  readonly knobs: Knobs;
  readonly dir: Dir;
  readonly seed: string;
  wants(layer: InkLayerName): boolean;
  lazy(layer: InkLayerName, fn: (ink: Ink) => void): void;
  readonly lazyOnly: boolean;
}

export interface RecipeDef<P> {
  id: string;
  kind?: string;
  layers: readonly InkLayerName[];
  lazy?: readonly InkLayerName[];
  pad: number | ((box: Box, params: P, ctx: RecipeContext) => number);
  draw(ink: Ink, box: Box, params: P, ctx: RecipeContext): void;
}

export interface Recipe<P = unknown> extends RecipeDef<P> {
  readonly lazy: readonly InkLayerName[];
  readonly kind: string;
  readonly isInkRecipe: true;
  readonly rev: number;
}

const ID_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const registry = new Map<string, Recipe<never>>();

export function defineRecipe<P = Record<string, never>>(def: RecipeDef<P>): Recipe<P> {
  if (!ID_RE.test(def.id))
    throw new Error(`ink recipe id "${def.id}" must be kebab-case (letters, digits, hyphens)`);
  const lazy = def.lazy ?? [];
  for (const l of lazy)
    if (!def.layers.includes(l))
      throw new Error(`ink recipe "${def.id}": lazy layer "${l}" is not in layers`);
  const recipe: Recipe<P> = {
    ...def,
    lazy,
    kind: def.kind ?? def.id,
    isInkRecipe: true,
    rev: (registry.get(def.id)?.rev ?? 0) + 1,
  };
  registry.set(def.id, recipe as unknown as Recipe<never>);
  return recipe;
}

export const DEFAULT_KNOBS: Knobs = { wobble: 1, misreg: 1, bleed: 1, width: 1 };

export interface RunRequest<P> {
  box: Box;
  params: P;
  seed: string;
  tier: Tier;
  density: Density;
  dir: Dir;
  knobs: Knobs;
  pad?: number;
  lazy?: readonly InkLayerName[];
  lazyOnly?: boolean;
}

export interface RawFrame {
  parts: Partial<Record<InkLayerName, string>>;
  layers: InkLayerName[];
  lazyLayers: InkLayerName[];
  pad: number;
  w: number;
  h: number;
}

export const runCounter = { runs: 0 };

export function runRecipe<P>(recipe: Recipe<P>, req: RunRequest<P>): RawFrame {
  const { box, params } = req;
  const calm = req.density === 'calm';
  const tier: Tier = calm ? 'lo' : req.tier;
  const wanted = new Set<InkLayerName>(req.lazy ?? []);
  const inkOpts: InkOptions = { tier, calm, knobs: req.knobs };
  const seed = `${req.seed}|${recipe.id}`;
  const lazyOnly = req.lazyOnly === true;
  const ctxBase = {
    tier,
    density: req.density,
    calm,
    knobs: req.knobs,
    dir: req.dir,
    seed,
    lazyOnly,
  };
  const lazyParts: Partial<Record<InkLayerName, string>> = {};
  const pad0 = req.pad ?? (typeof recipe.pad === 'number' ? recipe.pad : undefined);
  const ctx: RecipeContext = {
    ...ctxBase,
    wants: layer => wanted.has(layer),
    lazy(layer, fn) {
      if (!wanted.has(layer)) return;
      const li = new Ink(`${seed}|${layer}`, inkOpts);
      li.layer(layer as LayerName, () => fn(li));
      lazyParts[layer] =
        li.toSvg({ w: box.w, h: box.h, pad: pad0 ?? 12 }).parts[layer as LayerName] ?? '';
    },
  };
  const ink = new Ink(seed, inkOpts);
  runCounter.runs++;
  recipe.draw(ink, box, params, ctx);
  const pad =
    req.pad ?? (typeof recipe.pad === 'number' ? recipe.pad : recipe.pad(box, params, ctx));
  const parts: Partial<Record<InkLayerName, string>> = {};
  if (!lazyOnly) {
    const res = ink.toSvg({ w: box.w, h: box.h, pad });
    for (const k of res.layers) {
      const markup = res.parts[k];
      if (markup) parts[k as InkLayerName] = markup;
    }
  }
  const lazyLayers: InkLayerName[] = [];
  for (const k of Object.keys(lazyParts) as InkLayerName[]) {
    if (lazyParts[k]) {
      parts[k] = lazyParts[k];
      lazyLayers.push(k);
    }
  }
  return {
    parts,
    layers: orderLayers(Object.keys(parts) as InkLayerName[]),
    lazyLayers: orderLayers(lazyLayers),
    pad,
    w: box.w,
    h: box.h,
  };
}

let warnedFn = false;

export function stableStringify(v: unknown): string {
  if (v === null || typeof v === 'boolean' || typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '"NaN"';
  if (v === undefined) return 'null';
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o)
      .filter(k => o[k] !== undefined)
      .sort();
    return `{${keys.map(k => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(',')}}`;
  }
  if (!warnedFn) {
    warnedFn = true;
    console.error(
      'ink: recipe params must be plain JSON (found a function or symbol); it cannot be part of the memo key',
    );
  }
  return '"[unhashable]"';
}

export function knobsKey(k: Knobs): string {
  const f = (x: number) => String(Math.round(x * 100) / 100);
  return `${f(k.wobble)},${f(k.misreg)},${f(k.bleed)},${f(k.width)}`;
}

export function bucketBox(w: number, h: number, q: readonly [number, number] = [4, 2]): Box {
  return {
    w: Math.max(q[0], Math.round(w / q[0]) * q[0]),
    h: Math.max(q[1], Math.round(h / q[1]) * q[1]),
  };
}
