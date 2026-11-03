import type {
  BBox,
  GrainKind,
  LayerName,
  Line,
  Material,
  PenName,
  PenSpec,
  Pt,
  StrokeOpts,
  StrokeResult,
  Tier,
} from '@/companion/looseleaf/ink/types';
import { BLEND, esc, n, paint, type PaintKey } from '@/companion/looseleaf/ink/paint';
import { hashSeed, makeRng, type Rng } from '@/companion/looseleaf/ink/rng';
import { TIERS, smoothClosed } from '@/companion/looseleaf/ink/geom';
import { dot as penDot, stroke as penStroke } from '@/companion/looseleaf/ink/pen';
import { pen as resolvePen } from '@/companion/looseleaf/ink/pens';

export const GRAINS: readonly GrainKind[] = ['felt', 'marker', 'graphite', 'waxy', 'stamp'];

const MASK_VARIANTS = 6;

function maskId(grain: GrainKind, variant: number): string {
  return `ll-${grain}-${((variant % MASK_VARIANTS) + MASK_VARIANTS) % MASK_VARIANTS}`;
}

export interface Knobs {
  wobble: number;
  misreg: number;
  bleed: number;
  width: number;
}

export interface InkOptions {
  tier?: Tier;
  grain?: boolean;
  calm?: boolean;
  knobs?: Partial<Knobs>;
}

export interface GroupAttrs {
  transform?: string;
  clip?: string;
  opacity?: number;
  id?: string;
  part?: string;
  vars?: Record<string, number>;
  hideOn?: string;
  mask?: string;
}

export interface InkResult {
  svg: string;
  w: number;
  h: number;
  pad: number;
  layers: LayerName[];
  parts: Partial<Record<LayerName, string>>;
  bbox: BBox;
}

interface PathItem {
  d: string;
  fill: PaintKey;
  op: number;
  rule?: 'evenodd';
  stroke?: PaintKey;
  sw?: number;
  clip?: string;
}
type Item = PathItem | { raw: string } | { scope: Scope };

class Scope {
  buckets: Partial<Record<Material, Item[]>> = {};
  readonly attrs?: GroupAttrs;
  constructor(attrs?: GroupAttrs) {
    this.attrs = attrs;
  }
  add(mat: Material, item: Item): void {
    (this.buckets[mat] ??= []).push(item);
  }
}

const ORDER: readonly Material[] = [
  'under',
  'wash',
  'hl',
  'marker',
  'pencil',
  'waxy',
  'text',
  'felt',
  'stamp',
  'top',
];
const GRAIN_OF: Partial<Record<Material, GrainKind>> = {
  marker: 'marker',
  pencil: 'graphite',
  waxy: 'waxy',
  text: 'felt',
  felt: 'felt',
  stamp: 'stamp',
};
const BLENDED: ReadonlySet<Material> = new Set(['hl', 'marker']);
const SUBTLE: ReadonlySet<GrainKind> = new Set(['marker', 'felt']);

type Piece =
  | { t: 'raw'; s: string }
  | { t: 'mat'; grain?: GrainKind; blend: boolean; kids: Piece[] }
  | { t: 'grp'; pre: string; open: string; kids: Piece[]; plain: boolean };

const mergeOpts = (a: StrokeOpts | undefined, b: StrokeOpts | undefined): StrokeOpts => {
  if (!a) return b ?? {};
  if (!b) return a;
  return {
    ...a,
    ...b,
    width: (a.width ?? 1) * (b.width ?? 1),
    alpha: (a.alpha ?? 1) * (b.alpha ?? 1),
  };
};

export class Ink {
  readonly rng: Rng;
  readonly seed: number;
  readonly tier: Tier;
  readonly grain: boolean;
  readonly calm: boolean;
  readonly knobs: Knobs;
  readonly variant: number;
  private readonly tag: string;
  private count = 0;
  private defCount = 0;
  private readonly roots = new Map<LayerName, Scope>();
  private leaned = false;
  private cur: Scope;
  private bb: BBox = [Infinity, Infinity, -Infinity, -Infinity];

