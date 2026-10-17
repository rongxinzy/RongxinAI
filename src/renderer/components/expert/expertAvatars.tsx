import { Avatar, AvatarFallback } from '@shared/components/ui/avatar';
import { cn } from '@shared/lib/utils';
import {
  Atom,
  Calculator,
  ChartColumn,
  ClipboardCheck,
  DraftingCompass,
  Feather,
  Megaphone,
  Presentation,
  TrendingUp,
  Brain,
  Code2,
  Sparkles,
  Rocket,
  Shield,
  Bot,
  Zap,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import React from 'react';

export interface PresetExpertAvatarStyle {
  icon: LucideIcon;
  /** CSS background (gradient tile). Decorative artwork, intentionally theme-independent. */
  background: string;
  /** Icon stroke color; defaults to white. */
  iconColor?: string;
  /** Bespoke handcrafted vector artwork component. */
  Artwork?: React.FC<{ className?: string }>;
}

/** Soft top-left sheen layered over every tile so avatars read as lit, flat artwork. */
const TILE_SHEEN =
  'radial-gradient(120% 120% at 18% 12%, rgb(255 255 255 / 0.22), rgb(255 255 255 / 0) 48%)';

const tile = (gradient: string) => `${TILE_SHEEN}, ${gradient}`;

// ============================================================================
// Bespoke Vector Artworks for Built-in Preset Experts
// ============================================================================

/** Data Analyst — 3D isometric ascending bar towers with glowing trend spline & radar grid */
const DataAnalystArt: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 48 48" fill="none" className={cn('size-full', className)}>
    <defs>
      <linearGradient id="da-bg" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#1E3A8A" />
        <stop offset="100%" stopColor="#0B132B" />
      </linearGradient>
      <linearGradient id="da-b1" x1="10" y1="36" x2="16" y2="24" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#3B82F6" stopOpacity="0.4" />
        <stop offset="100%" stopColor="#60A5FA" />
      </linearGradient>
      <linearGradient id="da-b2" x1="18" y1="36" x2="24" y2="18" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#2563EB" stopOpacity="0.5" />
        <stop offset="100%" stopColor="#38BDF8" />
      </linearGradient>
      <linearGradient id="da-b3" x1="26" y1="36" x2="32" y2="12" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#0284C7" stopOpacity="0.6" />
        <stop offset="100%" stopColor="#34D399" />
      </linearGradient>
      <linearGradient id="da-line" x1="10" y1="30" x2="36" y2="12" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#38BDF8" />
        <stop offset="60%" stopColor="#67E8F9" />
        <stop offset="100%" stopColor="#FACC15" />
      </linearGradient>
      <filter id="da-glow" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="1.5" result="blur" />
        <feComposite in="SourceGraphic" in2="blur" operator="over" />
      </filter>
    </defs>
    <rect width="48" height="48" rx="12" fill="url(#da-bg)" />
    {/* Grid lines */}
    <circle cx="24" cy="24" r="16" stroke="rgba(255,255,255,0.08)" strokeDasharray="2 2" />
    <line x1="8" y1="36" x2="40" y2="36" stroke="rgba(255,255,255,0.18)" strokeWidth="1.2" />
    {/* Bars */}
    <rect x="11" y="24" width="5" height="12" rx="1.5" fill="url(#da-b1)" />
    <rect x="19" y="18" width="5" height="18" rx="1.5" fill="url(#da-b2)" />
    <rect x="27" y="13" width="5" height="23" rx="1.5" fill="url(#da-b3)" />
    {/* Trend Line */}
    <path
      d="M10 29 C 14 26, 18 22, 21.5 20 C 25 18, 27 16, 35 12"
      stroke="url(#da-line)"
      strokeWidth="2.2"
      strokeLinecap="round"
      filter="url(#da-glow)"
    />
    <circle cx="13.5" cy="26" r="1.8" fill="#FFFFFF" />
    <circle cx="21.5" cy="20" r="1.8" fill="#FFFFFF" />
    <circle cx="35" cy="12" r="2.4" fill="#FDE047" filter="url(#da-glow)" />
    <circle cx="35" cy="12" r="1.2" fill="#FFFFFF" />
  </svg>
);

