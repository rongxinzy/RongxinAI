import type { PaintKey } from '@/companion/looseleaf/ink/paint';
import type { Accent, BasePenName, PenName, PenSpec } from '@/companion/looseleaf/ink/types';

const BASE: PenSpec = {
  kind: 'felt',
  color: 'ink',
  grain: 'felt',
  cls: 'std',
  W: 1.7,
  alpha: 0.92,
  wob: { amp: 0.8, wl: 80, tr: 0.16 },
  step: 1.8,
  halo: 0,
  bleed: 1,
  core: 0.3,
  pool: 1,
  feather: 0,
  skip: 0,
  swell: 0.4,
  dir: 0,
  dryAmt: 0,
  dryWl: 7,
  gaps: 0,
  dens: 0.5,
  taper: 1,
  smear: 0,
  waxy: false,
  nib: 0,
  edge: 0.2,
  wet: 0.2,
  cutK: 0.22,
};

const felt = (color: PaintKey, o: Partial<PenSpec> = {}): PenSpec => ({
  ...BASE,
  kind: 'felt',
  grain: 'felt',
  color,
  halo: 0.14,
  bleed: 1.05,
  core: 0.36,
  pool: 1,
  feather: 0.5,
  skip: 0.3,
  swell: 0.4,
  dir: 0.06,
  dens: 0.5,
  ...o,
});

const pencil = (color: PaintKey, o: Partial<PenSpec> = {}): PenSpec => ({
  ...BASE,
  kind: 'pencil',
  grain: o.waxy ? 'waxy' : 'graphite',
  color,
  W: 1.5,
  alpha: 0.95,
  wob: { amp: 0.6, wl: 110, tr: 0.12 },
  step: 1.3,
  smear: 0.22,
  dens: 0.5,
  ...o,
});

const marker = (color: PaintKey, o: Partial<PenSpec> = {}): PenSpec => ({
  ...BASE,
  kind: 'marker',
  grain: 'marker',
  color,
  W: 9,
  alpha: 0.62,
  nib: -0.75,
  edge: 0.3,
  wet: 0.22,
  bleed: 1,
  wob: { amp: 0.9, wl: 90, tr: 0.1 },
  step: 2.2,
  cutK: 0.22,
  ...o,
});

const FELTS: Record<'ink' | 'blue' | 'redfelt' | 'greenfelt' | 'focus', PenSpec> = {
  ink: felt('ink'),
  blue: felt('ink-you', {
    W: 1.85,
    alpha: 0.9,
    wob: { amp: 0.9, wl: 70, tr: 0.18 },
    halo: 0.16,
    bleed: 1.2,
    core: 0.32,
    pool: 1.1,
    feather: 0.6,
    skip: 0.25,
  }),
  redfelt: felt('red', { W: 1.75, alpha: 0.9, halo: 0.14, bleed: 1, core: 0.32 }),
  greenfelt: felt('green', { W: 1.75, alpha: 0.9, halo: 0.14, bleed: 1, core: 0.32 }),
  focus: felt('focus', {
    W: 2.2,
    alpha: 0.95,
    wob: { amp: 0.9, wl: 70, tr: 0.16 },
    halo: 0.16,
    bleed: 1.2,
    core: 0.3,
    skip: 0.15,
  }),
};

const PENCILS: Record<'pencil' | 'red' | 'green' | 'orange' | 'bluepencil', PenSpec> = {
  pencil: pencil('pencil'),
  red: pencil('red', { alpha: 0.9, smear: 0.26, waxy: true }),
  green: pencil('green', { alpha: 0.9, smear: 0.26, waxy: true }),
  orange: pencil('tangerine', { alpha: 0.9, smear: 0.28, waxy: true }),
  bluepencil: pencil('ink-you', { W: 1.4, alpha: 0.88, smear: 0.26, waxy: true }),
};

function withClass(p: PenSpec, cls: 'fine' | 'brush'): PenSpec {
  if (p.kind === 'felt') {
    return cls === 'fine'
      ? {
          ...p,
          cls,
          W: p.W * 0.68,
          alpha: Math.min(0.96, p.alpha + 0.02),
          wob: { amp: p.wob.amp * 0.7, wl: p.wob.wl * 1.2, tr: p.wob.tr * 0.6 },
          step: 1.6,
          halo: p.halo * 0.55,
          bleed: p.bleed * 0.6,
          core: p.core * 0.8,
          pool: p.pool * 0.7,
          feather: p.feather * 0.4,
          skip: p.skip * 0.4,
          swell: 0.18,
          dir: 0,
          dens: 0.3,
        }
      : {
          ...p,
          cls,
          W: p.W * 2,
          alpha: p.alpha - 0.02,
          wob: { amp: p.wob.amp * 1.1, wl: p.wob.wl * 1.1, tr: p.wob.tr * 0.75 },
          step: 2.2,
          halo: p.halo * 0.85,
          bleed: p.bleed * 1.2,
          core: p.core * 1.1,
          pool: p.pool * 1.15,
          feather: p.feather * 1.1,
          skip: 0.15,
          swell: 0.8,
          dir: 0.38,
          dryAmt: 0.55,
          dryWl: 7,
          gaps: 0.5,
          dens: 0.8,
          taper: 1.6,
        };
  }
  return cls === 'fine'
    ? {
        ...p,
        cls,
        W: p.W * 0.68,
        alpha: p.alpha * 0.92,
        smear: p.smear * 0.8,
        wob: { ...p.wob, amp: p.wob.amp * 0.8 },
        step: 1.1,
      }
    : {
        ...p,
        cls,
        W: p.W * 1.9,
        alpha: p.alpha * 0.88,
        smear: p.smear * 1.4,
        dir: 0.14,
        dryAmt: 0.25,
        step: 1.6,
      };
}

const ACCENTS: readonly Accent[] = [
  'tomato',
  'tangerine',
  'lemon',
  'grass',
  'teal',
  'sky',
  'grape',
  'bubblegum',
];

function build(): Record<PenName, PenSpec> {
  const out = {} as Record<PenName, PenSpec>;
  const base: Record<BasePenName, PenSpec> = { ...FELTS, ...PENCILS };
  for (const k of Object.keys(base) as BasePenName[]) {
    out[k] = base[k];
    out[`${k}.fine`] = withClass(base[k], 'fine');
    out[`${k}.brush`] = withClass(base[k], 'brush');
  }
  out.terracotta = marker('marker');
  out.hi = marker('hi', {
    kind: 'hl',
    W: 14,
    alpha: 0.52,
    nib: 1.45,
    edge: 0.14,
    wet: 0.2,
    bleed: 0.6,
    wob: { amp: 0.5, wl: 160, tr: 0.05 },
    step: 2.4,
    cutK: 0.28,
  });
  for (const c of ACCENTS) {
    out[`m_${c}`] = marker(c);
    out[`f_${c}`] = felt(c);
  }
  return out;
}

const PENS: Readonly<Record<PenName, PenSpec>> = build();

export function pen(p: PenName | PenSpec, over?: Partial<PenSpec>): PenSpec {
  const base = typeof p === 'string' ? PENS[p] : p;
  if (!base) throw new Error(`ink: unknown pen "${String(p)}"`);
  return over ? { ...base, ...over, wob: { ...base.wob, ...over.wob } } : base;
}
