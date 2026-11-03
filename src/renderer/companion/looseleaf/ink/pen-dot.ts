import type { BBox, Pt, PenName, PenSpec, RibbonLayer, StrokeOpts, StrokeResult } from './types';
import type { PaintKey } from './paint';
import { type Rng } from './rng';
import { TAU, TIERS, smoothClosed, type TierCfg } from './geom';
import { pen as resolvePen } from './pens';
export class Sink {
  bb: BBox = [Infinity, Infinity, -Infinity, -Infinity];
  readonly cfg: TierCfg;
  constructor(cfg: TierCfg) {
    this.cfg = cfg;
  }
  grow(x: number, y: number): void {
    const b = this.bb;
    if (x < b[0]) b[0] = x;
    if (x > b[2]) b[2] = x;
    if (y < b[1]) b[1] = y;
    if (y > b[3]) b[3] = y;
  }
  poly(pts: Pt[]): string {
    for (const p of pts) this.grow(p[0], p[1]);
    return smoothClosed(pts, this.cfg);
  }
}

export function blobPts(
  cx: number,
  cy: number,
  r: number,
  jag: number,
  rnd: () => number,
  nv = 10,
  sx = 1,
  sy = 1,
  rot = 0,
): Pt[] {
  const pts: Pt[] = [];
  const a0 = rnd() * TAU;
  for (let i = 0; i < nv; i++) {
    const a = a0 + (i / nv) * TAU;
    const rr = r * (1 + jag * (rnd() * 2 - 1));
    const x = Math.cos(a) * rr * sx,
      y = Math.sin(a) * rr * sy;
    pts.push([
      cx + x * Math.cos(rot) - y * Math.sin(rot),
      cy + x * Math.sin(rot) + y * Math.cos(rot),
    ]);
  }
  return pts;
}

export function dot(
  cx: number,
  cy: number,
  r: number,
  penIn: PenName | PenSpec,
  rng: Rng,
  o: StrokeOpts = {},
): StrokeResult {
  const P = resolvePen(penIn);
  const tier = o.tier ?? 'lo';
  const cfg = TIERS[tier];
  const sink = new Sink(cfg);
  const rl = rng.fork('dot');
  const color: PaintKey = o.color ?? P.color;
  const layers: RibbonLayer[] = [];
  const rr = r * (o.width ?? 1);
  if (P.kind === 'felt') {
    if (P.halo > 0 && tier === 'hi')
      layers.push({
        k: 'halo',
        d: sink.poly(blobPts(cx, cy, rr + P.bleed * 1.4, 0.2, rl, 12)),
        fill: color,
        op: P.halo * 0.9,
      });
    layers.push({
      k: 'body',
      d: sink.poly(blobPts(cx, cy, rr, 0.09, rl, 11)),
      fill: color,
      op: P.alpha * (o.alpha ?? 1),
    });
    layers.push({
      k: 'pool',
      d: sink.poly(blobPts(cx + rr * 0.05, cy, rr * 0.7, 0.1, rl, 9)),
      fill: color,
      op: P.core,
    });
  } else {
    if (tier === 'hi')
      layers.push({
        k: 'smear',
        d: sink.poly(blobPts(cx, cy, rr * 1.15, 0.1, rl, 10)),
        fill: color,
        op: P.smear || 0.2,
      });
    layers.push({
      k: 'body',
      d: sink.poly(blobPts(cx, cy, rr, 0.12, rl, 10)),
      fill: color,
      op: P.alpha * (o.alpha ?? 1),
    });
  }
  return {
    kind: P.kind === 'hl' || P.kind === 'marker' ? 'felt' : P.kind,
    layers,
    bbox: sink.bb,
    len: 0,
    end: [cx, cy],
    start: [cx, cy],
  };
}
