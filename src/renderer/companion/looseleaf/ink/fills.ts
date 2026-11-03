import type { Material, Pt } from '@/companion/looseleaf/ink/types';
import type { Ink } from '@/companion/looseleaf/ink/builder';
import type { PaintKey } from '@/companion/looseleaf/ink/paint';
import { clamp, type Rng } from '@/companion/looseleaf/ink/rng';
import { noise1 } from '@/companion/looseleaf/ink/noise';
import {
  area,
  bboxOf,
  centroid,
  densifyClosed,
  offsetPoly,
  wobblePoly,
} from '@/companion/looseleaf/ink/geom';

export interface Offset {
  dx: number;
  dy: number;
}

const shiftOf = (from: Pt[], to: Pt[]): Offset => {
  const a = centroid(from),
    b = centroid(to);
  return { dx: b[0] - a[0], dy: b[1] - a[1] };
};

function laid(_ink: Ink, poly: Pt[], _mis: number | false | undefined, _salt = 'mr'): Pt[] {
  return poly;
}

function rough(poly: Pt[], rng: Rng, amt = 0.8, step = 4): Pt[] {
  const pts = densifyClosed(poly, step);
  let per = 0;
  for (let i = 0; i < pts.length; i++)
    per += Math.hypot(
      pts[(i + 1) % pts.length][0] - pts[i][0],
      pts[(i + 1) % pts.length][1] - pts[i][1],
    );
  const nz = noise1(rng, per + 60, 22),
    nz2 = noise1(rng, per + 60, 6);
  const sgn = area(pts) >= 0 ? 1 : -1;
  let s = 0;
  return pts.map((p, i) => {
    const q = pts[(i + 1) % pts.length],
      r = pts[(i - 1 + pts.length) % pts.length];
    const tx = q[0] - r[0],
      ty = q[1] - r[1];
    const l = Math.hypot(tx, ty) || 1;
    if (i) s += Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]);
    const off = amt * (nz(s) * 0.8 + nz2(s) * 0.5);
    return [p[0] + (ty / l) * sgn * off, p[1] - (tx / l) * sgn * off];
  });
}

function solidFill(
  ink: Ink,
  poly: Pt[],
  color: PaintKey,
  o: { alpha?: number; inset?: number; rough?: number; material?: Material } = {},
): Offset {
  const rng = ink.next('solid');
  const inner = o.inset ? offsetPoly(poly, -o.inset, 0, 0) : poly;
  ink.poly(o.material ?? 'marker', rough(inner, rng, o.rough ?? 0.1, 4), color, o.alpha ?? 0.94);
  return { dx: 0, dy: 0 };
}

const solidAlpha = (alpha: number | undefined, fallback: number, passes = 1): number =>
  clamp((alpha ?? fallback) * (passes > 1 ? 1.14 : 1.08), 0.3, 0.96);

export interface BandOpts {
  alpha?: number;
  mis?: number | false;
  passes?: 1 | 2;
  angle?: number;
  W?: number;
  overlap?: number;
  ends?: 'loose' | 'flag' | 'square';
  material?: Material;
}

export function bandFill(ink: Ink, poly: Pt[], color: PaintKey, o: BandOpts = {}): Offset {
  return solidFill(ink, poly, color, {
    alpha: solidAlpha(o.alpha, 0.85, o.passes ?? 1),
    material: o.material,
  });
}

export interface BlobOpts {
  alpha?: number;
  mis?: number | false;
  rough?: number;
  material?: Material;
}

export function blobFill(ink: Ink, poly: Pt[], color: PaintKey, o: BlobOpts = {}): Offset {
  const rng = ink.next('blob');
  const at = laid(ink, poly, o.mis);
  ink.poly(
    o.material ?? 'marker',
    rough(at, rng, Math.min(o.rough ?? 0.1, 0.12), 4),
    color,
    Math.max(o.alpha ?? 0.9, 0.92),
  );
  return shiftOf(poly, at);
}

export function wash(
  ink: Ink,
  poly: Pt[],
  color: PaintKey,
  o: { alpha?: number; inset?: number; shift?: number; wobble?: number; material?: Material } = {},
): Offset {
  const rng = ink.next('wash');
  const b = bboxOf(poly);
  const size = Math.max(b[2] - b[0], b[3] - b[1]);
  const dn = o.shift ?? 0.007 * size + 0.3;
  const P = wobblePoly(
    densifyClosed(
      offsetPoly(poly, -(o.inset ?? 0.9), dn * 0.85 * ink.knobs.misreg, dn * ink.knobs.misreg),
      4,
    ),
    rng,
    (o.wobble ?? 0.7) * ink.knobs.wobble,
    18,
  );
  ink.poly(o.material ?? 'marker', P, color, o.alpha ?? 0.5);
  return { dx: dn * 0.85 * ink.knobs.misreg, dy: dn * ink.knobs.misreg };
}
