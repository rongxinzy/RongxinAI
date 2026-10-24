import React from 'react';

import {
  CUTE_INK,
  CUTE_STROKE,
  CuteAvatarTile,
  CuteFace,
  CUTE_PASTEL_THEMES,
  type CutePastelThemeKey,
} from './cuteAvatarPrimitives';

const T = CUTE_PASTEL_THEMES;

const ICON_THEME: Record<string, CutePastelThemeKey> = {
  code: 'periwinkle',
  terminal: 'lavender',
  fileCode: 'sky',
  cpu: 'periwinkle',
  brain: 'lavender',
  sparkles: 'lemon',
  palette: 'rose',
  layers: 'sky',
  chart: 'mint',
  database: 'sky',
  boxes: 'peach',
  radar: 'mint',
  scale: 'lavender',
  wrench: 'butter',
  microscope: 'mint',
  bookOpen: 'butter',
  compass: 'coral',
  rocket: 'coral',
  shield: 'mint',
  bot: 'periwinkle',
  zap: 'lemon',
  cloud: 'sky',
  python: 'mint',
  presentation: 'peach',
};

function Motif({ name }: { name: string }) {
  switch (name) {
    case 'code':
      return (
        <>
          <path
            d="M16 18 L12 24 L16 30 M32 18 L36 24 L32 30"
            stroke={CUTE_INK}
            strokeWidth={CUTE_STROKE}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <line
            x1="22"
            y1="16"
            x2="26"
            y2="32"
            stroke={T.periwinkle.accent}
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </>
      );
    case 'terminal':
      return (
        <path
          d="M14 16 L22 24 L14 32 M26 32 H34"
          stroke={CUTE_INK}
          strokeWidth={CUTE_STROKE}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );
    case 'fileCode':
      return (
        <>
          <path
            d="M16 12 H28 L34 18 V36 H16 Z"
            fill="white"
            fillOpacity="0.6"
            stroke={T.sky.accent}
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
          <path
            d="M16 18 L22 24 L16 30"
            stroke={CUTE_INK}
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      );
    case 'cpu':
      return (
        <>
          <rect
            x="17"
            y="17"
            width="14"
            height="14"
            rx="3"
            fill={T.periwinkle.accentSoft}
            stroke={T.periwinkle.accent}
            strokeWidth="1.4"
          />
          <CuteFace cx={24} cy={24} eyeOffset={2.2} blush={false} smile={false} />
          <line x1="24" y1="12" x2="24" y2="15" stroke={T.periwinkle.accent} strokeWidth="1.4" />
          <line x1="24" y1="33" x2="24" y2="36" stroke={T.periwinkle.accent} strokeWidth="1.4" />
          <line x1="12" y1="24" x2="15" y2="24" stroke={T.periwinkle.accent} strokeWidth="1.4" />
          <line x1="33" y1="24" x2="36" y2="24" stroke={T.periwinkle.accent} strokeWidth="1.4" />
        </>
      );
    case 'brain':
      return (
        <>
          <path
            d="M24 14 C18 14, 14 18, 14 24 C14 30, 18 34, 24 34 C30 34, 34 30, 34 24 C34 18, 30 14, 24 14 Z"
            fill={T.lavender.accentSoft}
            stroke={T.lavender.accent}
            strokeWidth="1.4"
          />
          <CuteFace cx={24} cy={24} eyeOffset={3} />
        </>
      );
    case 'sparkles':
      return (
        <>
          <path
            d="M24 12 L25 18 L31 19 L25 20 L24 26 L23 20 L17 19 L23 18 Z"
            fill={T.lemon.accent}
          />
          <circle cx="14" cy="28" r="2" fill={T.rose.accentSoft} />
          <circle cx="34" cy="30" r="1.5" fill={T.sky.accentSoft} />
        </>
      );
    case 'palette':
      return (
        <>
          <ellipse
            cx="24"
            cy="26"
            rx="12"
            ry="10"
            fill="white"
            fillOpacity="0.55"
            stroke={T.rose.accent}
            strokeWidth="1.4"
          />
          <circle cx="18" cy="24" r="2" fill={T.sky.accent} />
          <circle cx="24" cy="22" r="2" fill={T.mint.accent} />
          <circle cx="30" cy="25" r="2" fill={T.lemon.accent} />
          <circle cx="22" cy="28" r="2" fill={T.lavender.accent} />
        </>
      );
    case 'layers':
      return (
        <>
          <path
            d="M24 14 L36 20 L24 26 L12 20 Z"
            fill={T.sky.accentSoft}
            stroke={T.sky.accent}
            strokeWidth="1.2"
          />
          <path
            d="M24 20 L36 26 L24 32 L12 26 Z"
            fill={T.periwinkle.accentSoft}
            stroke={T.periwinkle.accent}
            strokeWidth="1.2"
          />
        </>
      );
    case 'chart':
      return (
        <>
          <rect x="14" y="24" width="4" height="10" rx="1.5" fill={T.mint.accent} />
          <rect x="22" y="18" width="4" height="16" rx="1.5" fill={T.mint.accent} />
          <rect x="30" y="22" width="4" height="12" rx="1.5" fill={T.sky.accent} />
        </>
      );
    case 'database':
      return (
        <>
          <ellipse
            cx="24"
            cy="18"
            rx="10"
            ry="4"
            fill={T.sky.accentSoft}
            stroke={T.sky.accent}
            strokeWidth="1.4"
          />
          <path
            d="M14 18 V30 C14 33, 18 35, 24 35 C30 35, 34 33, 34 30 V18"
            fill={T.sky.accentSoft}
            stroke={T.sky.accent}
            strokeWidth="1.4"
          />
          <ellipse
            cx="24"
            cy="24"
            rx="10"
            ry="4"
            stroke={T.sky.accent}
            strokeWidth="1"
            fill="none"
            opacity="0.5"
          />
        </>
      );
    case 'boxes':
      return (
        <path
          d="M14 20 L24 14 L34 20 V30 L24 36 L14 30 Z"
          fill={T.peach.accentSoft}
          stroke={T.peach.accent}
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
      );
    case 'radar':
      return (
        <>
          <circle cx="24" cy="24" r="10" stroke={T.mint.accentSoft} strokeWidth="1.2" fill="none" />
          <circle cx="24" cy="24" r="6" stroke={T.mint.accentSoft} strokeWidth="1" fill="none" />
          <path d="M24 24 L32 16" stroke={T.mint.accent} strokeWidth="1.8" strokeLinecap="round" />
          <circle cx="32" cy="16" r="2" fill={T.coral.accent} />
        </>
      );
    case 'scale':
      return (
        <>
          <line
            x1="24"
            y1="14"
            x2="24"
            y2="32"
            stroke={T.lavender.accent}
            strokeWidth="2"
            strokeLinecap="round"
          />
          <line
            x1="14"
            y1="20"
            x2="34"
            y2="20"
            stroke={T.lavender.accent}
            strokeWidth="1.8"
            strokeLinecap="round"
          />
          <path d="M12 24 Q16 28 20 24 Z" fill={T.lemon.accentSoft} />
          <path d="M28 24 Q32 28 36 24 Z" fill={T.lemon.accentSoft} />
        </>
      );
    case 'wrench':
      return (
        <path
          d="M30 14 C27 17, 28 21, 25 24 L18 31 C16 33, 13 33, 11 31 C9 29, 9 26, 11 24 L18 17 C21 14, 25 13, 28 16 L30 14 Z"
          fill={T.butter.accentSoft}
          stroke={T.butter.accent}
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
      );
    case 'microscope':
      return (
        <>
          <path d="M16 34 H32" stroke={CUTE_INK} strokeWidth="1.8" strokeLinecap="round" />
          <path
            d="M22 34 V22 L28 16"
            stroke={T.mint.accent}
            strokeWidth="1.8"
            strokeLinecap="round"
          />
          <circle
            cx="28"
            cy="16"
            r="4"
            fill={T.mint.accentSoft}
            stroke={T.mint.accent}
            strokeWidth="1.2"
          />
        </>
      );
    case 'bookOpen':
      return (
        <>
          <path
            d="M14 16 C18 14, 22 14, 24 16 V34 C22 32, 18 32, 14 34 Z"
            fill={T.butter.accentSoft}
            stroke={T.butter.accent}
            strokeWidth="1.2"
          />
          <path
            d="M34 16 C30 14, 26 14, 24 16 V34 C26 32, 30 32, 34 34 Z"
            fill={T.butter.accentSoft}
            stroke={T.butter.accent}
            strokeWidth="1.2"
          />
        </>
      );
    case 'compass':
      return (
        <>
          <circle
            cx="24"
            cy="24"
            r="11"
            stroke={T.coral.accent}
            strokeWidth="1.6"
            fill="white"
            fillOpacity="0.4"
          />
          <path d="M24 16 L26 28 L24 26 L22 28 Z" fill={T.coral.accent} />
        </>
      );
    case 'rocket':
      return (
        <>
          <path d="M24 12 C20 18, 20 26, 22 34 H26 C28 26, 28 18, 24 12 Z" fill={T.coral.accent} />
          <circle cx="24" cy="22" r="2.5" fill="white" fillOpacity="0.8" />
          <path
            d="M20 30 L16 36 M28 30 L32 36"
            stroke={T.coral.accentSoft}
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </>
      );
    case 'shield':
      return (
        <path
          d="M24 12 L34 16 V24 C34 30, 30 34, 24 36 C18 34, 14 30, 14 24 V16 Z"
          fill={T.mint.accentSoft}
          stroke={T.mint.accent}
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
      );
    case 'bot':
      return (
        <>
          <rect
            x="16"
            y="18"
            width="16"
            height="14"
            rx="4"
            fill={T.periwinkle.accentSoft}
            stroke={T.periwinkle.accent}
            strokeWidth="1.4"
          />
          <CuteFace cx={24} cy={25} eyeOffset={3} blush={false} />
          <line x1="20" y1="14" x2="20" y2="18" stroke={T.periwinkle.accent} strokeWidth="1.6" />
          <line x1="28" y1="14" x2="28" y2="18" stroke={T.periwinkle.accent} strokeWidth="1.6" />
        </>
      );
    case 'zap':
      return (
        <path
          d="M26 12 L18 26 H24 L22 36 L30 22 H24 Z"
          fill={T.lemon.accent}
          stroke={T.lemon.accentSoft}
          strokeWidth="0.8"
        />
      );
    case 'cloud':
      return (
        <path
          d="M16 28 C12 28, 12 24, 14 22 C14 18, 18 16, 22 16 C23 13, 26 12, 29 13 C33 13, 36 16, 36 20 C38 21, 38 24, 36 26 C36 28, 34 30, 32 30 H18 C17 30, 16 29, 16 28 Z"
          fill="white"
          fillOpacity="0.65"
          stroke={T.sky.accent}
          strokeWidth="1.4"
        />
      );
    case 'python':
      return (
        <>
          <path
            d="M18 16 C14 18, 14 22, 16 24 C14 26, 14 30, 18 32 C20 33, 24 33, 26 31 C28 33, 32 33, 34 30 C36 27, 36 24, 34 22 C36 20, 36 16, 32 14 C30 13, 26 13, 24 15 C22 13, 20 14, 18 16 Z"
            fill={T.mint.accentSoft}
            stroke={T.mint.accent}
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
          <CuteFace cx={24} cy={23} eyeOffset={3} blush={false} />
          <path
            d="M14 20 L12 20 M34 26 L36 26"
            stroke={T.mint.accent}
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </>
      );
    case 'presentation':
      return (
        <>
          <rect
            x="13"
            y="14"
            width="22"
            height="16"
            rx="3"
            fill="white"
            fillOpacity="0.65"
            stroke={T.peach.accent}
            strokeWidth="1.4"
          />
          <rect x="16" y="17" width="8" height="5" rx="1" fill={T.peach.accentSoft} />
          <rect x="26" y="17" width="6" height="10" rx="1" fill={T.coral.accentSoft} />
          <path
            d="M22 34 L24 38 L26 34"
            stroke={T.peach.accent}
            strokeWidth="1.6"
            strokeLinecap="round"
          />
          <circle cx="30" cy="19" r="1.5" fill={T.lemon.accent} />
        </>
      );
    default:
      return (
        <>
          <ellipse cx="24" cy="26" rx="10" ry="9" fill={T.lavender.accentSoft} />
          <CuteFace cx={24} cy={26} />
        </>
      );
  }
}