/** React Dev — Atomic orbital rings with glowing nucleus & code brackets */
const ReactDevArt: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 48 48" fill="none" className={cn('size-full', className)}>
    <defs>
      <linearGradient id="rd-bg" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#0B132B" />
        <stop offset="100%" stopColor="#1E293B" />
      </linearGradient>
      <linearGradient id="rd-cyan" x1="12" y1="12" x2="36" y2="36" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#00F2FE" />
        <stop offset="100%" stopColor="#4FACFE" />
      </linearGradient>
      <filter id="rd-glow" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="1.5" result="blur" />
        <feComposite in="SourceGraphic" in2="blur" operator="over" />
      </filter>
    </defs>
    <rect width="48" height="48" rx="12" fill="url(#rd-bg)" />
    {/* Three Interlocking React Orbitals */}
    <ellipse
      cx="24"
      cy="24"
      rx="15"
      ry="5.5"
      stroke="url(#rd-cyan)"
      strokeWidth="1.6"
      strokeOpacity="0.85"
    />
    <ellipse
      cx="24"
      cy="24"
      rx="15"
      ry="5.5"
      transform="rotate(60 24 24)"
      stroke="url(#rd-cyan)"
      strokeWidth="1.6"
      strokeOpacity="0.85"
    />
    <ellipse
      cx="24"
      cy="24"
      rx="15"
      ry="5.5"
      transform="rotate(120 24 24)"
      stroke="url(#rd-cyan)"
      strokeWidth="1.6"
      strokeOpacity="0.85"
    />
    {/* Center Core Node */}
    <circle cx="24" cy="24" r="3.2" fill="#38BDF8" filter="url(#rd-glow)" />
    <circle cx="24" cy="24" r="1.6" fill="#FFFFFF" />
    {/* Subtle angle brackets */}
    <path
      d="M17 21 L14 24 L17 27"
      stroke="#67E8F9"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      opacity="0.7"
    />
    <path
      d="M31 21 L34 24 L31 27"
      stroke="#67E8F9"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      opacity="0.7"
    />
  </svg>
);

/** Content Writer — Aerodynamic golden quill with flowing narrative ribbon arcs */
const ContentWriterArt: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 48 48" fill="none" className={cn('size-full', className)}>
    <defs>
      <linearGradient id="cw-bg" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#451A03" />
        <stop offset="100%" stopColor="#1C1917" />
      </linearGradient>
      <linearGradient id="cw-gold" x1="14" y1="10" x2="36" y2="38" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#FDE047" />
        <stop offset="50%" stopColor="#F59E0B" />
        <stop offset="100%" stopColor="#D97706" />
      </linearGradient>
      <linearGradient id="cw-ribbon" x1="10" y1="26" x2="38" y2="34" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#FCD34D" stopOpacity="0.2" />
        <stop offset="100%" stopColor="#F59E0B" stopOpacity="0.8" />
      </linearGradient>
    </defs>
    <rect width="48" height="48" rx="12" fill="url(#cw-bg)" />
    {/* Narrative Wave Ribbon */}
    <path
      d="M10 32 C 16 35, 22 28, 28 32 C 32 35, 36 34, 38 31"
      stroke="url(#cw-ribbon)"
      strokeWidth="2.4"
      strokeLinecap="round"
    />
    {/* Stylized Modern Quill Nib */}
    <path
      d="M33 11 C 31 15, 28 20, 24 25 C 22 28, 19 31, 16 33 L 15 34 L 17 31 C 19 28, 22 25, 25 21 C 29 17, 32 13, 33 11 Z"
      fill="url(#cw-gold)"
    />
    <path d="M15 34 L 20 29" stroke="#78350F" strokeWidth="1" strokeLinecap="round" />
    <circle cx="34" cy="11" r="1.5" fill="#FEF08A" />
    {/* Ink/Spark particles */}
    <circle cx="14" cy="35" r="1.2" fill="#FDE047" />
    <path
      d="M30 18 L 32 16 M 34 22 L 36 21"
      stroke="#FCD34D"
      strokeWidth="1.2"
      strokeLinecap="round"
      opacity="0.6"
    />
  </svg>
);

