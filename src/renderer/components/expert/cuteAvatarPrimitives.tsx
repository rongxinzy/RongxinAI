import { cn } from '@shared/lib/utils';
import React from 'react';

/** Shared ink for cute mascot strokes — soft plum-gray, not harsh black. */
export const CUTE_INK = '#5D4E63';
const CUTE_INK_SOFT = '#8A7B8F';
export const CUTE_STROKE = 2;
const CUTE_TILE_RX = 14;

export interface CutePastelTheme {
  bgFrom: string;
  bgTo: string;
  accent: string;
  accentSoft: string;
}

export const CUTE_PASTEL_THEMES = {
  sky: { bgFrom: '#E8F4FC', bgTo: '#CFE8F8', accent: '#5BA4D9', accentSoft: '#9CCCEB' },
  peach: { bgFrom: '#FFF0E8', bgTo: '#FFE2D4', accent: '#E8956A', accentSoft: '#F5C4A8' },
  mint: { bgFrom: '#E8F8F0', bgTo: '#D0F0E0', accent: '#5CB88A', accentSoft: '#9AD4B8' },
  lavender: { bgFrom: '#F0EBFF', bgTo: '#E0D6FF', accent: '#9B87DE', accentSoft: '#C4B8F0' },
  lemon: { bgFrom: '#FFF9E6', bgTo: '#FFF0C4', accent: '#E5B84A', accentSoft: '#F5D88A' },
  rose: { bgFrom: '#FFE8F0', bgTo: '#FFD6E4', accent: '#E87AA0', accentSoft: '#F5B0C8' },
  butter: { bgFrom: '#FFF8E8', bgTo: '#FFEFD0', accent: '#D9A84A', accentSoft: '#F0D090' },
  coral: { bgFrom: '#FFECE8', bgTo: '#FFD8D0', accent: '#E87868', accentSoft: '#F5B0A8' },
  periwinkle: { bgFrom: '#E8EEFF', bgTo: '#D4DEFF', accent: '#7B8FDE', accentSoft: '#A8B8F0' },
} as const satisfies Record<string, CutePastelTheme>;

export type CutePastelThemeKey = keyof typeof CUTE_PASTEL_THEMES;

export interface CuteAvatarTileProps {
  theme: CutePastelTheme;
  className?: string;
  children: React.ReactNode;
  /** Optional unique id prefix for SVG defs inside the tile. */
  uid?: string;
}

export function CuteAvatarTile({ theme, className, children, uid = 'cat' }: CuteAvatarTileProps) {
  const bgId = `${uid}-bg`;
  return (
    <svg viewBox="0 0 48 48" fill="none" className={cn('size-full', className)} aria-hidden="true">
      <defs>
        <linearGradient id={bgId} x1="4" y1="4" x2="44" y2="44" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={theme.bgFrom} />
          <stop offset="100%" stopColor={theme.bgTo} />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx={CUTE_TILE_RX} fill={`url(#${bgId})`} />
      {/* Soft inner highlight */}
      <ellipse cx="18" cy="12" rx="14" ry="8" fill="white" fillOpacity="0.35" />
      {children}
    </svg>
  );
}

/** Tiny kawaii face — optional cheeks and sparkle. */
export function CuteFace({
  cx = 24,
  cy = 26,
  eyeOffset = 4,
  smile = true,
  blush = true,
}: {
  cx?: number;
  cy?: number;
  eyeOffset?: number;
  smile?: boolean;
  blush?: boolean;
}) {
  return (
    <g>
      {blush && (
        <>
          <circle cx={cx - 7} cy={cy + 2} r="2.2" fill="#FFB8C8" fillOpacity="0.55" />
          <circle cx={cx + 7} cy={cy + 2} r="2.2" fill="#FFB8C8" fillOpacity="0.55" />
        </>
      )}
      <circle cx={cx - eyeOffset} cy={cy - 2} r="1.6" fill={CUTE_INK} />
      <circle cx={cx + eyeOffset} cy={cy - 2} r="1.6" fill={CUTE_INK} />
      <circle cx={cx - eyeOffset + 0.5} cy={cy - 2.8} r="0.55" fill="white" />
      <circle cx={cx + eyeOffset + 0.5} cy={cy - 2.8} r="0.55" fill="white" />
      {smile && (
        <path
          d={`M${cx - 3.5} ${cy + 3} Q ${cx} ${cy + 6.5} ${cx + 3.5} ${cy + 3}`}
          stroke={CUTE_INK_SOFT}
          strokeWidth="1.4"
          strokeLinecap="round"
          fill="none"
        />
      )}
    </g>
  );
}
