import { GRAIN_TILES, type GrainMaskKind } from '@/companion/looseleaf/ink/textures.generated';

const GRAIN_KINDS = [
  'felt',
  'marker',
  'graphite',
  'waxy',
  'stamp',
] as const satisfies readonly GrainMaskKind[];

const GRAIN_VARIANTS = 6;

function grainPhase(variant: number): { x: number; y: number; rot: 0 | 90 | 180 | 270 } {
  const v = ((Math.trunc(variant) % GRAIN_VARIANTS) + GRAIN_VARIANTS) % GRAIN_VARIANTS;
  const rots = [0, 90, 180, 270, 0, 180] as const;
  return { x: (v * 0.618034) % 1, y: (v * 0.381966 + 0.17) % 1, rot: rots[v] };
}

const idPrefix = (p?: string) => p ?? 'll';
const num = (v: number) => String(Math.round(v * 100) / 100);

export interface MaskDefsOptions {
  kinds?: readonly GrainMaskKind[];
  prefix?: string;
  region?: { x: number; y: number; width: number; height: number } | 'bbox';
}

const DEFAULT_REGION = { x: -2048, y: -2048, width: 8192, height: 8192 };

function svgMaskDefs(o: MaskDefsOptions = {}): string {
  const kinds = o.kinds ?? GRAIN_KINDS;
  const p = idPrefix(o.prefix);
  const region = o.region ?? DEFAULT_REGION;
  const maskAttrs =
    region === 'bbox'
      ? 'x="-0.1" y="-0.1" width="1.2" height="1.2"'
      : `maskUnits="userSpaceOnUse" x="${region.x}" y="${region.y}" width="${region.width}" height="${region.height}"`;
  const fill = region === 'bbox' ? { x: -4000, y: -4000, width: 9000, height: 9000 } : region;
  let s = '';
  for (const kind of kinds) {
    const t = GRAIN_TILES[kind];
    s += `<image id="${p}-${kind}-img" width="${t.css}" height="${t.css}" href="${t.uri}"/>`;
    for (let v = 0; v < GRAIN_VARIANTS; v++) {
      const ph = grainPhase(v);
      const tf = ` patternTransform="translate(${num(ph.x * t.css)} ${num(ph.y * t.css)})${ph.rot ? ` rotate(${ph.rot})` : ''}"`;
      s += `<pattern id="${p}-${kind}-pat-${v}" width="${t.css}" height="${t.css}" patternUnits="userSpaceOnUse"${tf}><use href="#${p}-${kind}-img"/></pattern>`;
    }
    const rect = (v: number) =>
      `<rect x="${fill.x}" y="${fill.y}" width="${fill.width}" height="${fill.height}" fill="url(#${p}-${kind}-pat-${v})"/>`;
    s += `<mask id="${p}-${kind}" ${maskAttrs}>${rect(0)}</mask>`;
    for (let v = 0; v < GRAIN_VARIANTS; v++)
      s += `<mask id="${p}-${kind}-${v}" ${maskAttrs}>${rect(v)}</mask>`;
  }
  return s;
}

export function inkDefsSvg(o: MaskDefsOptions = {}): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs>${svgMaskDefs(o)}</defs></svg>`;
}
