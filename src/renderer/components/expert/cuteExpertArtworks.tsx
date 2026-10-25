import React from 'react';

import {
  CUTE_INK,
  CUTE_STROKE,
  CuteAvatarTile,
  CuteFace,
  CUTE_PASTEL_THEMES,
} from './cuteAvatarPrimitives';

const T = CUTE_PASTEL_THEMES;

export const DataAnalystArt: React.FC<{ className?: string }> = ({ className }) => (
  <CuteAvatarTile theme={T.sky} className={className} uid="da">
    <ellipse cx="24" cy="30" rx="13" ry="10" fill={T.sky.accentSoft} fillOpacity="0.55" />
    <rect x="14" y="22" width="5" height="10" rx="2" fill={T.sky.accent} />
    <rect x="21" y="18" width="5" height="14" rx="2" fill={T.sky.accent} />
    <rect x="28" y="14" width="5" height="18" rx="2" fill={T.mint.accent} />
    <path
      d="M12 34 C16 28, 22 26, 36 18"
      stroke={T.lemon.accent}
      strokeWidth={CUTE_STROKE}
      strokeLinecap="round"
      fill="none"
    />
    <circle cx="36" cy="18" r="2.5" fill={T.lemon.accent} />
    <CuteFace cx={24} cy={27} eyeOffset={3.5} />
  </CuteAvatarTile>
);

export const ReactDevArt: React.FC<{ className?: string }> = ({ className }) => (
  <CuteAvatarTile theme={T.periwinkle} className={className} uid="rd">
    <ellipse
      cx="24"
      cy="24"
      rx="14"
      ry="5"
      stroke={T.periwinkle.accent}
      strokeWidth="1.6"
      fill="none"
      opacity="0.7"
    />
    <ellipse
      cx="24"
      cy="24"
      rx="14"
      ry="5"
      stroke={T.sky.accent}
      strokeWidth="1.6"
      fill="none"
      opacity="0.7"
      transform="rotate(60 24 24)"
    />
    <ellipse
      cx="24"
      cy="24"
      rx="14"
      ry="5"
      stroke={T.periwinkle.accentSoft}
      strokeWidth="1.6"
      fill="none"
      opacity="0.7"
      transform="rotate(120 24 24)"
    />
    <circle cx="24" cy="24" r="7" fill={T.periwinkle.accentSoft} />
    <CuteFace cx={24} cy={24} eyeOffset={2.8} blush={false} />
    <circle cx="38" cy="14" r="2" fill={T.lemon.accent} />
  </CuteAvatarTile>
);

export const ContentWriterArt: React.FC<{ className?: string }> = ({ className }) => (
  <CuteAvatarTile theme={T.butter} className={className} uid="cw">
    <path
      d="M30 12 L34 14 L22 36 L16 38 L18 32 Z"
      fill={T.peach.accent}
      stroke={CUTE_INK}
      strokeWidth="1.2"
      strokeLinejoin="round"
    />
    <path
      d="M10 32 C14 34, 18 33, 22 30"
      stroke={T.lavender.accent}
      strokeWidth={CUTE_STROKE}
      strokeLinecap="round"
      fill="none"
    />
    <circle cx="12" cy="30" r="2" fill={T.rose.accentSoft} />
    <ellipse cx="20" cy="22" rx="8" ry="7" fill={T.butter.accentSoft} />
    <CuteFace cx={20} cy={22} eyeOffset={2.5} />
  </CuteAvatarTile>
);

export const CadEngineerArt: React.FC<{ className?: string }> = ({ className }) => (
  <CuteAvatarTile theme={T.sky} className={className} uid="cad">
    <path
      d="M24 14 L34 20 L24 26 L14 20 Z"
      fill={T.sky.accentSoft}
      stroke={T.sky.accent}
      strokeWidth="1.4"
      strokeLinejoin="round"
    />
    <path
      d="M14 20 L14 30 L24 36 L24 26 Z"
      fill={T.periwinkle.accentSoft}
      stroke={T.periwinkle.accent}
      strokeWidth="1.2"
      strokeLinejoin="round"
    />
    <path
      d="M34 20 L34 30 L24 36 L24 26 Z"
      fill={T.sky.accent}
      fillOpacity="0.35"
      stroke={T.sky.accent}
      strokeWidth="1.2"
      strokeLinejoin="round"
    />
    <circle cx="24" cy="20" r="2.5" fill={T.lemon.accent} />
    <path
      d="M18 32 L24 26 L30 32"
      stroke={CUTE_INK}
      strokeWidth="1.4"
      strokeLinecap="round"
      fill="none"
    />
  </CuteAvatarTile>
);

export const EquityResearchArt: React.FC<{ className?: string }> = ({ className }) => (
  <CuteAvatarTile theme={T.mint} className={className} uid="eq">
    <ellipse cx="22" cy="28" rx="11" ry="9" fill={T.mint.accentSoft} fillOpacity="0.6" />
    <CuteFace cx={22} cy={27} eyeOffset={3} />
    <path
      d="M10 34 L18 28 L26 30 L38 16"
      stroke={T.mint.accent}
      strokeWidth={CUTE_STROKE}
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />
    <path d="M35 16 L38 13 L38 19 Z" fill={T.mint.accent} />
    <rect x="30" y="22" width="3" height="8" rx="1" fill={T.sky.accentSoft} />
    <rect x="34" y="18" width="3" height="12" rx="1" fill={T.sky.accent} />
  </CuteAvatarTile>
);

