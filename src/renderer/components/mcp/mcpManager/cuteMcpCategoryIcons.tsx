import { cn } from '@shared/lib/utils';
import React from 'react';

import {
  CUTE_INK,
  CUTE_STROKE,
  CuteAvatarTile,
  CUTE_PASTEL_THEMES,
} from '../../expert/cuteAvatarPrimitives';

const T = CUTE_PASTEL_THEMES;

export type McpCategoryId = 'productivity' | 'developer' | 'data-api' | string;

const CATEGORY_THEME: Record<string, keyof typeof CUTE_PASTEL_THEMES> = {
  productivity: 'peach',
  developer: 'periwinkle',
  'data-api': 'mint',
};

function CategoryMotif({ category }: { category: string }) {
  switch (category) {
    case 'developer':
      return (
        <>
          <path
            d="M16 18 L12 24 L16 30 M32 18 L36 24 L32 30"
            stroke={CUTE_INK}
            strokeWidth={CUTE_STROKE}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="24" cy="24" r="3" fill={T.periwinkle.accentSoft} />
        </>
      );
    case 'data-api':
      return (
        <>
          <ellipse
            cx="24"
            cy="18"
            rx="9"
            ry="3.5"
            fill={T.mint.accentSoft}
            stroke={T.mint.accent}
            strokeWidth="1.2"
          />
          <path
            d="M15 18 V28 C15 30.5, 19 32, 24 32 C29 32, 33 30.5, 33 28 V18"
            fill={T.mint.accentSoft}
            stroke={T.mint.accent}
            strokeWidth="1.2"
          />
        </>
      );
    case 'productivity':
    default:
      return (
        <>
          <rect
            x="14"
            y="14"
            width="20"
            height="16"
            rx="3"
            fill="white"
            fillOpacity="0.55"
            stroke={T.peach.accent}
            strokeWidth="1.4"
          />
          <line
            x1="18"
            y1="19"
            x2="30"
            y2="19"
            stroke={T.peach.accentSoft}
            strokeWidth="1.4"
            strokeLinecap="round"
          />
          <line
            x1="18"
            y1="24"
            x2="26"
            y2="24"
            stroke={T.peach.accentSoft}
            strokeWidth="1.4"
            strokeLinecap="round"
          />
          <path
            d="M18 28 L22 32 L28 26"
            stroke={T.mint.accent}
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </>
      );
  }
}

export const CuteMcpCategoryIcon: React.FC<{ category?: McpCategoryId; className?: string }> = ({
  category = 'productivity',
  className,
}) => {
  const themeKey = CATEGORY_THEME[category] ?? 'lavender';
  const theme = CUTE_PASTEL_THEMES[themeKey];
  return (
    <div className={cn('size-12 shrink-0 overflow-hidden rounded-xl', className)}>
      <CuteAvatarTile theme={theme} uid={`mcp-${category}`}>
        <CategoryMotif category={category} />
      </CuteAvatarTile>
    </div>
  );
};