/** CAD Engineering Expert — Isometric wireframe cube with drafting caliper & blueprint grid */
const CadEngineerArt: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 48 48" fill="none" className={cn('size-full', className)}>
    <defs>
      <linearGradient id="cad-bg" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#0F172A" />
        <stop offset="100%" stopColor="#1E293B" />
      </linearGradient>
      <linearGradient id="cad-steel" x1="14" y1="12" x2="34" y2="36" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#38BDF8" />
        <stop offset="100%" stopColor="#818CF8" />
      </linearGradient>
    </defs>
    <rect width="48" height="48" rx="12" fill="url(#cad-bg)" />
    {/* Isometric Cube Wireframe */}
    <path
      d="M24 12 L36 19 L24 26 L12 19 Z"
      stroke="url(#cad-steel)"
      strokeWidth="1.6"
      strokeLinejoin="round"
      fill="rgba(56,189,248,0.06)"
    />
    <path
      d="M12 19 L12 31 L24 38 L24 26 Z"
      stroke="url(#cad-steel)"
      strokeWidth="1.6"
      strokeLinejoin="round"
      fill="rgba(56,189,248,0.12)"
    />
    <path
      d="M36 19 L36 31 L24 38 L24 26 Z"
      stroke="url(#cad-steel)"
      strokeWidth="1.6"
      strokeLinejoin="round"
      fill="rgba(129,140,248,0.16)"
    />
    {/* Drafting Compass Pivot & Caliper Line */}
    <circle cx="24" cy="18" r="2.2" fill="#38BDF8" />
    <circle cx="24" cy="18" r="1.1" fill="#FFFFFF" />
    <line
      x1="24"
      y1="18"
      x2="18"
      y2="30"
      stroke="#FDE047"
      strokeWidth="1.6"
      strokeLinecap="round"
    />
    <line
      x1="24"
      y1="18"
      x2="30"
      y2="30"
      stroke="#FDE047"
      strokeWidth="1.6"
      strokeLinecap="round"
    />
    <path d="M20 27 Q 24 29 28 27" stroke="#FDE047" strokeWidth="1.2" strokeLinecap="round" />
  </svg>
);

/** Equity Research — Financial candlestick chart with bullish surge spline & radar sweep */
const EquityResearchArt: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 48 48" fill="none" className={cn('size-full', className)}>
    <defs>
      <linearGradient id="eq-bg" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#064E3B" />
        <stop offset="100%" stopColor="#022C22" />
      </linearGradient>
      <linearGradient id="eq-surge" x1="10" y1="34" x2="38" y2="12" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#34D399" />
        <stop offset="100%" stopColor="#A7F3D0" />
      </linearGradient>
    </defs>
    <rect width="48" height="48" rx="12" fill="url(#eq-bg)" />
    {/* Coordinate grid */}
    <line x1="8" y1="36" x2="40" y2="36" stroke="rgba(255,255,255,0.14)" strokeWidth="1.2" />
    {/* Candlestick 1 */}
    <line x1="14" y1="24" x2="14" y2="33" stroke="#34D399" strokeWidth="1" />
    <rect x="12" y="26" width="4" height="5" rx="0.8" fill="#10B981" />
    {/* Candlestick 2 */}
    <line x1="22" y1="19" x2="22" y2="30" stroke="#34D399" strokeWidth="1" />
    <rect x="20" y="21" width="4" height="7" rx="0.8" fill="#10B981" />
    {/* Candlestick 3 */}
    <line x1="30" y1="13" x2="30" y2="25" stroke="#34D399" strokeWidth="1" />
    <rect x="28" y="15" width="4" height="8" rx="0.8" fill="#34D399" />
    {/* Exponential Curve with Beacon */}
    <path
      d="M10 32 Q 22 28 35 12"
      stroke="url(#eq-surge)"
      strokeWidth="2.2"
      strokeLinecap="round"
    />
    <circle cx="35" cy="12" r="2.8" fill="#FACC15" />
    <circle cx="35" cy="12" r="1.4" fill="#FFFFFF" />
  </svg>
);