export const FinanceAccountingArt: React.FC<{ className?: string }> = ({ className }) => (
  <CuteAvatarTile theme={T.lavender} className={className} uid="fa">
    <line
      x1="24"
      y1="14"
      x2="24"
      y2="34"
      stroke={T.lavender.accent}
      strokeWidth="2.2"
      strokeLinecap="round"
    />
    <line
      x1="18"
      y1="34"
      x2="30"
      y2="34"
      stroke={T.lavender.accent}
      strokeWidth="2.2"
      strokeLinecap="round"
    />
    <line
      x1="12"
      y1="20"
      x2="36"
      y2="20"
      stroke={T.lavender.accent}
      strokeWidth="2"
      strokeLinecap="round"
    />
    <path
      d="M10 24 Q14 30 18 24 Z"
      fill={T.lemon.accentSoft}
      stroke={T.lemon.accent}
      strokeWidth="1"
    />
    <circle cx="14" cy="23" r="2.2" fill={T.lemon.accent} />
    <path
      d="M30 24 Q34 30 38 24 Z"
      fill={T.lemon.accentSoft}
      stroke={T.lemon.accent}
      strokeWidth="1"
    />
    <circle cx="34" cy="23" r="2.2" fill={T.lemon.accent} />
    <circle cx="24" cy="20" r="2.8" fill={T.rose.accentSoft} />
  </CuteAvatarTile>
);

export const MarketingCampaignArt: React.FC<{ className?: string }> = ({ className }) => (
  <CuteAvatarTile theme={T.rose} className={className} uid="mk">
    <path d="M14 22 L22 18 L22 30 L14 26 Z" fill={T.coral.accent} />
    <rect x="11" y="22" width="3" height="6" rx="1.2" fill={T.rose.accentSoft} />
    <ellipse cx="26" cy="24" rx="10" ry="8" fill={T.rose.accentSoft} fillOpacity="0.5" />
    <CuteFace cx={26} cy={24} eyeOffset={2.8} />
    <path
      d="M32 18 C36 20, 38 24, 36 28"
      stroke={T.coral.accent}
      strokeWidth="1.8"
      strokeLinecap="round"
      fill="none"
    />
    <path
      d="M36 16 C42 20, 42 28, 36 32"
      stroke={T.rose.accent}
      strokeWidth="1.6"
      strokeLinecap="round"
      fill="none"
      opacity="0.75"
    />
  </CuteAvatarTile>
);

export const PresalesConsultantArt: React.FC<{ className?: string }> = ({ className }) => (
  <CuteAvatarTile theme={T.sky} className={className} uid="ps">
    <rect
      x="12"
      y="12"
      width="24"
      height="18"
      rx="4"
      fill="white"
      fillOpacity="0.65"
      stroke={T.sky.accent}
      strokeWidth="1.6"
    />
    <circle cx="18" cy="18" r="2" fill={T.periwinkle.accent} />
    <circle cx="30" cy="18" r="2" fill={T.periwinkle.accent} />
    <circle cx="24" cy="24" r="2.5" fill={T.lemon.accent} />
    <line x1="18" y1="18" x2="24" y2="24" stroke={T.sky.accentSoft} strokeWidth="1.2" />
    <line x1="30" y1="18" x2="24" y2="24" stroke={T.sky.accentSoft} strokeWidth="1.2" />
    <path d="M22 34 L24 38 L26 34" stroke={T.sky.accent} strokeWidth="1.8" strokeLinecap="round" />
    <line
      x1="18"
      y1="38"
      x2="30"
      y2="38"
      stroke={T.sky.accent}
      strokeWidth="1.8"
      strokeLinecap="round"
    />
  </CuteAvatarTile>
);

export const DailyReportArt: React.FC<{ className?: string }> = ({ className }) => (
  <CuteAvatarTile theme={T.mint} className={className} uid="dr">
    <rect
      x="14"
      y="10"
      width="20"
      height="26"
      rx="3"
      fill="white"
      fillOpacity="0.7"
      stroke={T.mint.accent}
      strokeWidth="1.6"
    />
    <line
      x1="18"
      y1="16"
      x2="30"
      y2="16"
      stroke={T.mint.accentSoft}
      strokeWidth="1.4"
      strokeLinecap="round"
    />
    <line
      x1="18"
      y1="21"
      x2="28"
      y2="21"
      stroke={T.mint.accentSoft}
      strokeWidth="1.4"
      strokeLinecap="round"
    />
    <path
      d="M17 28 L21 32 L31 22"
      stroke={T.mint.accent}
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />
    <circle cx="34" cy="14" r="2" fill={T.lemon.accent} />
  </CuteAvatarTile>
);