export const CuteCustomExpertArt: React.FC<{ iconKey: string; className?: string }> = ({
  iconKey,
  className,
}) => {
  const themeKey = ICON_THEME[iconKey] ?? 'lavender';
  const theme = T[themeKey];
  return (
    <CuteAvatarTile theme={theme} className={className} uid={`cc-${iconKey}`}>
      <Motif name={iconKey} />
    </CuteAvatarTile>
  );
};

/** Soft pastel tile backgrounds for custom expert color picker (replaces dark neon gradients). */
export const CUSTOM_EXPERT_GRADIENTS = [
  'linear-gradient(135deg, #E8F4FC, #CFE8F8)',
  'linear-gradient(135deg, #F0EBFF, #E0D6FF)',
  'linear-gradient(135deg, #E8EEFF, #D4DEFF)',
  'linear-gradient(135deg, #E8F8F0, #D0F0E0)',
  'linear-gradient(135deg, #FFF9E6, #FFF0C4)',
  'linear-gradient(135deg, #FFE8F0, #FFD6E4)',
  'linear-gradient(135deg, #FFF0E8, #FFE2D4)',
  'linear-gradient(135deg, #FFECE8, #FFD8D0)',
  'linear-gradient(135deg, #FFF8E8, #FFEFD0)',
  'linear-gradient(135deg, #E8F4FC, #D4E9F7)',
  'linear-gradient(135deg, #F0EBFF, #E8E0FF)',
  'linear-gradient(135deg, #E8F8F0, #C8E8D8)',
  'linear-gradient(135deg, #FFF0E8, #FFDCC8)',
  'linear-gradient(135deg, #FFE8F0, #FFC8DC)',
  'linear-gradient(135deg, #E8EEFF, #D8E4FF)',
  'linear-gradient(135deg, #FFF9E6, #FFE8A8)',
];
