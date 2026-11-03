import { bandFill, blobFill, wash } from '@/companion/looseleaf/ink/fills';
import { roundRectPoly, seg } from '@/companion/looseleaf/ink/geom';
import { chain, focusRing, RULER } from '@/companion/looseleaf/ink/shapes';
import { clamp } from '@/companion/looseleaf/ink/rng';
import { defineRecipe } from '@/companion/looseleaf/ink/recipes';
import type { Ink } from '@/companion/looseleaf/ink/builder';
import type { Line, PenName, Pt, StrokeOpts } from '@/companion/looseleaf/ink/types';

const bubbleVariantList = [
  'default',
  'secondary',
  'muted',
  'tinted',
  'outline',
  'ghost',
  'destructive',
] as const;
type BubbleVariant = (typeof bubbleVariantList)[number];

export interface BubbleParams {
  variant: BubbleVariant;
  tail: 'start' | 'end';
  pen?: 'ink' | 'you';
  interactive?: boolean;
}

const bubbleRadius = (w: number, h: number): number => clamp(Math.min(w, h) * 0.42, 7, 16);

const TAIL_CORNER = 3.4;

function cloudLines(
  ink: Ink,
  x: number,
  y: number,
  w: number,
  h: number,
  left: boolean,
  cheap: boolean,
): Line[] {
  const rng = ink.next('cloud');
  const j = () => rng.gauss(0, 0.55);
  const TR: Pt = [x + w + j(), y + j()];
  const BR: Pt = [x + w + j(), y + h + j()];
  const BL: Pt = [x + j(), y + h + j()];
  const TL: Pt = [x + j(), y + j()];
  const t0 = rng.range(0.2, 0.42);
  const S: Pt = [TL[0] + (TR[0] - TL[0]) * t0, TL[1] + (TR[1] - TL[1]) * t0 + j() * 0.4];
  const run = Math.min(w * 0.3, rng.range(8, 20));
  const end: Pt = [S[0] + run, S[1] - rng.range(0.5, 2)];
  const bulge = (len: number) => -clamp(len * rng.range(0.008, 0.024), 0.5, 3.4);
  const c = TAIL_CORNER * 1.15;
  const vs: Pt[] = left
    ? [S, TR, BR, [BL[0] + c, BL[1]], [BL[0], BL[1] - c], TL, end]
    : [S, TR, [BR[0], BR[1] - c], [BR[0] - c, BR[1]], BL, TL, end];
  const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const bows = vs.slice(0, -1).map((v, i) => {
    const n = vs[i + 1];
    const len = dist(v, n);
    return len < c * 2.5 ? 0 : bulge(len);
  });
  const rad = bubbleRadius(w, h);
  const so: StrokeOpts = { speed: 1.02, wobble: 0.85, start: 'pool', end: 'flick', simple: cheap };
  return [{ pts: chain(vs, bows, rad, rng, 12), o: so }];
}

function tailLines(
  ink: Ink,
  x: number,
  y: number,
  w: number,
  h: number,
  left: boolean,
): { lines: Line[]; wedge: Pt[] } {
  const rng = ink.next('tail');
  const dir = left ? -1 : 1;
  const bx = left ? x : x + w;
  const by = y + h;
  const reach = clamp(h * 0.2, 7, 10.5) + rng.range(-0.5, 1.2);
  const rise = clamp(h * 0.34, 11, 18);
  const a: Pt = [bx - dir * 0.6, by - rise];
  const tip: Pt = [bx + dir * reach, by + rng.range(0.6, 2.2)];
  const b: Pt = [bx - dir * clamp(w * 0.07, 7, 12), by + rng.range(-0.3, 0.9)];
  const so: StrokeOpts = { wobble: 0.6, simple: true, speed: 1.05 };
  const out = seg(a[0], a[1], tip[0], tip[1], dir * rng.range(0.8, 2.2), 6);
  const back = seg(tip[0], tip[1], b[0], b[1], rng.range(-0.5, 0.6), 4);
  return {
    lines: [
      { pts: out, o: { ...so, start: 'soft', end: 'soft' } },
      { pts: back, o: { ...so, start: 'soft', end: 'flick' } },
    ],
    wedge: [a, ...out.slice(1, -1), tip, ...back.slice(1, -1), b, [bx - dir * 2, by - 6]],
  };
}

