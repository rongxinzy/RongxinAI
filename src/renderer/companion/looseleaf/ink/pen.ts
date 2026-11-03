import type {
  Pt,
  PenName,
  PenSpec,
  RibbonLayer,
  StrokeOpts,
  StrokeResult,
} from '@/companion/looseleaf/ink/types';
import type { PaintKey } from '@/companion/looseleaf/ink/paint';
import { clamp, smooth, type Rng } from '@/companion/looseleaf/ink/rng';
import { noise1 } from '@/companion/looseleaf/ink/noise';
import {
  PathWriter,
  TAU,
  TIERS,
  densify,
  fillet,
  resample,
  smoothClosed,
  spline,
  type TierCfg,
} from '@/companion/looseleaf/ink/geom';
import { pen as resolvePen } from '@/companion/looseleaf/ink/pens';
import { Sink, blobPts, dot } from './pen-dot';
export { dot } from './pen-dot';

const wrap = (a: number): number => (a > Math.PI ? a - TAU : a < -Math.PI ? a + TAU : a);

interface Geo {
  X: Float64Array;
  Y: Float64Array;
  S: Float64Array;
  TX: Float64Array;
  TY: Float64Array;
  NX: Float64Array;
  NY: Float64Array;
  th: Float64Array;
  turn: Float64Array;
  V: Float64Array;
  L: number;
  N: number;
  seg: number;
  nW9: (s: number) => number;
  nP40: (s: number) => number;
  nDry: (s: number) => number;
  nFlow: (s: number) => number;
  nDens: (s: number) => number;
  nTooth: (s: number) => number;
  nGap: (s: number) => number;
  endMode: 'pool' | 'flick' | 'soft';
  startMode: 'pool' | 'soft';
  capN: number;
}

function ribbon(
  g: Geo,
  lo: Float64Array,
  ro: Float64Array,
  a: number,
  b: number,
  capS = true,
  capE = true,
): Pt[] {
  const { X, Y, NX, NY, TX, TY, capN } = g;
  const pts: Pt[] = [];
  for (let i = a; i <= b; i++) pts.push([X[i] + NX[i] * lo[i], Y[i] + NY[i] * lo[i]]);
  if (capE) {
    const r = (lo[b] + ro[b]) / 2;
    for (let k = 1; k <= capN; k++) {
      const ph = (k / (capN + 1)) * Math.PI;
      const c = Math.cos(ph),
        s = Math.sin(ph);
      const w = c >= 0 ? lo[b] : ro[b];
      pts.push([X[b] + NX[b] * w * c + TX[b] * r * s, Y[b] + NY[b] * w * c + TY[b] * r * s]);
    }
  }
  for (let i = b; i >= a; i--) pts.push([X[i] - NX[i] * ro[i], Y[i] - NY[i] * ro[i]]);
  if (capS) {
    const r = (lo[a] + ro[a]) / 2;
    for (let k = 1; k <= capN; k++) {
      const ph = (k / (capN + 1)) * Math.PI;
      const c = Math.cos(ph),
        s = Math.sin(ph);
      const w = c >= 0 ? ro[a] : lo[a];
      pts.push([X[a] - NX[a] * w * c - TX[a] * r * s, Y[a] - NY[a] * w * c - TY[a] * r * s]);
    }
  }
  return pts;
}

function clampInner(g: Geo, lo: Float64Array, ro: Float64Array): void {
  const { N, seg, turn } = g;
  for (let i = 0; i < N; i++) {
    const k = Math.abs(turn[i]) / (4 * seg);
    if (k < 1e-3) continue;
    const lim = 0.85 / k;
    if (turn[i] > 0) ro[i] = Math.min(ro[i], lim);
    else lo[i] = Math.min(lo[i], lim);
  }
}

