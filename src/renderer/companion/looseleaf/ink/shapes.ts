import type { Line, PenName, PenSpec, Pt, StrokeOpts } from '@/companion/looseleaf/ink/types';
import type { Ink } from '@/companion/looseleaf/ink/builder';
import { clamp, type Rng } from '@/companion/looseleaf/ink/rng';
import { TAU, seg } from '@/companion/looseleaf/ink/geom';

export interface ShapeOpts {
  pen?: PenName | PenSpec;
  opts?: StrokeOpts;
  loose?: number;
}

const dirv = (a: Pt, b: Pt): Pt => {
  const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
};

function put(
  ink: Ink,
  salt: string,
  gen: (rng: Rng) => Line[],
  defaultPen: PenName,
  o: ShapeOpts,
): void {
  ink.lines(gen(ink.next(salt)), o.pen ?? defaultPen, o.opts);
}

export function chain(vs: Pt[], bows: number[], rad: number, rng: Rng, cnt = 14): Pt[] {
  const E = vs.length - 1;
  const d: Pt[] = [],
    len: number[] = [];
  for (let i = 0; i < E; i++) {
    d.push(dirv(vs[i], vs[i + 1]));
    len.push(Math.hypot(vs[i + 1][0] - vs[i][0], vs[i + 1][1] - vs[i][1]));
  }
  const rv: number[] = new Array(E + 1).fill(0);
  for (let j = 1; j < E; j++) {
    const r = Math.min(rad * (0.75 + rng() * 0.5), len[j - 1] * 0.45, len[j] * 0.45);
    rv[j] = r < 0.6 ? 0 : r;
  }
  const out: Pt[] = [];
  for (let i = 0; i < E; i++) {
    const s: Pt = [vs[i][0] + d[i][0] * rv[i], vs[i][1] + d[i][1] * rv[i]];
    const e: Pt = [vs[i + 1][0] - d[i][0] * rv[i + 1], vs[i + 1][1] - d[i][1] * rv[i + 1]];
    const pts = seg(
      s[0],
      s[1],
      e[0],
      e[1],
      bows[i] || 0,
      Math.max(2, Math.ceil(Math.hypot(e[0] - s[0], e[1] - s[1]) / cnt)),
    );
    if (i > 0 && rv[i] === 0) pts.shift();
    out.push(...pts);
    if (i < E - 1 && rv[i + 1] > 0) {
      const V = vs[i + 1],
        r = rv[i + 1];
      const a = e;
      const b: Pt = [V[0] + d[i + 1][0] * r, V[1] + d[i + 1][1] * r];
      const k = 0.9 + rng() * 0.1;
      const c: Pt = [
        V[0] * k + ((a[0] + b[0]) / 2) * (1 - k),
        V[1] * k + ((a[1] + b[1]) / 2) * (1 - k),
      ];
      for (let j = 1; j < 4; j++) {
        const t = j / 4,
          u = 1 - t;
        out.push([
          u * u * a[0] + 2 * u * t * c[0] + t * t * b[0],
          u * u * a[1] + 2 * u * t * c[1] + t * t * b[1],
        ]);
      }
    }
  }
  return out;
}

export const RULER: StrokeOpts = {
  poly: true,
  raw: true,
  start: 'soft',
  end: 'soft',
  speed: 1,
  dry: 0,
};

interface BoxOpts {
  corner?: number;
  loose?: number;
  wobble?: number;
}

function boxLines(rng: Rng, x: number, y: number, w: number, h: number, o: BoxOpts = {}): Line[] {
  const k = o.loose ?? 1;
  const m = Math.min(w, h);
  const jc = clamp(0.012 * m, 0.12, 0.4) * k;
  const tilt = rng.gauss(0, 0.0012) * k;
  const rad = o.corner ?? clamp(m * 0.09, 0.9, 3.4);
  const C = (px: number, py: number, sy: number): Pt => [
    px + rng.gauss(0, jc),
    py + rng.gauss(0, jc) + sy * tilt * w,
  ];
  const TL = C(x, y, 0),
    TR = C(x + w, y, 1),
    BR = C(x + w, y + h, 1),
    BL = C(x, y + h, 0);
  const lift = (l: number): number => rng.range(0.05, 0.32) * clamp(l / 110, 0.3, 1.2) * k;
  const drift = (l: number): number => rng.gauss(0, 0.1) * clamp(l / 40, 0.4, 1) * k;
  const t0 = rng.range(0.35, 0.65);
  const S: Pt = [TL[0] + (TR[0] - TL[0]) * t0, TL[1] + (TR[1] - TL[1]) * t0];
  const run = Math.min(0.06 * w, rng.range(1.6, 2.6));
  const vs: Pt[] = [S, TR, BR, BL, TL, [S[0] + run, S[1]]];
  const bows = [-lift(w * (1 - t0)), drift(h), lift(w), drift(h), -lift(w * t0 + run)];
  return [
    {
      pts: chain(vs, bows, rad, rng),
      o: { speed: 1, wobble: 0.28 * (o.wobble ?? 1), dry: 0, end: 'soft', start: 'soft' },
    },
  ];
}

