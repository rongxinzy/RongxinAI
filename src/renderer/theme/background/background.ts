export const BackgroundKind = {
  None: 'none',
  Color: 'color',
  Image: 'image',
  Texture: 'texture',
} as const;
export const BackgroundTexture = { Paper: 'paper', Silk: 'silk', Grid: 'grid', Dots: 'dots' } as const;
export const BackgroundFit = { Cover: 'cover', Contain: 'contain', Tile: 'tile' } as const;
export type ThemeBackground = {
  kind: (typeof BackgroundKind)[keyof typeof BackgroundKind];
  color: string;
  opacity: number;
  image?: string;
  texture: (typeof BackgroundTexture)[keyof typeof BackgroundTexture];
  fit: (typeof BackgroundFit)[keyof typeof BackgroundFit];
};
export const DEFAULT_BACKGROUND: ThemeBackground = {
  kind: BackgroundKind.None,
  color: '#b8aa91',
  opacity: 0.2,
  texture: BackgroundTexture.Paper,
  fit: BackgroundFit.Cover,
};
const MAX_INLINE_IMAGE_LENGTH = 6 * 1024 * 1024;
const imagePattern = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/;
// Vite-imported or public theme assets only; remote/file URLs are not theme assets.
const bundledImagePattern =
  /^(?:\/(?!\/)|\.{1,2}\/)[a-zA-Z0-9_./% @-]+\.(?:png|jpe?g|webp|avif|svg)(?:\?[a-zA-Z0-9_=&.-]+)?$/i;
export function normalizeBackground(value?: Partial<ThemeBackground> | null): ThemeBackground {
  const image =
    typeof value?.image === 'string' &&
    value.image.length <= MAX_INLINE_IMAGE_LENGTH &&
    (imagePattern.test(value.image) || bundledImagePattern.test(value.image))
      ? value.image
      : undefined;
  return {
    kind: Object.values(BackgroundKind).includes(value?.kind as never)
      ? value!.kind!
      : BackgroundKind.None,
    color: /^#[0-9a-f]{6}$/i.test(value?.color ?? '') ? value!.color! : DEFAULT_BACKGROUND.color,
    opacity:
      typeof value?.opacity === 'number' && Number.isFinite(value.opacity)
        ? Math.min(1, Math.max(0, value.opacity))
        : DEFAULT_BACKGROUND.opacity,
    texture: Object.values(BackgroundTexture).includes(value?.texture as never)
      ? value!.texture!
      : BackgroundTexture.Paper,
    fit: Object.values(BackgroundFit).includes(value?.fit as never)
      ? value!.fit!
      : BackgroundFit.Cover,
    ...(image ? { image } : {}),
  };
}

/** Declarative paints only. Each layer is composited under content, never over text. */
export function backgroundStyle(input: ThemeBackground): Record<string, string> {
  const value = normalizeBackground(input);
  let image = 'none';
  let size = 'cover';
  let repeat = 'no-repeat';
  if (value.kind === BackgroundKind.Image && value.image) {
    image = `url("${value.image}")`;
    size = value.fit === BackgroundFit.Tile ? 'auto' : value.fit;
    repeat = value.fit === BackgroundFit.Tile ? 'repeat' : 'no-repeat';
  }
  if (value.kind === BackgroundKind.Texture) {
    repeat = 'repeat';
    if (value.texture === BackgroundTexture.Silk) {
      image = `linear-gradient(90deg, ${value.color} 1px, transparent 1px), linear-gradient(${value.color} 1px, transparent 1px)`;
      size = '4px 4px, 4px 6px';
    } else if (value.texture === BackgroundTexture.Grid) {
      image = `linear-gradient(${value.color} 1px, transparent 1px), linear-gradient(90deg, ${value.color} 1px, transparent 1px)`;
      size = '24px 24px';
    } else if (value.texture === BackgroundTexture.Dots) {
      image = `radial-gradient(${value.color} 1px, transparent 1px)`;
      size = '12px 12px';
    } else {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><filter id="paper"><feTurbulence type="fractalNoise" baseFrequency="0.72" numOctaves="3" stitchTiles="stitch" seed="7"/><feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.3 0.3 0.3 0 -0.3" result="grain"/><feFlood flood-color="${value.color}"/><feComposite in2="grain" operator="in"/></filter><rect width="100%" height="100%" filter="url(#paper)"/></svg>`;
      image = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
      size = '160px 160px';
    }
  }
  return {
    '--main-background-color': value.kind === BackgroundKind.Color ? value.color : 'transparent',
    '--main-background-image': image,
    '--main-background-size': size,
    '--main-background-repeat': repeat,
    '--main-background-opacity': String(value.kind === BackgroundKind.None ? 0 : value.opacity),
  };
}

export function applyThemeBackground(theme?: ThemeBackground): void {
  if (typeof document === 'undefined') return;
  const background = normalizeBackground(theme);
  for (const [property, value] of Object.entries(backgroundStyle(background)))
    document.documentElement.style.setProperty(property, value);
  document.documentElement.dataset.mainBackground = background.kind;
}
