'use client';

import * as React from 'react';

import type { Knobs } from '@/companion/looseleaf/ink/builder';
import type { Tier } from '@/companion/looseleaf/ink/types';
import { ensureInkDefs } from '@/companion/looseleaf/ink/react/defs';
import { inkFrame, type Frame } from '@/companion/looseleaf/ink/react/cache';
import { InkSvg } from '@/companion/looseleaf/ink/react/svg';
import {
  DEFAULT_KNOBS,
  bucketBox,
  stableStringify,
  type Box,
  type Density,
  type Dir,
  type InkLayerName,
  type Recipe,
} from '@/companion/looseleaf/ink/recipes';

interface InkScopeProps {
  'data-density'?: Density;
  'data-motion'?: 'reduced';
  'data-theme'?: string;
}

interface InkContextValue {
  tier: Tier;
  density: Density;
  dir: Dir;
  motion: 'system' | 'reduced';
  knobs: Knobs;
  hasProvider: boolean;
  scope?: InkScopeProps;
}

const DEFAULT_INK_CONTEXT: InkContextValue = {
  tier: 'lo',
  density: 'comfortable',
  dir: 'ltr',
  motion: 'system',
  knobs: DEFAULT_KNOBS,
  hasProvider: false,
};

const InkContext = React.createContext<InkContextValue>(DEFAULT_INK_CONTEXT);

const useInkContext = (): InkContextValue => React.useContext(InkContext);

function useInkSeed(seed?: string | number): string {
  const id = React.useId();
  return seed === undefined ? id : String(seed);
}

let sharedObserver: ResizeObserver | null = null;
const watchers = new WeakMap<Element, Set<() => void>>();

function observe(el: Element, cb: () => void): () => void {
  if (typeof ResizeObserver === 'undefined') return () => {};
  sharedObserver ??= new ResizeObserver(entries => {
    for (const e of entries) watchers.get(e.target)?.forEach(f => f());
  });
  let set = watchers.get(el);
  if (!set) {
    watchers.set(el, (set = new Set()));
    sharedObserver.observe(el);
  }
  set.add(cb);
  return () => {
    set.delete(cb);
    if (!set.size) {
      watchers.delete(el);
      sharedObserver?.unobserve(el);
    }
  };
}

function readSize(el: Element): [number, number] {
  const h = el as HTMLElement;
  if (typeof h.offsetWidth === 'number') return [h.offsetWidth, h.offsetHeight];
  const r = el.getBoundingClientRect();
  return [r.width, r.height];
}

function useInkBox(o: { size?: readonly [number, number] } = {}): {
  ref: React.RefCallback<Element>;
  box: Box | null;
} {
  const [box, setBox] = React.useState<Box | null>(() =>
    o.size ? bucketBox(o.size[0], o.size[1]) : null,
  );
  const ref = React.useCallback((el: Element | null) => {
    if (!el) return;
    const update = () => {
      const [w, h] = readSize(el);
      if (!(w > 0 && h > 0)) return;
      const b = bucketBox(w, h);
      setBox(prev => (prev && prev.w === b.w && prev.h === b.h ? prev : b));
    };
    update();
    return observe(el, update);
  }, []);
  return { ref, box };
}

export interface UseInkOptions<P> {
  recipe: Recipe<P>;
  params: P;
  kind?: string;
  pad?: number;
  size?: readonly [number, number];
  tier?: Tier;
  layers?: 'lazy' | 'all' | readonly InkLayerName[];
  seed?: string | number;
  still?: boolean;
}

interface InkHostProps {
  'data-ink-host': '';
  'data-ink-ready'?: '';
}

interface UseInkCore {
  hostRef: React.RefCallback<HTMLElement>;
  hostProps: InkHostProps;
  frame: Frame | null;
  box: Box | null;
  seed: string;
  still: boolean;
}

const EMPTY: readonly InkLayerName[] = [];

const TRIGGERS: Partial<Record<InkLayerName, readonly string[]>> = {
  focus: ['focusin'],
  hover: ['pointerenter'],
  pressed: ['pointerdown', 'keydown'],
};

function focusVisible(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return true;
  try {
    return target.matches(':focus-visible');
  } catch {
    return true;
  }
}