  constructor(seed: string | number, opts: InkOptions = {}) {
    this.rng = makeRng(seed);
    this.seed = this.rng.seed;
    this.calm = opts.calm ?? false;
    this.tier = this.calm ? 'lo' : (opts.tier ?? 'lo');
    this.grain = opts.grain ?? true;
    this.knobs = { wobble: 1, misreg: 1, bleed: 1, width: 1, ...opts.knobs };
    if (this.calm) {
      this.knobs.wobble *= 0.3;
      this.knobs.misreg = 0;
      this.knobs.width *= 0.85;
    }
    this.variant = this.seed % MASK_VARIANTS;
    this.tag = this.seed.toString(36);
    this.cur = this.rootOf('rest');
  }

  lean(): void {
    this.leaned = true;
  }

  private rootOf(name: LayerName): Scope {
    let s = this.roots.get(name);
    if (!s) this.roots.set(name, (s = new Scope()));
    return s;
  }

  next(name: string): Rng {
    return this.rng.fork(`${name}:${this.count++}`);
  }

  grow(bb: BBox): void {
    const b = this.bb;
    if (bb[0] < b[0]) b[0] = bb[0];
    if (bb[1] < b[1]) b[1] = bb[1];
    if (bb[2] > b[2]) b[2] = bb[2];
    if (bb[3] > b[3]) b[3] = bb[3];
  }

  layer(name: LayerName, fn: () => void): void {
    const prev = this.cur;
    this.cur = this.rootOf(name);
    try {
      fn();
    } finally {
      this.cur = prev;
    }
  }

  group(attrs: GroupAttrs, fn: () => void, at: Material = 'top'): void {
    const scope = new Scope(attrs);
    this.cur.add(at, { scope });
    const prev = this.cur;
    this.cur = scope;
    try {
      fn();
    } finally {
      this.cur = prev;
    }
  }

  part(name: string, fn: () => { dx: number; dy: number } | void, at: Material = 'wash'): void {
    const attrs: GroupAttrs = { part: name };
    this.group(
      attrs,
      () => {
        const off = fn();
        if (off) attrs.vars = { mx: off.dx, my: off.dy };
      },
      at,
    );
  }

  clipDef(d: string): string {
    const id = `ll-c${hashSeed(d).toString(36)}`;
    this.cur.add('under', { raw: `<clipPath id="${id}"><path d="${d}"/></clipPath>` });
    return id;
  }

  define(fn: () => void): string {
    const id = `ll-${this.tag}-${this.defCount++}`;
    const scope = new Scope();
    const prev = this.cur;
    this.cur = scope;
    try {
      fn();
    } finally {
      this.cur = prev;
    }
    this.cur.add('under', { raw: `<defs><g id="${id}">${this.emitScope(scope)}</g></defs>` });
    return id;
  }

  use(
    id: string,
    o: { x?: number; y?: number; transform?: string } = {},
    at: Material = 'top',
  ): void {
    const xy = (o.x ? ` x="${n(o.x)}"` : '') + (o.y ? ` y="${n(o.y)}"` : '');
    this.cur.add(at, {
      raw: `<use href="#${id}"${xy}${o.transform ? ` transform="${o.transform}"` : ''}/>`,
    });
  }

  stroke(pts: Pt[], penIn: PenName | PenSpec = 'ink', o: StrokeOpts = {}): StrokeResult {
    let P = resolvePen(penIn);
    if (this.knobs.bleed !== 1) P = { ...P, bleed: P.bleed * this.knobs.bleed };
    const r = this.next('s');
    const jr = r.fork('jit');
    const width = (o.width ?? 1) * this.knobs.width * (1 + jr.gauss(0, 0.05));
    const alpha =
      (o.alpha ?? 1) *
      (this.tier === 'hi' ? Math.min(1.08, Math.max(0.92, 1 + jr.gauss(0, 0.04))) : 1);
    const res = penStroke(pts, P, r, {
      ...o,
      tier: this.tier,
      wobble: (o.wobble ?? 1) * this.knobs.wobble,
      width,
      alpha,
    });
    return this.put(res, P);
  }