/** Finance & Accounting — Dual-entry ledger balance crystal & audit cipher seal */
const FinanceAccountingArt: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 48 48" fill="none" className={cn('size-full', className)}>
    <defs>
      <linearGradient id="fa-bg" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#312E81" />
        <stop offset="100%" stopColor="#1E1B4B" />
      </linearGradient>
      <linearGradient id="fa-gold" x1="12" y1="14" x2="36" y2="34" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#FCD34D" />
        <stop offset="100%" stopColor="#F59E0B" />
      </linearGradient>
    </defs>
    <rect width="48" height="48" rx="12" fill="url(#fa-bg)" />
    {/* Balance Scale Center Pillar */}
    <line
      x1="24"
      y1="13"
      x2="24"
      y2="35"
      stroke="url(#fa-gold)"
      strokeWidth="2"
      strokeLinecap="round"
    />
    <line
      x1="20"
      y1="35"
      x2="28"
      y2="35"
      stroke="url(#fa-gold)"
      strokeWidth="2.4"
      strokeLinecap="round"
    />
    {/* Balance Beam */}
    <path d="M12 18 L 36 18" stroke="url(#fa-gold)" strokeWidth="2" strokeLinecap="round" />
    <circle cx="24" cy="18" r="2.5" fill="#FEF08A" />
    {/* Left Pan */}
    <line x1="14" y1="18" x2="11" y2="26" stroke="rgba(255,255,255,0.4)" strokeWidth="1" />
    <line x1="14" y1="18" x2="17" y2="26" stroke="rgba(255,255,255,0.4)" strokeWidth="1" />
    <path d="M10 26 Q 14 30 18 26 Z" fill="#818CF8" />
    {/* Right Pan */}
    <line x1="34" y1="18" x2="31" y2="26" stroke="rgba(255,255,255,0.4)" strokeWidth="1" />
    <line x1="34" y1="18" x2="37" y2="26" stroke="rgba(255,255,255,0.4)" strokeWidth="1" />
    <path d="M30 26 Q 34 30 38 26 Z" fill="#818CF8" />
  </svg>
);

/** Marketing Campaign Expert — Megaphone broadcaster with expanding acoustic wavefronts */
const MarketingCampaignArt: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 48 48" fill="none" className={cn('size-full', className)}>
    <defs>
      <linearGradient id="mk-bg" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#881337" />
        <stop offset="100%" stopColor="#4C0519" />
      </linearGradient>
      <linearGradient id="mk-coral" x1="14" y1="14" x2="34" y2="34" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#FB7185" />
        <stop offset="100%" stopColor="#E11D48" />
      </linearGradient>
    </defs>
    <rect width="48" height="48" rx="12" fill="url(#mk-bg)" />
    {/* Megaphone Body */}
    <path d="M14 21 L 22 17 L 22 31 L 14 27 Z" fill="url(#mk-coral)" />
    <rect x="11" y="21" width="3" height="6" rx="1" fill="#FDA4AF" />
    <path d="M16 27 L 18 34 L 20 34 L 18 27 Z" fill="#F43F5E" />
    {/* Sound Waves / Broadcast Arcs */}
    <path d="M26 19 C 28 22, 28 26, 26 29" stroke="#FECDD3" strokeWidth="2" strokeLinecap="round" />
    <path
      d="M30 16 C 34 20, 34 28, 30 32"
      stroke="#FDA4AF"
      strokeWidth="2.2"
      strokeLinecap="round"
    />
    <path
      d="M35 13 C 40 19, 40 29, 35 35"
      stroke="#F43F5E"
      strokeWidth="2"
      strokeLinecap="round"
      opacity="0.85"
    />
    {/* Pulse spark */}
    <circle cx="22" cy="24" r="2" fill="#FFFFFF" />
  </svg>
);

/** Presales Technical Consultant — Enterprise solution architecture constellation */
const PresalesConsultantArt: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 48 48" fill="none" className={cn('size-full', className)}>
    <defs>
      <linearGradient id="ps-bg" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#0369A1" />
        <stop offset="100%" stopColor="#082F49" />
      </linearGradient>
      <linearGradient id="ps-cyan" x1="12" y1="12" x2="36" y2="36" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#38BDF8" />
        <stop offset="100%" stopColor="#818CF8" />
      </linearGradient>
    </defs>
    <rect width="48" height="48" rx="12" fill="url(#ps-bg)" />
    {/* Architecture Screen/Canvas */}
    <rect
      x="12"
      y="12"
      width="24"
      height="18"
      rx="3"
      stroke="url(#ps-cyan)"
      strokeWidth="1.8"
      fill="rgba(56,189,248,0.12)"
    />
    {/* Stand */}
    <path
      d="M24 30 L 24 36 M 19 36 L 29 36"
      stroke="#38BDF8"
      strokeWidth="1.8"
      strokeLinecap="round"
    />
    {/* Constellation Nodes inside screen */}
    <circle cx="17" cy="18" r="2" fill="#38BDF8" />
    <circle cx="31" cy="18" r="2" fill="#38BDF8" />
    <circle cx="24" cy="24" r="2.4" fill="#FACC15" />
    <line x1="17" y1="18" x2="24" y2="24" stroke="rgba(255,255,255,0.4)" strokeWidth="1.2" />
    <line x1="31" y1="18" x2="24" y2="24" stroke="rgba(255,255,255,0.4)" strokeWidth="1.2" />
  </svg>
);