function prepare(pts: Pt[], P: PenSpec, rng: Rng, o: StrokeOpts, cfg: TierCfg): Geo {
  let raw = 0;
  for (let i = 1; i < pts.length; i++)
    raw += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  const step0 = Math.max(P.step * cfg.stepK * (o.simple ? 1.8 : 1), raw / 6000);
  const dense = o.poly ? densify(o.round ? fillet(pts, o.round) : pts, step0) : spline(pts, step0);
  let L0 = 0;
  for (let i = 1; i < dense.length; i++)
    L0 += Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]);
  const step = L0 < 30 ? Math.max(0.7, Math.min(step0, L0 / 22)) : step0;
  const { X, Y, S, L } = resample(dense, step);
  const N = X.length;
  const rn = rng.fork('noise');
  const nLow = noise1(rn, L, P.wob.wl),
    nMid = noise1(rn, L, P.wob.wl * 0.3),
    nTr = noise1(rn, L, 4.5);
  const nW9 = noise1(rn, L, 9),
    nP40 = noise1(rn, L, 40),
    nDry = noise1(rn, L, 26),
    nFlow = noise1(rn, L, 18);
  const r2 = rng.fork('noise2');
  const nDens = noise1(r2, L, 55),
    nTooth = noise1(r2, L, P.dryWl),
    nGap = noise1(r2, L, 9);
  const wob = o.raw ? 0 : (o.wobble ?? 1);
  if (wob > 0 && N > 2) {
    const amp = P.wob.amp * wob * clamp(L / 120, 0.2, 1.4);
    const tr = P.wob.tr * wob;
    const dx = new Float64Array(N),
      dy = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const a = Math.max(0, i - 1),
        b = Math.min(N - 1, i + 1);
      const tx = X[b] - X[a],
        ty = Y[b] - Y[a];
      const l = Math.hypot(tx, ty) || 1;
      const off = amp * (nLow(S[i]) + 0.3 * nMid(S[i])) + tr * nTr(S[i]);
      dx[i] = (ty / l) * off;
      dy[i] = (-tx / l) * off;
    }
    for (let i = 0; i < N; i++) {
      X[i] += dx[i];
      Y[i] += dy[i];
    }
  }
  const TX = new Float64Array(N),
    TY = new Float64Array(N),
    NX = new Float64Array(N),
    NY = new Float64Array(N);
  const th = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const a = Math.max(0, i - 1),
      b = Math.min(N - 1, i + 1);
    const tx = X[b] - X[a],
      ty = Y[b] - Y[a];
    const l = Math.hypot(tx, ty) || 1;
    TX[i] = tx / l;
    TY[i] = ty / l;
    NX[i] = TY[i];
    NY[i] = -TX[i];
    th[i] = Math.atan2(ty, tx);
  }
  const turn = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const a = Math.max(0, i - 2),
      b = Math.min(N - 1, i + 2);
    turn[i] = wrap(th[b] - th[a]) * (4 / Math.max(1, b - a));
  }
  const seg = L / (N - 1) || 1;
  const endMode = o.end ?? (rng.fork('end')() < 0.5 ? 'pool' : 'flick');
  const V = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const vA = Math.min(1, Math.sqrt((S[i] + 0.6) / 9));
    const vD = endMode === 'flick' ? 1 : Math.min(1, Math.sqrt((L - S[i] + 0.6) / 11));
    const vC = 1 / (1 + (Math.abs(turn[i]) / (4 * seg)) * 5);
    V[i] = Math.min(vA, vD, vC);
  }
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 1; i < N; i++) V[i] = Math.min(V[i], V[i - 1] * 0.55 + V[i] * 0.45 + 0.08);
    for (let i = N - 2; i >= 0; i--) V[i] = Math.min(V[i], V[i + 1] * 0.55 + V[i] * 0.45 + 0.08);
  }
  const sp = o.speed ?? 1;
  for (let i = 0; i < N; i++) V[i] = clamp(V[i] * sp, 0, 1);
  const startMode = o.start ?? (rng.fork('start')() < 0.8 ? 'pool' : 'soft');
  return {
    X,
    Y,
    S,
    TX,
    TY,
    NX,
    NY,
    th,
    turn,
    V,
    L,
    N,
    seg,
    nW9,
    nP40,
    nDry,
    nFlow,
    nDens,
    nTooth,
    nGap,
    endMode,
    startMode,
    capN: o.simple ? 1 : 3,
  };
}

function runs(cut: Uint8Array | null, N: number): Array<[number, number]> {
  if (!cut) return [[0, N - 1]];
  const out: Array<[number, number]> = [];
  let a = -1;
  for (let i = 0; i <= N; i++) {
    const c = i === N || cut[i] === 1;
    if (!c && a < 0) a = i;
    if (c && a >= 0) {
      if (i - 1 - a >= 1) out.push([a, i - 1]);
      a = -1;
    }
  }
  return out;
}