  lines(lines: Line[], penIn: PenName | PenSpec = 'ink', o?: StrokeOpts): void {
    for (const l of lines) this.stroke(l.pts, l.pen ?? penIn, mergeOpts(l.o, o));
  }

  dot(
    cx: number,
    cy: number,
    r: number,
    penIn: PenName | PenSpec = 'ink',
    o: StrokeOpts = {},
  ): void {
    const P = resolvePen(penIn);
    const res = penDot(cx, cy, r, P, this.next('d'), {
      ...o,
      tier: this.tier,
      width: (o.width ?? 1) * this.knobs.width,
    });
    this.put(res, P);
  }

  private put(res: StrokeResult, P: PenSpec): StrokeResult {
    for (const L of res.layers) {
      const item: PathItem = { d: L.d, fill: L.fill, op: L.op, rule: L.rule };
      let mat: Material;
      if (P.kind === 'felt')
        mat = (L.k === 'halo' || L.k === 'hair') && !this.leaned ? 'wash' : 'felt';
      else if (P.kind === 'pencil') mat = P.waxy ? 'waxy' : 'pencil';
      else mat = P.kind === 'marker' ? 'marker' : 'hl';
      this.cur.add(mat, item);
    }
    this.grow(res.bbox);
    return res;
  }

  flat(
    material: Material,
    d: string,
    fill: PaintKey,
    op = 1,
    extra: { rule?: 'evenodd'; stroke?: PaintKey; sw?: number; bbox?: BBox; clip?: string } = {},
  ): void {
    if (!d) return;
    this.cur.add(material, {
      d,
      fill,
      op,
      rule: extra.rule,
      stroke: extra.stroke,
      sw: extra.sw,
      clip: extra.clip,
    });
    if (extra.bbox) this.grow(extra.bbox);
  }

  poly(material: Material, pts: Pt[], fill: PaintKey, op = 1): void {
    if (pts.length < 3) return;
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    for (const p of pts) {
      if (p[0] < x0) x0 = p[0];
      if (p[0] > x1) x1 = p[0];
      if (p[1] < y0) y0 = p[1];
      if (p[1] > y1) y1 = p[1];
    }
    this.flat(material, smoothClosed(pts, TIERS[this.tier]), fill, op, { bbox: [x0, y0, x1, y1] });
  }

  raw(svg: string, material: Material = 'text'): void {
    if (svg) this.cur.add(material, { raw: svg });
  }

  text(
    x: number,
    y: number,
    s: string,
    o: {
      size: number;
      fill?: PaintKey;
      font?: string;
      anchor?: 'start' | 'middle' | 'end';
      weight?: number;
    } = { size: 16 },
  ): void {
    const attrs =
      `x="${n(x)}" y="${n(y)}" font-size="${n(o.size)}" fill="${paint(o.fill ?? 'ink')}" font-family="${esc(o.font ?? 'var(--font-hand, cursive)')}"` +
      (o.anchor ? ` text-anchor="${o.anchor}"` : '') +
      (o.weight ? ` font-weight="${o.weight}"` : '');
    this.raw(`<text ${attrs}>${esc(s)}</text>`, 'text');
  }