/** Daily Report Expert — Chrono timeline checklist with milestone nodes */
const DailyReportArt: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 48 48" fill="none" className={cn('size-full', className)}>
    <defs>
      <linearGradient id="dr-bg" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#0F766E" />
        <stop offset="100%" stopColor="#134E4A" />
      </linearGradient>
      <linearGradient id="dr-teal" x1="14" y1="12" x2="34" y2="36" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#2DD4BF" />
        <stop offset="100%" stopColor="#14B8A6" />
      </linearGradient>
    </defs>
    <rect width="48" height="48" rx="12" fill="url(#dr-bg)" />
    {/* Document / Clipboard Base */}
    <rect
      x="13"
      y="11"
      width="22"
      height="28"
      rx="3"
      fill="rgba(255,255,255,0.1)"
      stroke="url(#dr-teal)"
      strokeWidth="1.8"
    />
    {/* Clip at top */}
    <rect x="20" y="9" width="8" height="4" rx="1.5" fill="#5EEAD4" />
    {/* Checklist lines & checks */}
    <path
      d="M17 18 L 19 20 L 23 16"
      stroke="#5EEAD4"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <line
      x1="25"
      y1="18"
      x2="31"
      y2="18"
      stroke="#CCFBF1"
      strokeWidth="1.6"
      strokeLinecap="round"
    />
    <path
      d="M17 25 L 19 27 L 23 23"
      stroke="#5EEAD4"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <line
      x1="25"
      y1="25"
      x2="31"
      y2="25"
      stroke="#CCFBF1"
      strokeWidth="1.6"
      strokeLinecap="round"
    />
    <path
      d="M17 32 L 19 34 L 23 30"
      stroke="#5EEAD4"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <line
      x1="25"
      y1="32"
      x2="29"
      y2="32"
      stroke="#CCFBF1"
      strokeWidth="1.6"
      strokeLinecap="round"
    />
  </svg>
);

/**
 * Avatar art for the built-in preset experts, keyed by the preset name
 * (the machine id in zhiyuan-expert-manager/presets/{preset}/plugin.json).
 */
export const PRESET_EXPERT_AVATARS: Record<string, PresetExpertAvatarStyle> = {
  // CAD 工程专家 — precision technical isometric grid + calipers
  'cad-engineering-expert': {
    icon: DraftingCompass,
    background: tile('linear-gradient(135deg, oklch(0.62 0.11 235), oklch(0.45 0.12 250))'),
    Artwork: CadEngineerArt,
  },
  // 文案创作专家 — aerodynamic golden quill with narrative ribbon
  'content-writer': {
    icon: Feather,
    background: tile('linear-gradient(135deg, oklch(0.78 0.15 70), oklch(0.66 0.19 42))'),
    Artwork: ContentWriterArt,
  },
  // 数据分析专家 — 3D isometric ascending bar towers with glowing trend spline
  'data-analyst': {
    icon: ChartColumn,
    background: tile('linear-gradient(135deg, oklch(0.67 0.16 252), oklch(0.56 0.2 262))'),
    Artwork: DataAnalystArt,
  },
  // 日报专家 — chrono timeline checklist with milestone nodes
  'daily-report-expert': {
    icon: ClipboardCheck,
    background: tile('linear-gradient(135deg, oklch(0.7 0.13 190), oklch(0.56 0.14 205))'),
    Artwork: DailyReportArt,
  },
  // 股票研究专家 — financial candlestick chart with bullish surge spline
  'equity-research': {
    icon: TrendingUp,
    background: tile('linear-gradient(135deg, oklch(0.72 0.15 160), oklch(0.6 0.15 172))'),
    Artwork: EquityResearchArt,
  },
  // 财务会计专家 — dual-entry ledger balance crystal & audit cipher seal
  'finance-accounting-expert': {
    icon: Calculator,
    background: tile('linear-gradient(135deg, oklch(0.58 0.13 278), oklch(0.48 0.16 285))'),
    Artwork: FinanceAccountingArt,
  },
  // 营销战役专家 — megaphone broadcaster with expanding acoustic wavefronts
  'marketing-campaign-expert': {
    icon: Megaphone,
    background: tile('linear-gradient(135deg, oklch(0.72 0.17 30), oklch(0.62 0.21 15))'),
    Artwork: MarketingCampaignArt,
  },
  // 售前技术顾问 — enterprise solution architecture constellation
  'presales-technical-consultant': {
    icon: Presentation,
    background: tile('linear-gradient(135deg, oklch(0.72 0.12 215), oklch(0.62 0.14 225))'),
    Artwork: PresalesConsultantArt,
  },
  // React 开发专家 — atomic orbital rings with glowing nucleus & code brackets
  'react-dev': {
    icon: Atom,
    background: tile('linear-gradient(135deg, oklch(0.38 0.09 255), oklch(0.3 0.08 265))'),
    iconColor: 'oklch(0.88 0.11 210)',
    Artwork: ReactDevArt,
  },
};