function lineStroke(
  pts: Pt[],
  P: PenSpec,
  rng: Rng,
  o: StrokeOpts,
  cfg: TierCfg,
  lo: boolean,
): StrokeResult {
  const g = prepare(pts, P, rng, o, cfg);
  const { X, Y, S, L, N, V, turn } = g;
  const sink = new Sink(o.simple ? { ...cfg, tol: cfg.tol * 2.2 } : cfg);
  const felt = P.kind === 'felt';
  const W = P.W * (o.width ?? 1);
  const alpha = (o.alpha ?? 1) * P.alpha;
  const layers: RibbonLayer[] = [];
  const rl = rng.fork('layers');
  const hw = new Float64Array(N);
  const taper = Math.min(L * 0.35, (2.5 + 3.5 * W) * P.taper);
  const dryK = o.dry ?? 1;
  const cut = P.gaps > 0 && !o.simple ? new Uint8Array(N) : null;
  for (let i = 0; i < N; i++) {
    const toEnd = L - S[i];
    const press = o.press ? o.press(S[i] / L) : 1;
    let h: number;
    if (felt) {
      h =
        0.5 *
        W *
        (0.8 + P.swell * (1 - V[i])) *
        press *
        (1 + 0.1 * g.nW9(S[i])) *
        (1 + 0.07 * g.nP40(S[i]));
      h *= 1 + P.dir * Math.sin(g.th[i]);
      h *= 1 + 0.08 * P.dens * g.nDens(S[i]);
      h *= 1 + 0.16 * Math.exp(-S[i] / 2.5);
      if (g.endMode === 'flick' && toEnd < taper)
        h *= 0.3 + 0.7 * Math.pow(Math.max(0, toEnd) / taper, 0.75);
      if (P.skip > 0 && V[i] > 0.9) {
        const dry = g.nDry(S[i]);
        const t = 1 - 0.55 * P.skip * dryK;
        if (dry > t) h *= Math.max(0.42, 1 - (dry - t) * 5);
      }
    } else {
      const pr = 0.86 + 0.18 * g.nP40(S[i]) + 0.1 * (1 - V[i]);
      const t0 = Math.min(0.3 * L, 5),
        t1 = Math.min(0.4 * L, g.endMode === 'flick' ? 9 : 5);
      let e = 1;
      if (S[i] < t0) e *= 0.5 + 0.5 * (S[i] / t0);
      if (toEnd < t1) e *= 0.4 + 0.6 * (Math.max(0, toEnd) / t1);
      h = Math.max(0.15, 0.5 * W * e * pr * press * (1 + 0.1 * g.nW9(S[i])));
      h *= 1 + P.dir * Math.sin(g.th[i]);
    }
    if (P.dryAmt > 0 && V[i] > 0.55) {
      const d = g.nTooth(S[i]);
      if (d > 0.5) h *= 1 - 0.62 * P.dryAmt * dryK * smooth((d - 0.5) / 0.22);
    }
    if (cut && S[i] > 4 && toEnd > 4 && V[i] > 0.8 && g.nGap(S[i]) > 1.05 - 0.6 * P.gaps * dryK)
      cut[i] = 1;
    hw[i] = Math.max(0.12, h);
  }
  if (cut) {
    for (let i = 0; i < N; i++) {
      if (cut[i] !== 1) continue;
      let j = i;
      while (j < N && cut[j] === 1) j++;
      if (j - i < 3) for (let k = i; k < j; k++) cut[k] = 0;
      i = j;
    }
  }
  const mkLane = (
    fnL: (i: number) => number,
    fnR: (i: number) => number = fnL,
    pieces: Array<[number, number]> = [[0, N - 1]],
  ): string => {
    const l = new Float64Array(N),
      r = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      l[i] = fnL(i);
      r[i] = fnR(i);
    }
    clampInner(g, l, r);
    let d = '';
    for (const [a, b] of pieces) d += sink.poly(ribbon(g, l, r, a, b, true, true));
    return d;
  };
  const color: PaintKey = o.color ?? P.color;
  const pieces = runs(cut, N);
  const solid = o.alpha ?? 1;
  if (felt) {
    const bleed = P.bleed;
    if (P.halo > 0 && !o.simple) {
      const nH1 = noise1(rl, L, 7),
        nH2 = noise1(rl, L, 7);
      let ja = 0.5,
        jb = 0.5;
      const A = new Float64Array(N),
        B = new Float64Array(N);
      for (let i = 0; i < N; i++) {
        ja = 0.5 * ja + 0.5 * rl();
        jb = 0.5 * jb + 0.5 * rl();
        const soak = 0.4 * (1 - V[i]);
        A[i] = hw[i] + bleed * (0.4 + 0.85 * Math.max(0, nH1(S[i])) + 0.4 * ja + soak);
        B[i] = hw[i] + bleed * (0.4 + 0.85 * Math.max(0, nH2(S[i])) + 0.4 * jb + soak);
      }
      layers.push({
        k: 'halo',
        d: mkLane(
          i => A[i],
          i => B[i],
        ),
        fill: color,
        op: P.halo * (lo ? 0.85 : 0.55),
      });
      if (!lo) {
        let jc = 0.5;
        const C = new Float64Array(N);
        for (let i = 0; i < N; i++) {
          jc = 0.4 * jc + 0.6 * rl();
          C[i] = hw[i] + bleed * (0.25 + 0.55 * jc);
        }
        layers.push({ k: 'halo', d: mkLane(i => C[i]), fill: color, op: P.halo });
        const cnt = Math.floor((L / 3.2) * P.feather * (0.6 + 0.8 * rl()));
        const hp = new PathWriter(cfg.q);
        for (let c = 0; c < cnt; c++) {
          const i = 1 + Math.floor(rl() * (N - 2));
          const side = rl() < 0.5 ? 1 : -1;
          const ang = (rl() - 0.5) * 2.2;
          const nx = g.NX[i] * side,
            ny = g.NY[i] * side;
          const dx = nx * Math.cos(ang) - ny * Math.sin(ang),
            dy = nx * Math.sin(ang) + ny * Math.cos(ang);
          const len = hw[i] + bleed * (0.5 + rl() * rl() * 1.8);
          const bx = X[i] + nx * hw[i] * 0.5,
            by = Y[i] + ny * hw[i] * 0.5;
          const bw = 0.22 + 0.3 * rl();
          const tx = g.TX[i] * bw,
            ty = g.TY[i] * bw;
          const tip: Pt = [X[i] + dx * len, Y[i] + dy * len];
          sink.grow(tip[0], tip[1]);
          hp.M(bx + tx, by + ty)
            .L(tip[0], tip[1])
            .L(bx - tx, by - ty)
            .Z();
        }
        if (hp.d) layers.push({ k: 'hair', d: hp.d, fill: color, op: Math.min(1, P.halo * 1.6) });
      }
    }
    const jit = new Float64Array(N);
    for (let i = 0; i < N; i++) jit[i] = lo ? 1 : 1 + 0.07 * (rl() - 0.5);
    layers.push({
      k: 'body',
      d: mkLane(
        i => hw[i] * jit[i],
        i => hw[i] * jit[N - 1 - i],
        pieces,
      ),
      fill: color,
      op: alpha,
    });
    if (!o.simple) {
      const core = new Float64Array(N);
      let any = false;
      for (let i = 0; i < N; i++) {
        const dn = 1 + 0.6 * P.dens * g.nDens(S[i] + 17);
        core[i] =
          cut && cut[i]
            ? 0
            : 0.72 *
              hw[i] *
              Math.max(Math.pow(1 - V[i], 1.2), 0.8 * (0.5 + 0.5 * g.nFlow(S[i])) - 0.1) *
              dn;
        if (core[i] > 0.18) any = true;
        else core[i] = 0;
      }
      let cd = any ? mkLane(i => core[i]) : '';
      let pd = '';
      let hd2 = '';
      const pool = (i: number, k: number, jag: number): void => {
        const r = hw[i] * k * P.pool;
        pd += sink.poly(blobPts(X[i], Y[i], r, jag, rl, 11));
        if (P.halo > 0 && !lo) hd2 += sink.poly(blobPts(X[i], Y[i], r + bleed * 1.5, 0.2, rl, 12));
      };
      if (g.startMode === 'pool') pool(0, 1.05 + 0.25 * rl(), 0.14);
      if (g.endMode === 'pool') pool(N - 1, 0.95 + 0.3 * rl(), 0.14);
      let lastPool = -9;
      for (let i = 2; i < N - 2; i++) {
        if (Math.abs(turn[i]) > 1.35 && i - lastPool > 4) {
          pool(i, 0.6 + 0.25 * Math.min(1, Math.abs(turn[i]) - 1.35), 0.14);
          lastPool = i;
        }
      }
      if (lo) {
        cd += pd;
        pd = '';
      }
      if (cd) layers.push({ k: 'core', d: cd, fill: color, op: P.core * solid });
      if (hd2) layers.push({ k: 'halo', d: hd2, fill: color, op: P.halo * 0.9 });
      if (pd) layers.push({ k: 'pool', d: pd, fill: color, op: Math.min(1, P.core * 1.1) * solid });
    }
  } else {
    if (!o.simple)
      layers.push({ k: 'smear', d: mkLane(i => hw[i] * 1.2), fill: color, op: P.smear * solid });
    layers.push({
      k: 'body',
      d: mkLane(
        i => hw[i] * (1 + 0.12 * (lo ? 0 : rl() - 0.5)),
        i => hw[i] * (1 + 0.12 * (lo ? 0 : rl() - 0.5)),
        pieces,
      ),
      fill: color,
      op: alpha,
    });
    if (!o.simple) {
      const nc = noise1(rl, L, 40);
      layers.push({
        k: 'core',
        d: mkLane(i =>
          hw[i] > 0.3
            ? hw[i] * 0.55 * (0.7 + 0.3 * nc(S[i] + 13)) * (1 + 0.4 * P.dens * g.nDens(S[i] + 5))
            : 0,
        ),
        fill: color,
        op: alpha * 0.55,
      });
    }
  }
  return {
    kind: P.kind,
    layers,
    bbox: sink.bb,
    len: L,
    end: [X[N - 1], Y[N - 1]],
    start: [X[0], Y[0]],
  };
}