function loopLines(
  rng: Rng,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  o: {
    turns?: number;
    a0?: number;
    drift?: number;
    breathe?: number;
    loose?: number;
    clean?: boolean;
  } = {},
): Line[] {
  if (o.clean) {
    const a0 = o.a0 ?? rng.range(-2.9, -1.8);
    const steps = Math.max(24, Math.ceil((rx + ry) * 0.6));
    const turn = 1 + 2.2 / Math.max(6, Math.PI * (rx + ry));
    const ph = rng.range(0, TAU);
    const pts: Pt[] = [];
    for (let i = 0; i <= steps; i++) {
      const a = a0 + (i / steps) * turn * TAU;
      const kk = 1 + 0.006 * Math.sin(2 * a + ph);
      pts.push([cx + Math.cos(a) * rx * kk, cy + Math.sin(a) * ry * kk]);
    }
    return [{ pts, o: { end: 'soft', start: 'soft', wobble: 0.25, speed: 1, dry: 0 } }];
  }
  const turns = o.turns ?? rng.range(1.05, 1.18);
  const a0 = o.a0 ?? rng.range(-2.9, -1.8);
  const tilt = rng.gauss(0, 0.05) * (o.loose ?? 1);
  const drift = o.drift ?? rng.range(-0.07, 0.05);
  const breathe = o.breathe ?? 0.035;
  const ph = rng.range(0, TAU);
  const steps = Math.max(16, Math.ceil((rx + ry) * turns * 0.5));
  const pts: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps,
      a = a0 + t * turns * TAU;
    const kk = 1 + breathe * Math.sin(2 * a + ph) + drift * t;
    const ex = Math.cos(a) * rx * kk,
      ey = Math.sin(a) * ry * kk;
    pts.push([
      cx + ex * Math.cos(tilt) - ey * Math.sin(tilt),
      cy + ex * Math.sin(tilt) + ey * Math.cos(tilt),
    ]);
  }
  return [{ pts, o: { end: 'flick', start: 'pool', wobble: 0.7, speed: 1 } }];
}

export interface FocusRingOpts {
  shape?: 'rect' | 'ellipse';
  gap?: number;
  r?: number;
  ticks?: boolean;
}

function focusRingLines(
  rng: Rng,
  x: number,
  y: number,
  w: number,
  h: number,
  o: FocusRingOpts = {},
): Line[] {
  const gap = o.gap ?? 4;
  const out: Line[] = [];
  const rect = (o.shape ?? 'rect') === 'rect';
  const X = x - gap,
    Y = y - gap,
    W = w + gap * 2,
    H = h + gap * 2;
  if (rect) {
    const R = (o.r ?? 4) + gap;
    out.push(...boxLines(rng.fork('ring'), X, Y, W, H, { corner: R }));
  } else {
    out.push(...loopLines(rng.fork('ring'), x + w / 2, y + h / 2, W / 2, H / 2, { clean: true }));
  }
  if (o.ticks === true) {
    const tr = rng.fork('ticks');
    if (rect) {
      const cs: Array<[number, number, number, number]> = [
        [X, Y, -1, -1],
        [X + W, Y, 1, -1],
        [X + W, Y + H, 1, 1],
        [X, Y + H, -1, 1],
      ];
      const inset = ((o.r ?? 4) + gap) * (1 - Math.SQRT1_2);
      for (const [cx, cy, sx, sy] of cs) {
        if (tr() < 0.15) continue;
        const a = Math.atan2(sy, sx) + tr.gauss(0, 0.15);
        const r0 = 2 + inset,
          r1 = r0 + 3 + tr() * 2.5;
        out.push({
          pts: seg(
            cx + Math.cos(a) * r0,
            cy + Math.sin(a) * r0,
            cx + Math.cos(a) * r1,
            cy + Math.sin(a) * r1,
            0.3,
            3,
          ),
          o: { end: 'flick', start: 'soft', wobble: 0.3, width: 0.8 },
        });
      }
    } else {
      const cx = x + w / 2,
        cy = y + h / 2;
      for (const base of [-0.75 * Math.PI, 0.25 * Math.PI]) {
        const a = base + tr.gauss(0, 0.2);
        const ex = Math.cos(a),
          ey = Math.sin(a);
        const r0 = Math.hypot(ex * (W / 2), ey * (H / 2)) + 2,
          r1 = r0 + 3 + tr() * 2.5;
        out.push({
          pts: seg(cx + ex * r0, cy + ey * r0, cx + ex * r1, cy + ey * r1, 0.3, 3),
          o: { end: 'flick', start: 'soft', wobble: 0.3, width: 0.8 },
        });
      }
    }
  }
  return out;
}
export function focusRing(
  ink: Ink,
  x: number,
  y: number,
  w: number,
  h: number,
  o: ShapeOpts & FocusRingOpts = {},
): void {
  put(ink, 'focus', r => focusRingLines(r, x, y, w, h, o), 'focus', o);
}