function fillOf(variant: BubbleVariant): {
  color: 'ink-you' | 'hi' | 'paper-shade' | null;
  alpha: number;
} {
  switch (variant) {
    case 'default':
      return { color: 'ink-you', alpha: 0.96 };
    case 'secondary':
      return { color: 'hi', alpha: 0.82 };
    case 'muted':
      return { color: 'paper-shade', alpha: 0.95 };
    default:
      return { color: null, alpha: 0 };
  }
}

export const bubbleRecipe = defineRecipe<BubbleParams>({
  id: 'bubble',
  kind: 'bubble',
  layers: ['rest', 'hover', 'focus'],
  lazy: ['focus'],
  pad: 12,
  draw(ink, { w, h }, { variant, tail, pen = 'ink', interactive = false }, ctx) {
    ink.lean();
    const left = (tail === 'start') === (ctx.dir === 'ltr');
    const r = bubbleRadius(w, h);
    ctx.lazy('focus', f => focusRing(f, 0, 0, w, h, { r }));
    if (ctx.lazyOnly || variant === 'ghost') return;

    const felt: PenName = variant === 'destructive' ? 'redfelt' : pen === 'you' ? 'blue' : 'ink';
    const calm = ctx.calm;
    const inset = clamp(h * 0.05, 1.6, 2.6);
    const body = roundRectPoly(inset, inset, w - 2 * inset, h - 2 * inset, r);
    const f = fillOf(variant);
    const color = f.color;

    ink.layer('rest', () => {
      if (variant === 'outline' || variant === 'tinted' || variant === 'destructive')
        ink.poly('under', body, 'slip', 0.94);
      if (color) {
        ink.part('fill', () => {
          if (color === 'paper-shade')
            return wash(ink, body, color, { alpha: 0.95, material: 'wash' });
          if (calm) return wash(ink, body, color, { alpha: 0.6, material: 'wash' });
          const mis = clamp(h * 0.04, 1.4, 3);
          if (h < 30) return blobFill(ink, body, color, { alpha: f.alpha, mis });
          return bandFill(ink, body, color, {
            alpha: f.alpha,
            passes: variant === 'default' ? 2 : 1,
            mis,
            W: clamp(h * 0.2, 6.5, 9.5),
            ends: 'loose',
            overlap: 0.3,
          });
        });
      } else if (variant === 'tinted') {
        ink.part('fill', () =>
          wash(ink, body, 'marker', { alpha: calm ? 0.24 : 0.3, material: 'wash' }),
        );
      } else if (variant === 'destructive') {
        ink.part('fill', () => blobFill(ink, body, 'red', { alpha: 0.97 }));
      }
      const o: StrokeOpts = variant === 'muted' || calm ? { alpha: 0.85 } : {};
      ink.lines(
        cloudLines(ink, 0, 0, w, h, left, ctx.tier === 'lo'),
        calm ? 'pencil.fine' : variant === 'muted' ? (`${felt}.fine` as PenName) : felt,
        o,
      );
      ink.part(
        'tail',
        () => {
          const t = tailLines(ink, 0, 0, w, h, left);
          const pale = calm ? 'wash' : 'felt';
          if (color === 'paper-shade')
            wash(ink, t.wedge, color, { alpha: 0.95, inset: 0, material: pale });
          else if (color && calm)
            wash(ink, t.wedge, color, { alpha: 0.6, inset: 0, material: 'wash' });
          else if (color) blobFill(ink, t.wedge, color, { alpha: f.alpha, mis: 1 });
          else if (variant === 'tinted')
            wash(ink, t.wedge, 'marker', { alpha: 0.3, inset: 0, material: pale });
          else if (variant === 'outline' || variant === 'destructive')
            ink.poly(calm ? 'under' : 'felt', t.wedge, 'slip', 0.94);
          ink.lines(t.lines, calm ? 'pencil.fine' : felt, o);
        },
        'top',
      );
    });

    if (interactive) {
      ink.layer('hover', () => {
        if (calm) return;
        const d = 3.6;
        ink.lines(
          [
            {
              pts: chain(
                [
                  [r + d + 2, h + d],
                  [w + d, h + d],
                  [w + d, r + d + 2],
                ],
                [0, 0],
                Math.max(2.5, r),
                ink.next('drop'),
              ),
              o: RULER,
            },
          ],
          'ink.fine',
          { width: 1.35 },
        );
      });
    }
  },
});