  private itemNodes(items: Item[]): Piece[] {
    const q = this.tier === 'lo' ? 50 : 100;
    const merged = new Map<string, PathItem>();
    const seq: Array<PathItem | Piece> = [];
    for (const it of items) {
      if ('raw' in it) {
        seq.push({ t: 'raw', s: it.raw });
      } else if ('scope' in it) {
        seq.push(this.groupNode(it.scope));
      } else if (it.rule || it.stroke) {
        seq.push(it);
      } else {
        const op = Math.round(it.op * q) / q;
        const key = `${it.fill}|${op}|${it.clip ?? ''}`;
        const m = merged.get(key);
        if (m) m.d += it.d;
        else {
          const c = { ...it, op };
          merged.set(key, c);
          seq.push(c);
        }
      }
    }
    const out: Piece[] = [];
    for (const it of seq) {
      if ('t' in it) {
        out.push(it);
        continue;
      }
      const op = n(it.op, 100);
      const clip = it.clip ? ` clip-path="url(#${it.clip})"` : '';
      if (it.stroke) {
        out.push({
          t: 'raw',
          s: `<path d="${it.d}" fill="none" stroke="${paint(it.stroke)}" stroke-width="${n(it.sw ?? 1)}" stroke-linecap="round" stroke-linejoin="round"${it.op < 0.995 ? ` stroke-opacity="${op}"` : ''}${clip}/>`,
        });
      } else {
        out.push({
          t: 'raw',
          s: `<path d="${it.d}" fill="${paint(it.fill)}"${it.op < 0.995 ? ` fill-opacity="${op}"` : ''}${it.rule ? ` fill-rule="${it.rule}"` : ''}${clip}/>`,
        });
      }
    }
    return out;
  }

  private scopeNodes(scope: Scope): Piece[] {
    const out: Piece[] = [];
    for (const mat of ORDER) {
      const items = scope.buckets[mat];
      if (!items || !items.length) continue;
      const kids = this.itemNodes(items);
      const grain = this.grain ? GRAIN_OF[mat] : undefined;
      const blend = BLENDED.has(mat);
      if (!grain && !blend) out.push(...kids);
      else out.push({ t: 'mat', grain, blend, kids });
    }
    return out;
  }

  private groupNode(scope: Scope): Piece {
    const a = scope.attrs ?? {};
    const kids = this.scopeNodes(scope);
    let pre = '';
    let attrs = '';
    if (a.clip) {
      const id = `ll-c${hashSeed(a.clip).toString(36)}`;
      pre = `<clipPath id="${id}"><path d="${a.clip}"/></clipPath>`;
      attrs += ` clip-path="url(#${id})"`;
    }
    if (a.transform) attrs += ` transform="${a.transform}"`;
    if (a.opacity !== undefined && a.opacity < 1) attrs += ` opacity="${n(a.opacity, 100)}"`;
    if (a.id) attrs += ` id="${esc(a.id)}"`;
    if (a.part) attrs += ` data-part="${esc(a.part)}"`;
    if (a.hideOn) attrs += ` data-hide-on="${esc(a.hideOn)}"`;
    if (a.mask) attrs += ` mask="url(#${esc(a.mask)})"`;
    if (a.vars)
      attrs += ` style="${Object.entries(a.vars)
        .map(([k, v]) => `--${k}:${n(v)}`)
        .join(';')}"`;
    const plain =
      !a.clip && !a.transform && !(a.opacity !== undefined && a.opacity < 1) && !a.id && !a.mask;
    return { t: 'grp', pre, open: `<g${attrs}>`, kids, plain };
  }

  private static subtle(nd: Piece): nd is Extract<Piece, { t: 'mat' }> {
    return (
      nd.t === 'mat' && !!nd.grain && SUBTLE.has(nd.grain) && nd.kids.every(k => k.t === 'raw')
    );
  }

  private static pure(nd: Piece): boolean {
    return (
      nd.t === 'grp' &&
      nd.plain &&
      !nd.pre &&
      nd.kids.length > 0 &&
      nd.kids.every(k => Ink.subtle(k) || Ink.pure(k))
    );
  }

  private static bare(nd: Piece): Piece[] {
    if (nd.t === 'mat') return nd.kids;
    if (nd.t === 'grp') return [{ ...nd, kids: nd.kids.flatMap(k => Ink.bare(k)) }];
    return [nd];
  }