function detectDir(el: Element): Dir | null {
  const d =
    el.closest('[dir]')?.getAttribute('dir') ??
    el.ownerDocument.documentElement.getAttribute('dir');
  return d === 'rtl' || d === 'ltr' ? d : null;
}

function useInkCore<P>(o: UseInkOptions<P>): UseInkCore {
  const ctx = useInkContext();
  const seed = useInkSeed(o.seed);
  const tier = o.tier ?? ctx.tier;
  const { recipe } = o;
  const { ref: boxRef, box } = useInkBox({ size: o.size });
  const [lazyOn, setLazyOn] = React.useState<readonly InkLayerName[]>(EMPTY);
  const [seen, setSeen] = React.useState<{ dir: Dir; under: Dir } | null>(null);
  const dir = seen && (!ctx.hasProvider || seen.under === ctx.dir) ? seen.dir : ctx.dir;

  const want = React.useCallback(
    (layer: InkLayerName) => setLazyOn(cur => (cur.includes(layer) ? cur : [...cur, layer])),
    [],
  );
  const lazyDecl = recipe.lazy;

  const hostRef = React.useCallback(
    (el: HTMLElement | null) => {
      if (!el) return;
      const stopBox = boxRef(el);
      const cleanups: Array<() => void> = [];
      if (typeof stopBox === 'function') cleanups.push(stopBox);
      const d = detectDir(el);
      if (d) setSeen({ dir: d, under: ctx.dir });
      for (const layer of lazyDecl) {
        for (const type of TRIGGERS[layer] ?? []) {
          const on = (e: Event) => {
            if (layer === 'focus' && !focusVisible(e.target)) return;
            if (
              e.type === 'keydown' &&
              (e as KeyboardEvent).key !== 'Enter' &&
              (e as KeyboardEvent).key !== ' '
            )
              return;
            want(layer);
          };
          el.addEventListener(type, on, { passive: true });
          cleanups.push(() => el.removeEventListener(type, on));
        }
      }
      if (
        lazyDecl.includes('focus') &&
        el.contains(el.ownerDocument.activeElement) &&
        focusVisible(el.ownerDocument.activeElement)
      )
        want('focus');
      if (!ctx.hasProvider) ensureInkDefs();
      return () => {
        for (const c of cleanups) c();
      };
    },
    [boxRef, lazyDecl, want, ctx.hasProvider, ctx.dir],
  );

  const eager: readonly InkLayerName[] =
    o.layers === 'all' || (o.layers === undefined && tier === 'hi')
      ? lazyDecl
      : Array.isArray(o.layers)
        ? (o.layers as readonly InkLayerName[])
        : EMPTY;
  const lazyKey = [...new Set([...eager, ...lazyOn])].sort().join(',');
  const paramsKey = stableStringify(o.params);
  const frame = React.useMemo(
    () =>
      box
        ? inkFrame(recipe, {
            box,
            params: o.params,
            seed,
            tier,
            density: ctx.density,
            dir,
            knobs: ctx.knobs,
            pad: o.pad,
            paramsKey,
            lazy: lazyKey ? (lazyKey.split(',') as InkLayerName[]) : undefined,
          })
        : null,
    [recipe, box, seed, tier, ctx.density, dir, ctx.knobs, o.pad, o.params, paramsKey, lazyKey],
  );
  const still = o.still ?? (ctx.density === 'calm' || ctx.motion === 'reduced');
  const hostProps: InkHostProps = frame
    ? { 'data-ink-host': '', 'data-ink-ready': '' }
    : { 'data-ink-host': '' };
  return { hostRef, hostProps, frame, box, seed, still };
}

export interface UseInkResult {
  hostRef: React.RefCallback<HTMLElement>;
  hostProps: InkHostProps;
  node: React.ReactElement | null;
  box: Box | null;
  seed: string;
}

export function useInk<P>(o: UseInkOptions<P>): UseInkResult {
  const { hostRef, hostProps, frame, box, seed, still } = useInkCore(o);
  const node = frame
    ? React.createElement(InkSvg, { key: 'ink', kind: o.kind ?? o.recipe.kind, frame, still })
    : null;
  return { hostRef, hostProps, node, box, seed };
}