export const CUSTOM_EXPERT_ICONS: Record<string, LucideIcon> = {
  brain: Brain,
  code: Code2,
  sparkles: Sparkles,
  rocket: Rocket,
  shield: Shield,
  bot: Bot,
  zap: Zap,
  chart: ChartColumn,
};

export const CUSTOM_EXPERT_GRADIENTS = [
  'linear-gradient(135deg, #3B82F6, #1D4ED8)',
  'linear-gradient(135deg, #10B981, #047857)',
  'linear-gradient(135deg, #8B5CF6, #6D28D9)',
  'linear-gradient(135deg, #F59E0B, #B45309)',
  'linear-gradient(135deg, #EC4899, #BE185D)',
  'linear-gradient(135deg, #06B6D4, #0E7490)',
  'linear-gradient(135deg, #6366F1, #4338CA)',
  'linear-gradient(135deg, #F43F5E, #BE123C)',
];

interface ExpertAvatarProps {
  /** Preset machine name (e.g. content-writer); selects the avatar art. */
  name: string;
  /** Localized display name, used for the fallback initial of unknown experts. */
  label: string;
  /** Optional icon identifier for custom experts, e.g. "brain", "code", "custom:brain:#3B82F6" */
  icon?: string;
  className?: string;
}

export function ExpertAvatar({ name, label, icon, className }: ExpertAvatarProps) {
  const style = PRESET_EXPERT_AVATARS[name];

  if (style) {
    if (style.Artwork) {
      const Artwork = style.Artwork;
      return (
        <div
          aria-label={label}
          className={cn(
            'size-10 shrink-0 overflow-hidden rounded-xl shadow-xs transition-transform select-none',
            className,
          )}
        >
          <Artwork />
        </div>
      );
    }

    const Icon = style.icon;
    return (
      <Avatar
        aria-hidden="true"
        className={cn('theme-scene-expert-avatar shrink-0 overflow-hidden after:hidden', className)}
        style={{ background: style.background }}
      >
        <AvatarFallback className="theme-scene-expert-artwork">
          <Icon
            aria-hidden="true"
            className="size-5"
            strokeWidth={2}
            style={{ color: style.iconColor ?? 'oklch(0.985 0 0)' }}
          />
        </AvatarFallback>
      </Avatar>
    );
  }

  // Handle custom expert icon config if passed
  const customIconName = icon?.startsWith('custom:') ? icon.split(':')[1] : icon;
  const customBg = icon?.startsWith('custom:')
    ? icon.split(':')[2] || CUSTOM_EXPERT_GRADIENTS[0]
    : CUSTOM_EXPERT_GRADIENTS[0];

  const CustomIcon = customIconName ? CUSTOM_EXPERT_ICONS[customIconName] : null;

  if (CustomIcon) {
    return (
      <Avatar
        aria-label={label}
        className={cn(
          'size-10 shrink-0 overflow-hidden rounded-xl after:hidden shadow-xs',
          className,
        )}
        style={{ background: customBg }}
      >
        <AvatarFallback className="flex size-full items-center justify-center bg-transparent text-white">
          <CustomIcon aria-hidden="true" className="size-5" strokeWidth={2} />
        </AvatarFallback>
      </Avatar>
    );
  }

  return (
    <Avatar
      className={cn(
        'theme-scene-expert-empty-avatar size-10 shrink-0 overflow-hidden rounded-xl after:hidden',
        className,
      )}
    >
      <AvatarFallback className="theme-scene-expert-fallback font-semibold">
        {label.slice(0, 1).toUpperCase()}
      </AvatarFallback>
    </Avatar>
  );
}