  private static grainsIn(nd: Piece, into: Array<{ grain?: GrainKind; blend: boolean }>): void {
    if (nd.t === 'mat') into.push({ grain: nd.grain, blend: nd.blend });
    else if (nd.t === 'grp') for (const k of nd.kids) Ink.grainsIn(k, into);
  }

  private leanMerge(nodes: Piece[]): Piece[] {
    const out: Piece[] = [];
    let run: Piece[] = [];
    const flush = (): void => {
      if (run.length < 2) {
        out.push(...run);
      } else {
        const found: Array<{ grain?: GrainKind; blend: boolean }> = [];
        for (const r of run) Ink.grainsIn(r, found);
        out.push({
          t: 'mat',
          grain: found.some(f => f.grain === 'marker') ? 'marker' : 'felt',
          blend: found.some(f => f.blend),
          kids: run.flatMap(r => Ink.bare(r)),
        });
      }
      run = [];
    };
    for (const nd of nodes) {
      if (Ink.subtle(nd) || Ink.pure(nd)) {
        run.push(nd);
      } else {
        flush();
        out.push(nd.t === 'grp' ? { ...nd, kids: this.leanMerge(nd.kids) } : nd);
      }
    }
    flush();
    return out;
  }

  private static join(nodes: Piece[]): Piece[] {
    const out: Piece[] = [];
    for (const nd of nodes) {
      const last = out[out.length - 1];
      if (
        nd.t === 'mat' &&
        last &&
        last.t === 'mat' &&
        last.grain === nd.grain &&
        last.blend === nd.blend
      )
        last.kids = [...last.kids, ...nd.kids];
      else out.push(nd.t === 'mat' ? { ...nd } : nd);
    }
    return out.map(nd => (nd.t === 'grp' ? { ...nd, kids: Ink.join(nd.kids) } : nd));
  }

  private print(nodes: Piece[]): string {
    let out = '';
    for (const nd of nodes) {
      if (nd.t === 'raw') out += nd.s;
      else if (nd.t === 'grp') out += `${nd.pre}${nd.open}${this.print(nd.kids)}</g>`;
      else {
        const mask = nd.grain ? ` mask="url(#${maskId(nd.grain, this.variant)})"` : '';
        const style = nd.blend ? ` style="mix-blend-mode:${BLEND}"` : '';
        out += `<g${mask}${style}>${this.print(nd.kids)}</g>`;
      }
    }
    return out;
  }

  private emitScope(scope: Scope): string {
    let nodes = this.scopeNodes(scope);
    if (this.leaned && this.grain) nodes = this.leanMerge(nodes);
    return this.print(Ink.join(nodes));
  }

  toSvg(o: { w: number; h: number; pad?: number; layers?: LayerName[] }): InkResult {
    const names = [...this.roots.keys()].filter(k => !o.layers || o.layers.includes(k));
    const parts: Partial<Record<LayerName, string>> = {};
    for (const name of names) parts[name] = this.emitScope(this.roots.get(name) as Scope);
    const b = this.bb;
    const fin = (v: number): number => (Number.isFinite(v) ? v : 0);
    const bbox: BBox = [fin(b[0]), fin(b[1]), fin(b[2]), fin(b[3])];
    const excursion = Math.max(0, -bbox[0], -bbox[1], bbox[2] - o.w, bbox[3] - o.h);
    const pad = o.pad ?? Math.max(2, Math.ceil(excursion) + 1);
    const svg =
      names.length === 1
        ? (parts[names[0]] as string)
        : names.map(k => `<g data-layer="${k}">${parts[k]}</g>`).join('');
    return { svg, w: o.w, h: o.h, pad, layers: names, parts, bbox };
  }
}

export function inkViewBox(res: { w: number; h: number; pad: number }): string {
  return `${n(-res.pad)} ${n(-res.pad)} ${n(res.w + 2 * res.pad)} ${n(res.h + 2 * res.pad)}`;
}