function markerStroke(
  pts: Pt[],
  P: PenSpec,
  rng: Rng,
  o: StrokeOpts,
  cfg: TierCfg,
  lo: boolean,
): StrokeResult {
  const g = prepare(pts, P, rng, { ...o, start: o.start ?? 'pool' }, cfg);
  const { X, Y, S, L, N } = g;
  const sink = new Sink(cfg);
  const W = P.W * (o.width ?? 1);
  const alpha = (o.alpha ?? 1) * P.alpha;
  const rl = rng.fork('layers');
  const hl = P.kind === 'hl';
  const color: PaintKey = o.color ?? P.color;
  const hwA = new Float64Array(N);
  const nM = noise1(rl, L, 14),
    nE = noise1(rl, L, 3.5),
    nE2 = noise1(rl, L, 3.5);
  const taper = Math.min(0.25 * L, 0.5 * W);
  const cutLen = Math.min(W * P.cutK, L * 0.4);
  const slantA = rl() < 0.5 ? 1 : -1;
  const lo_ = new Float64Array(N),
    ro_ = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const ang = Math.atan2(g.TY[i], g.TX[i]);
    const chisel = hl
      ? 0.8 + 0.2 * Math.abs(Math.sin(ang - P.nib))
      : 0.5 + 0.5 * Math.abs(Math.sin(ang - P.nib));
    let hw = 0.5 * W * chisel * (o.press ? o.press(S[i] / L) : 1) * (1 + 0.06 * nM(S[i]));
    if (g.endMode === 'flick' && L - S[i] < taper) hw *= 0.6 + 0.4 * ((L - S[i]) / taper);
    hwA[i] = hw;
    let a = hw * (1 + 0.35 * P.edge * nE(S[i]) * 0.5);
    let b = hw * (1 + 0.35 * P.edge * nE2(S[i]) * 0.5);
    if (S[i] < cutLen) {
      const c = 1 - 0.6 * (1 - S[i] / cutLen);
      if (slantA > 0) a *= c;
      else b *= c;
    }
    if (L - S[i] < cutLen) {
      const c = 1 - 0.6 * (1 - (L - S[i]) / cutLen);
      if (slantA > 0) b *= c;
      else a *= c;
    }
    lo_[i] = a;
    ro_[i] = b;
  }
  const layers: RibbonLayer[] = [];
  const lane = (l2: (i: number) => number, r2: (i: number) => number): string => {
    const a = new Float64Array(N),
      b = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      a[i] = l2(i);
      b[i] = r2(i);
    }
    clampInner(g, a, b);
    return sink.poly(ribbon(g, a, b, 0, N - 1, false, false));
  };
  layers.push({
    k: 'halo',
    d: lane(
      i => lo_[i] + P.bleed * (0.5 + 0.5 * nE(S[i] + 9)),
      i => ro_[i] + P.bleed * (0.5 + 0.5 * nE2(S[i] + 9)),
    ),
    fill: color,
    op: alpha * P.wet,
  });
  let body = lane(
    i => lo_[i],
    i => ro_[i],
  );
  const rw1 = hl ? 0.55 : 0.8;
  const rim =
    lane(
      i => lo_[i],
      i => -lo_[i] + rw1 * (0.6 + 0.8 * rl()),
    ) +
    lane(
      i => -ro_[i] + rw1 * (0.6 + 0.8 * rl()),
      i => ro_[i],
    );
  let rule: 'evenodd' | undefined;
  const extra: RibbonLayer[] = [];
  if (!hl && !lo && L > 6) {
    const nS = noise1(rl, L, 30);
    for (let s = 0; s < 2; s++) {
      const base = (rl() - 0.5) * 0.9;
      const off = (i: number): number => hwA[i] * (base + 0.25 * nS(S[i] + s * 40));
      extra.push({
        k: 'streak',
        d: lane(
          i => Math.max(0.1, 0.3 + off(i)),
          i => Math.max(0.1, 0.3 - off(i)),
        ),
        fill: color,
        op: P.edge * 0.5,
      });
    }
    const nGap = noise1(rl, L, 11);
    let sd = '';
    let inSlit = false,
      sIdx = 0;
    for (let i = 0; i < N; i++) {
      const dry = Math.max(0, nGap(S[i] + 31) - (g.V[i] > 0.8 ? 0.3 : 0.5));
      if (dry > 0.3 && !inSlit) {
        inSlit = true;
        sIdx = i;
      }
      if ((dry <= 0.3 || i === N - 1) && inSlit) {
        inSlit = false;
        if (i - sIdx > 4) {
          const off = hwA[sIdx] * (rl() - 0.5) * 0.7;
          const top: Pt[] = [],
            bot: Pt[] = [];
          for (let j = sIdx; j < i; j++) {
            const tt = (j - sIdx) / (i - sIdx);
            const wdt = 0.28 * Math.sin(Math.PI * tt);
            top.push([X[j] + g.NX[j] * (off + wdt), Y[j] + g.NY[j] * (off + wdt)]);
            bot.unshift([X[j] + g.NX[j] * (off - wdt), Y[j] + g.NY[j] * (off - wdt)]);
          }
          sd += smoothClosed([...top, ...bot], cfg);
        }
      }
    }
    if (sd) {
      body += sd;
      rule = 'evenodd';
    }
  }
  layers.push({ k: 'body', d: body, fill: color, op: alpha, rule });
  layers.push({ k: 'rim', d: rim, fill: color, op: P.edge });
  layers.push(...extra);
  return {
    kind: P.kind,
    layers,
    bbox: sink.bb,
    len: L,
    end: [X[N - 1], Y[N - 1]],
    start: [X[0], Y[0]],
  };
}

export function stroke(
  pointsIn: Pt[],
  penIn: PenName | PenSpec,
  rng: Rng,
  o: StrokeOpts = {},
): StrokeResult {
  const P = resolvePen(penIn);
  const tier = o.tier ?? 'lo';
  const cfg = TIERS[tier];
  const pts = pointsIn
    .filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]))
    .map((p): Pt => [clamp(p[0], -1e5, 1e5), clamp(p[1], -1e5, 1e5)]);
  if (pts.length === 0)
    return { kind: P.kind, layers: [], bbox: [0, 0, 0, 0], len: 0, start: [0, 0], end: [0, 0] };
  if (pts.length < 2) return dot(pts[0][0], pts[0][1], P.W * 0.6, P, rng, o);
  return P.kind === 'marker' || P.kind === 'hl'
    ? markerStroke(pts, P, rng, o, cfg, tier === 'lo')
    : lineStroke(pts, P, rng, o, cfg, tier === 'lo');
}
