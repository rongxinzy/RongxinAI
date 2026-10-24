import { Avatar, AvatarFallback } from '@shared/components/ui/avatar';
import { cn } from '@shared/lib/utils';
import {
  Atom,
  Calculator,
  ChartColumn,
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
  DraftingCompass,
  ClipboardCheck,
  Terminal,
  Palette,
  Database,
  Layers,
  Wrench,
  Microscope,
  BookOpen,
  Compass,
  Scale,
  Radar,
  Cloud,
  Cpu,
  Boxes,
  FileCode2,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import React from 'react';

export interface PresetExpertAvatarStyle {
  icon: LucideIcon;
  /** CSS background fallback (gradient tile). Decorative artwork, intentionally theme-independent. */
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
// Modern Quiet Studio 3D Bespoke Vector Artworks for Preset Experts
// ============================================================================

/** Data Analyst — 3D isometric crystal prism towers with glowing trend spline & depth grid */
const DataAnalystArt: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 48 48" fill="none" className={cn('size-full', className)}>
    <defs>
      <linearGradient id="da-bg" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#0B132B" />
        <stop offset="60%" stopColor="#0F172A" />
        <stop offset="100%" stopColor="#020617" />
      </linearGradient>
      <radialGradient id="da-amb" cx="24" cy="24" r="22" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#38BDF8" stopOpacity="0.28" />
        <stop offset="100%" stopColor="#38BDF8" stopOpacity="0" />
      </radialGradient>
      <linearGradient id="da-p1-top" x1="10" y1="23" x2="16" y2="25" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#67E8F9" />
        <stop offset="100%" stopColor="#38BDF8" />
      </linearGradient>
      <linearGradient
        id="da-p1-side"
        x1="13"
        y1="25"
        x2="16"
        y2="36"
        gradientUnits="userSpaceOnUse"
      >
        <stop offset="0%" stopColor="#0284C7" />
        <stop offset="100%" stopColor="#075985" />
      </linearGradient>
      <linearGradient id="da-p2-top" x1="18" y1="17" x2="24" y2="19" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#38BDF8" />
        <stop offset="100%" stopColor="#2563EB" />
      </linearGradient>
      <linearGradient
        id="da-p2-side"
        x1="21"
        y1="19"
        x2="24"
        y2="36"
        gradientUnits="userSpaceOnUse"
      >
        <stop offset="0%" stopColor="#1D4ED8" />
        <stop offset="100%" stopColor="#1E3A8A" />
      </linearGradient>
      <linearGradient id="da-p3-top" x1="26" y1="12" x2="32" y2="14" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#34D399" />
        <stop offset="100%" stopColor="#10B981" />
      </linearGradient>
      <linearGradient
        id="da-p3-side"
        x1="29"
        y1="14"
        x2="32"
        y2="36"
        gradientUnits="userSpaceOnUse"
      >
        <stop offset="0%" stopColor="#059669" />
        <stop offset="100%" stopColor="#064E3B" />
      </linearGradient>
      <linearGradient id="da-spline" x1="8" y1="30" x2="38" y2="12" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#38BDF8" />
        <stop offset="50%" stopColor="#67E8F9" />
        <stop offset="100%" stopColor="#FDE047" />
      </linearGradient>
      <filter id="da-glow" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="1.6" result="blur" />
        <feComposite in="SourceGraphic" in2="blur" operator="over" />
      </filter>
    </defs>
    <rect width="48" height="48" rx="12" fill="url(#da-bg)" />
    <rect width="48" height="48" rx="12" fill="url(#da-amb)" />
    {/* Specular top rim light */}
    <line x1="6" y1="1.5" x2="42" y2="1.5" stroke="rgba(255,255,255,0.2)" strokeLinecap="round" />
    {/* Grid Horizon */}
    <path d="M7 36 L41 36" stroke="rgba(255,255,255,0.12)" strokeWidth="1" strokeDasharray="2 2" />
    <path d="M10 39 L38 39" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
    {/* 3D Prism Column 1 */}
    <path d="M10 25 L13 23 L16 24.5 L13 26.5 Z" fill="url(#da-p1-top)" />
    <path d="M10 25 L13 26.5 L13 36 L10 34.5 Z" fill="#0369A1" />
    <path d="M13 26.5 L16 24.5 L16 34 L13 36 Z" fill="url(#da-p1-side)" />
    {/* 3D Prism Column 2 */}
    <path d="M18 19 L21 17 L24 18.5 L21 20.5 Z" fill="url(#da-p2-top)" />
    <path d="M18 19 L21 20.5 L21 36 L18 34.5 Z" fill="#1E40AF" />
    <path d="M21 20.5 L24 18.5 L24 34 L21 36 Z" fill="url(#da-p2-side)" />
    {/* 3D Prism Column 3 */}
    <path d="M26 14 L29 12 L32 13.5 L29 15.5 Z" fill="url(#da-p3-top)" />
    <path d="M26 14 L29 15.5 L29 36 L26 34.5 Z" fill="#047857" />
    <path d="M29 15.5 L32 13.5 L32 34 L29 36 Z" fill="url(#da-p3-side)" />
    {/* Glowing Trend Spline */}
    <path
      d="M8 30 C 13 27, 17 21, 21 19 C 25 17, 27 15, 37 11"
      stroke="url(#da-spline)"
      strokeWidth="2.2"
      strokeLinecap="round"
      filter="url(#da-glow)"
    />
    <circle cx="21" cy="19" r="1.8" fill="#FFFFFF" />
    <circle cx="37" cy="11" r="2.8" fill="#FDE047" filter="url(#da-glow)" />
    <circle cx="37" cy="11" r="1.3" fill="#FFFFFF" />
  </svg>
);

/** React Dev — 3D Torus orbital rings with glowing nucleus & code brackets */
const ReactDevArt: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 48 48" fill="none" className={cn('size-full', className)}>
    <defs>
      <linearGradient id="rd-bg" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#0B132B" />
        <stop offset="50%" stopColor="#091E3A" />
        <stop offset="100%" stopColor="#020617" />
      </linearGradient>
      <radialGradient id="rd-amb" cx="24" cy="24" r="20" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#0284C7" stopOpacity="0.32" />
        <stop offset="100%" stopColor="#0284C7" stopOpacity="0" />
      </radialGradient>
      <linearGradient id="rd-ring1" x1="10" y1="14" x2="38" y2="34" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#38BDF8" />
        <stop offset="100%" stopColor="#0284C7" />
      </linearGradient>
      <linearGradient id="rd-ring2" x1="12" y1="12" x2="36" y2="36" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#67E8F9" />
        <stop offset="100%" stopColor="#3B82F6" />
      </linearGradient>
      <filter id="rd-glow" x="-25%" y="-25%" width="150%" height="150%">
        <feGaussianBlur stdDeviation="1.6" result="blur" />
        <feComposite in="SourceGraphic" in2="blur" operator="over" />
      </filter>
    </defs>
    <rect width="48" height="48" rx="12" fill="url(#rd-bg)" />
    <rect width="48" height="48" rx="12" fill="url(#rd-amb)" />
    <line x1="6" y1="1.5" x2="42" y2="1.5" stroke="rgba(255,255,255,0.22)" strokeLinecap="round" />
    {/* 3D Depth Orbitals */}
    <ellipse
      cx="24"
      cy="24"
      rx="15"
      ry="5.8"
      stroke="url(#rd-ring1)"
      strokeWidth="1.6"
      strokeOpacity="0.85"
    />
    <ellipse
      cx="24"
      cy="24"
      rx="15"
      ry="5.8"
      transform="rotate(60 24 24)"
      stroke="url(#rd-ring2)"
      strokeWidth="1.6"
      strokeOpacity="0.85"
    />
    <ellipse
      cx="24"
      cy="24"
      rx="15"
      ry="5.8"
      transform="rotate(120 24 24)"
      stroke="url(#rd-ring1)"
      strokeWidth="1.6"
      strokeOpacity="0.85"
    />
    {/* Core Quantum Nucleus */}
    <circle cx="24" cy="24" r="3.8" fill="#38BDF8" filter="url(#rd-glow)" />
    <circle cx="24" cy="24" r="1.8" fill="#FFFFFF" />
    {/* Floating Subtly Lit Brackets */}
    <path
      d="M15 20.5 L12 24 L15 27.5"
      stroke="#67E8F9"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      opacity="0.8"
    />
    <path
      d="M33 20.5 L36 24 L33 27.5"
      stroke="#67E8F9"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      opacity="0.8"
    />
  </svg>
);

/** Content Writer — 3D Sculpted Golden Quill Nib with fluid narrative ribbon */
const ContentWriterArt: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 48 48" fill="none" className={cn('size-full', className)}>
    <defs>
      <linearGradient id="cw-bg" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#291206" />
        <stop offset="60%" stopColor="#1C1917" />
        <stop offset="100%" stopColor="#0C0A09" />
      </linearGradient>
      <radialGradient id="cw-amb" cx="24" cy="22" r="20" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#F59E0B" stopOpacity="0.25" />
        <stop offset="100%" stopColor="#F59E0B" stopOpacity="0" />
      </radialGradient>
      <linearGradient id="cw-gold" x1="16" y1="10" x2="36" y2="36" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#FEF08A" />
        <stop offset="40%" stopColor="#F59E0B" />
        <stop offset="100%" stopColor="#B45309" />
      </linearGradient>
      <linearGradient id="cw-ribbon" x1="8" y1="26" x2="38" y2="34" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#FDE047" stopOpacity="0.15" />
        <stop offset="50%" stopColor="#F59E0B" stopOpacity="0.85" />
        <stop offset="100%" stopColor="#D97706" stopOpacity="0.2" />
      </linearGradient>
      <filter id="cw-glow" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="1.4" result="blur" />
        <feComposite in="SourceGraphic" in2="blur" operator="over" />
      </filter>
    </defs>
    <rect width="48" height="48" rx="12" fill="url(#cw-bg)" />
    <rect width="48" height="48" rx="12" fill="url(#cw-amb)" />
    <line x1="6" y1="1.5" x2="42" y2="1.5" stroke="rgba(255,255,255,0.2)" strokeLinecap="round" />
    {/* Flowing Narrative Wave */}
    <path
      d="M9 33 C 15 36, 21 28, 27 32 C 32 35, 36 33, 39 29"
      stroke="url(#cw-ribbon)"
      strokeWidth="2.4"
      strokeLinecap="round"
    />
    {/* Sculpted 3D Quill Nib */}
    <path
      d="M33 11 C 31 16, 27 21, 23 26 C 21 28, 18 31, 15 33 L 14 34 L 16 31 C 18 28, 22 25, 25 21 C 29 16, 32 12, 33 11 Z"
      fill="url(#cw-gold)"
      filter="url(#cw-glow)"
    />
    {/* Nib Slit & Breather Hole */}
    <path d="M14 34 L 20 28" stroke="#78350F" strokeWidth="1" strokeLinecap="round" />
    <circle cx="21" cy="27" r="1.1" fill="#FEF08A" />
    {/* Floating Inspiration Sparks */}
    <circle cx="34" cy="11" r="1.5" fill="#FEF08A" filter="url(#cw-glow)" />
    <circle cx="13" cy="35" r="1.2" fill="#FDE047" />
    <path
      d="M30 18 L 32 16"
      stroke="#FEF08A"
      strokeWidth="1.2"
      strokeLinecap="round"
      opacity="0.7"
    />
  </svg>
);

/** CAD Engineering Expert — 3D Isometric Precision Wireframe Cube with Compass Caliper */
const CadEngineerArt: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 48 48" fill="none" className={cn('size-full', className)}>
    <defs>
      <linearGradient id="cad-bg" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#0B132B" />
        <stop offset="60%" stopColor="#0F172A" />
        <stop offset="100%" stopColor="#020617" />
      </linearGradient>
      <radialGradient id="cad-amb" cx="24" cy="24" r="20" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#38BDF8" stopOpacity="0.22" />
        <stop offset="100%" stopColor="#38BDF8" stopOpacity="0" />
      </radialGradient>
      <linearGradient id="cad-steel" x1="12" y1="12" x2="36" y2="36" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#38BDF8" />
        <stop offset="100%" stopColor="#818CF8" />
      </linearGradient>
    </defs>
    <rect width="48" height="48" rx="12" fill="url(#cad-bg)" />
    <rect width="48" height="48" rx="12" fill="url(#cad-amb)" />
    <line x1="6" y1="1.5" x2="42" y2="1.5" stroke="rgba(255,255,255,0.2)" strokeLinecap="round" />
    {/* Blueprint Coordinate Crosshairs */}
    <line x1="8" y1="24" x2="40" y2="24" stroke="rgba(255,255,255,0.08)" strokeDasharray="2 2" />
    <line x1="24" y1="8" x2="24" y2="40" stroke="rgba(255,255,255,0.08)" strokeDasharray="2 2" />
    {/* 3D Isometric Cube Faces */}
    <path
      d="M24 12 L36 19 L24 26 L12 19 Z"
      stroke="url(#cad-steel)"
      strokeWidth="1.6"
      strokeLinejoin="round"
      fill="rgba(56,189,248,0.12)"
    />
    <path
      d="M12 19 L12 31 L24 38 L24 26 Z"
      stroke="url(#cad-steel)"
      strokeWidth="1.6"
      strokeLinejoin="round"
      fill="rgba(56,189,248,0.18)"
    />
    <path
      d="M36 19 L36 31 L24 38 L24 26 Z"
      stroke="url(#cad-steel)"
      strokeWidth="1.6"
      strokeLinejoin="round"
      fill="rgba(129,140,248,0.22)"
    />
    {/* Compass Pivot & Caliper Legs */}
    <circle cx="24" cy="18" r="2.4" fill="#38BDF8" />
    <circle cx="24" cy="18" r="1.2" fill="#FFFFFF" />
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

/** Equity Research — 3D Emerald Candlestick Crystal Columns with Bullish Surge */
const EquityResearchArt: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 48 48" fill="none" className={cn('size-full', className)}>
    <defs>
      <linearGradient id="eq-bg" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#042F2E" />
        <stop offset="60%" stopColor="#064E3B" />
        <stop offset="100%" stopColor="#022C22" />
      </linearGradient>
      <radialGradient id="eq-amb" cx="24" cy="24" r="20" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#10B981" stopOpacity="0.28" />
        <stop offset="100%" stopColor="#10B981" stopOpacity="0" />
      </radialGradient>
      <linearGradient id="eq-surge" x1="8" y1="34" x2="38" y2="12" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#34D399" />
        <stop offset="70%" stopColor="#6EE7B7" />
        <stop offset="100%" stopColor="#FDE047" />
      </linearGradient>
      <filter id="eq-glow" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="1.5" result="blur" />
        <feComposite in="SourceGraphic" in2="blur" operator="over" />
      </filter>
    </defs>
    <rect width="48" height="48" rx="12" fill="url(#eq-bg)" />
    <rect width="48" height="48" rx="12" fill="url(#eq-amb)" />
    <line x1="6" y1="1.5" x2="42" y2="1.5" stroke="rgba(255,255,255,0.22)" strokeLinecap="round" />
    {/* Grid Base */}
    <line
      x1="8"
      y1="36"
      x2="40"
      y2="36"
      stroke="rgba(255,255,255,0.12)"
      strokeWidth="1"
      strokeDasharray="2 2"
    />
    {/* 3D Candlestick 1 */}
    <line
      x1="14"
      y1="23"
      x2="14"
      y2="33"
      stroke="#34D399"
      strokeWidth="1.2"
      strokeLinecap="round"
    />
    <rect x="12" y="25" width="4" height="6" rx="1" fill="#10B981" />
    {/* 3D Candlestick 2 */}
    <line
      x1="22"
      y1="18"
      x2="22"
      y2="30"
      stroke="#34D399"
      strokeWidth="1.2"
      strokeLinecap="round"
    />
    <rect x="20" y="20" width="4" height="8" rx="1" fill="#10B981" />
    {/* 3D Candlestick 3 */}
    <line
      x1="30"
      y1="12"
      x2="30"
      y2="25"
      stroke="#34D399"
      strokeWidth="1.2"
      strokeLinecap="round"
    />
    <rect x="28" y="14" width="4" height="9" rx="1" fill="#34D399" />
    {/* Exponential Bullish Surge Curve */}
    <path
      d="M9 33 Q 22 28 36 12"
      stroke="url(#eq-surge)"
      strokeWidth="2.4"
      strokeLinecap="round"
      filter="url(#eq-glow)"
    />
    <circle cx="36" cy="12" r="2.8" fill="#FACC15" filter="url(#eq-glow)" />
    <circle cx="36" cy="12" r="1.3" fill="#FFFFFF" />
  </svg>
);

/** Finance & Accounting — Modern Geometric 3D Scales of Equilibrium & Asset Seals */
const FinanceAccountingArt: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 48 48" fill="none" className={cn('size-full', className)}>
    <defs>
      <linearGradient id="fa-bg" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#1E1B4B" />
        <stop offset="60%" stopColor="#2E1065" />
        <stop offset="100%" stopColor="#0F172A" />
      </linearGradient>
      <radialGradient id="fa-amb" cx="24" cy="22" r="20" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#A855F7" stopOpacity="0.25" />
        <stop offset="100%" stopColor="#A855F7" stopOpacity="0" />
      </radialGradient>
      <linearGradient id="fa-gold" x1="12" y1="12" x2="36" y2="34" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#FDE047" />
        <stop offset="50%" stopColor="#F59E0B" />
        <stop offset="100%" stopColor="#D97706" />
      </linearGradient>
    </defs>
    <rect width="48" height="48" rx="12" fill="url(#fa-bg)" />
    <rect width="48" height="48" rx="12" fill="url(#fa-amb)" />
    <line x1="6" y1="1.5" x2="42" y2="1.5" stroke="rgba(255,255,255,0.2)" strokeLinecap="round" />
    {/* Center Balance Column */}
    <line
      x1="24"
      y1="13"
      x2="24"
      y2="35"
      stroke="url(#fa-gold)"
      strokeWidth="2.2"
      strokeLinecap="round"
    />
    <line
      x1="19"
      y1="35"
      x2="29"
      y2="35"
      stroke="url(#fa-gold)"
      strokeWidth="2.4"
      strokeLinecap="round"
    />
    {/* Balance Beam */}
    <path d="M11 18 L 37 18" stroke="url(#fa-gold)" strokeWidth="2.2" strokeLinecap="round" />
    <circle cx="24" cy="18" r="2.8" fill="#FEF08A" />
    {/* Left Equilibrium Pan */}
    <line x1="13" y1="18" x2="10.5" y2="26" stroke="rgba(255,255,255,0.45)" strokeWidth="1.2" />
    <line x1="13" y1="18" x2="15.5" y2="26" stroke="rgba(255,255,255,0.45)" strokeWidth="1.2" />
    <path d="M9 26 Q 13 31 17 26 Z" fill="#818CF8" />
    <circle cx="13" cy="24.5" r="1.4" fill="#FDE047" />
    {/* Right Equilibrium Pan */}
    <line x1="35" y1="18" x2="32.5" y2="26" stroke="rgba(255,255,255,0.45)" strokeWidth="1.2" />
    <line x1="35" y1="18" x2="37.5" y2="26" stroke="rgba(255,255,255,0.45)" strokeWidth="1.2" />
    <path d="M31 26 Q 35 31 39 26 Z" fill="#818CF8" />
    <circle cx="35" cy="24.5" r="1.4" fill="#FDE047" />
  </svg>
);

/** Marketing Campaign Expert — 3D Harmonic Mega-Broadcaster with Acoustic Wavefronts */
const MarketingCampaignArt: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 48 48" fill="none" className={cn('size-full', className)}>
    <defs>
      <linearGradient id="mk-bg" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#4C0519" />
        <stop offset="60%" stopColor="#881337" />
        <stop offset="100%" stopColor="#1C1917" />
      </linearGradient>
      <radialGradient id="mk-amb" cx="24" cy="24" r="20" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#F43F5E" stopOpacity="0.3" />
        <stop offset="100%" stopColor="#F43F5E" stopOpacity="0" />
      </radialGradient>
      <linearGradient id="mk-coral" x1="12" y1="14" x2="34" y2="34" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#FDA4AF" />
        <stop offset="40%" stopColor="#F43F5E" />
        <stop offset="100%" stopColor="#BE123C" />
      </linearGradient>
      <filter id="mk-glow" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="1.5" result="blur" />
        <feComposite in="SourceGraphic" in2="blur" operator="over" />
      </filter>
    </defs>
    <rect width="48" height="48" rx="12" fill="url(#mk-bg)" />
    <rect width="48" height="48" rx="12" fill="url(#mk-amb)" />
    <line x1="6" y1="1.5" x2="42" y2="1.5" stroke="rgba(255,255,255,0.22)" strokeLinecap="round" />
    {/* Megaphone Cone Body */}
    <path d="M14 20.5 L 23 16 L 23 32 L 14 27.5 Z" fill="url(#mk-coral)" />
    <rect x="11" y="20.5" width="3.5" height="7" rx="1.2" fill="#FECDD3" />
    <path d="M16 27.5 L 18 34.5 L 20.5 34.5 L 18.5 27.5 Z" fill="#9F1239" />
    {/* Broadcaster Acoustic Wavefront Arcs */}
    <path
      d="M27 18.5 C 29.5 22, 29.5 26, 27 29.5"
      stroke="#FECDD3"
      strokeWidth="2.2"
      strokeLinecap="round"
      filter="url(#mk-glow)"
    />
    <path
      d="M31.5 15.5 C 36 20, 36 28, 31.5 32.5"
      stroke="#FDA4AF"
      strokeWidth="2.2"
      strokeLinecap="round"
    />
    <path
      d="M36 13 C 41.5 19, 41.5 29, 36 35"
      stroke="#F43F5E"
      strokeWidth="2"
      strokeLinecap="round"
      opacity="0.8"
    />
    {/* Pulse spark */}
    <circle cx="23" cy="24" r="2.2" fill="#FFFFFF" filter="url(#mk-glow)" />
  </svg>
);

/** Presales Technical Consultant — 3D Architecture Hologram Display with Constellation Network */
const PresalesConsultantArt: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 48 48" fill="none" className={cn('size-full', className)}>
    <defs>
      <linearGradient id="ps-bg" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#082F49" />
        <stop offset="60%" stopColor="#0369A1" />
        <stop offset="100%" stopColor="#0B132B" />
      </linearGradient>
      <radialGradient id="ps-amb" cx="24" cy="24" r="20" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#38BDF8" stopOpacity="0.32" />
        <stop offset="100%" stopColor="#38BDF8" stopOpacity="0" />
      </radialGradient>
      <linearGradient id="ps-cyan" x1="12" y1="12" x2="36" y2="36" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#38BDF8" />
        <stop offset="100%" stopColor="#818CF8" />
      </linearGradient>
    </defs>
    <rect width="48" height="48" rx="12" fill="url(#ps-bg)" />
    <rect width="48" height="48" rx="12" fill="url(#ps-amb)" />
    <line x1="6" y1="1.5" x2="42" y2="1.5" stroke="rgba(255,255,255,0.22)" strokeLinecap="round" />
    {/* 3D Slanted Holographic Canvas Frame */}
    <rect
      x="11"
      y="11"
      width="26"
      height="20"
      rx="3.5"
      stroke="url(#ps-cyan)"
      strokeWidth="1.8"
      fill="rgba(56,189,248,0.12)"
    />
    {/* Base Stand */}
    <path
      d="M24 31 L 24 37 M 18 37 L 30 37"
      stroke="#38BDF8"
      strokeWidth="1.8"
      strokeLinecap="round"
    />
    {/* Network Constellation Nodes inside Frame */}
    <circle cx="17" cy="17" r="2.2" fill="#38BDF8" />
    <circle cx="31" cy="17" r="2.2" fill="#38BDF8" />
    <circle cx="24" cy="24" r="2.6" fill="#FACC15" />
    <circle cx="24" cy="24" r="1.3" fill="#FFFFFF" />
    <line x1="17" y1="17" x2="24" y2="24" stroke="rgba(255,255,255,0.5)" strokeWidth="1.2" />
    <line x1="31" y1="17" x2="24" y2="24" stroke="rgba(255,255,255,0.5)" strokeWidth="1.2" />
    <line
      x1="17"
      y1="17"
      x2="31"
      y2="17"
      stroke="rgba(56,189,248,0.3)"
      strokeWidth="1"
      strokeDasharray="2 2"
    />
  </svg>
);

/** Daily Report Expert — 3D Precision Chrono Timeline Dial with Delivered Milestones */
const DailyReportArt: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 48 48" fill="none" className={cn('size-full', className)}>
    <defs>
      <linearGradient id="dr-bg" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#134E4A" />
        <stop offset="60%" stopColor="#0F766E" />
        <stop offset="100%" stopColor="#042F2E" />
      </linearGradient>
      <radialGradient id="dr-amb" cx="24" cy="24" r="20" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#2DD4BF" stopOpacity="0.28" />
        <stop offset="100%" stopColor="#2DD4BF" stopOpacity="0" />
      </radialGradient>
      <linearGradient id="dr-teal" x1="12" y1="12" x2="36" y2="36" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#5EEAD4" />
        <stop offset="100%" stopColor="#0D9488" />
      </linearGradient>
    </defs>
    <rect width="48" height="48" rx="12" fill="url(#dr-bg)" />
    <rect width="48" height="48" rx="12" fill="url(#dr-amb)" />
    <line x1="6" y1="1.5" x2="42" y2="1.5" stroke="rgba(255,255,255,0.22)" strokeLinecap="round" />
    {/* Chrono Dial Bezel */}
    <circle
      cx="24"
      cy="24"
      r="14.5"
      stroke="url(#dr-teal)"
      strokeWidth="1.8"
      strokeOpacity="0.85"
    />
    <circle cx="24" cy="24" r="11" fill="rgba(20,184,166,0.12)" />
    {/* Milestone Track Nodes */}
    <circle cx="24" cy="14" r="1.8" fill="#FACC15" />
    <circle cx="34" cy="24" r="1.8" fill="#2DD4BF" />
    <circle cx="24" cy="34" r="1.8" fill="#2DD4BF" />
    <circle cx="14" cy="24" r="1.8" fill="#2DD4BF" />
    {/* Active Milestone Checkmark Hand */}
    <path
      d="M18.5 24 L22.5 28 L29.5 20"
      stroke="#FFFFFF"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

// ============================================================================
// Preset Expert Styles Registry
// ============================================================================

export const PRESET_EXPERT_AVATARS: Record<string, PresetExpertAvatarStyle> = {
  // CAD 工程专家
  'cad-engineering-expert': {
    icon: DraftingCompass,
    background: tile('linear-gradient(135deg, oklch(0.35 0.08 245), oklch(0.24 0.07 255))'),
    iconColor: 'oklch(0.85 0.1 230)',
    Artwork: CadEngineerArt,
  },
  // 内容创作专家
  'content-writer': {
    icon: Feather,
    background: tile('linear-gradient(135deg, oklch(0.48 0.14 75), oklch(0.36 0.11 65))'),
    Artwork: ContentWriterArt,
  },
  // 日报周报专家
  'daily-report-expert': {
    icon: ClipboardCheck,
    background: tile('linear-gradient(135deg, oklch(0.44 0.11 178), oklch(0.32 0.09 185))'),
    Artwork: DailyReportArt,
  },
  // 数据分析专家
  'data-analyst': {
    icon: ChartColumn,
    background: tile('linear-gradient(135deg, oklch(0.42 0.13 245), oklch(0.28 0.1 255))'),
    Artwork: DataAnalystArt,
  },
  // 行业与证券研报专家
  'equity-research': {
    icon: TrendingUp,
    background: tile('linear-gradient(135deg, oklch(0.42 0.12 155), oklch(0.3 0.1 165))'),
    Artwork: EquityResearchArt,
  },
  // 财务会计专家
  'finance-accounting-expert': {
    icon: Calculator,
    background: tile('linear-gradient(135deg, oklch(0.44 0.12 285), oklch(0.32 0.1 295))'),
    Artwork: FinanceAccountingArt,
  },
  // 营销战役专家
  'marketing-campaign-expert': {
    icon: Megaphone,
    background: tile('linear-gradient(135deg, oklch(0.48 0.16 25), oklch(0.36 0.14 15))'),
    Artwork: MarketingCampaignArt,
  },
  // 售前技术顾问
  'presales-technical-consultant': {
    icon: Presentation,
    background: tile('linear-gradient(135deg, oklch(0.44 0.11 220), oklch(0.32 0.09 230))'),
    Artwork: PresalesConsultantArt,
  },
  // React 开发专家
  'react-dev': {
    icon: Atom,
    background: tile('linear-gradient(135deg, oklch(0.38 0.09 255), oklch(0.26 0.08 265))'),
    iconColor: 'oklch(0.88 0.11 210)',
    Artwork: ReactDevArt,
  },
  'python-fullstack-dev': {
    icon: Terminal,
    background: tile('linear-gradient(135deg, oklch(0.4 0.1 155), oklch(0.28 0.08 165))'),
  },
  'presentation-designer': {
    icon: Presentation,
    background: tile('linear-gradient(135deg, oklch(0.46 0.14 35), oklch(0.34 0.12 25))'),
  },
  'deep-research-analyst': {
    icon: Microscope,
    background: tile('linear-gradient(135deg, oklch(0.42 0.11 250), oklch(0.3 0.09 260))'),
  },
  'process-automation-expert': {
    icon: Zap,
    background: tile('linear-gradient(135deg, oklch(0.45 0.13 85), oklch(0.32 0.1 75))'),
  },
  'document-engineering-expert': {
    icon: FileCode2,
    background: tile('linear-gradient(135deg, oklch(0.44 0.08 210), oklch(0.32 0.07 220))'),
  },
  'local-inference-guide': {
    icon: Cpu,
    background: tile('linear-gradient(135deg, oklch(0.4 0.09 290), oklch(0.28 0.08 300))'),
  },
  'product-requirements-expert': {
    icon: Compass,
    background: tile('linear-gradient(135deg, oklch(0.46 0.12 55), oklch(0.34 0.1 45))'),
  },
  'devops-sre-expert': {
    icon: Cloud,
    background: tile('linear-gradient(135deg, oklch(0.42 0.1 230), oklch(0.3 0.08 240))'),
  },
  'academic-writing-expert': {
    icon: BookOpen,
    background: tile('linear-gradient(135deg, oklch(0.44 0.09 25), oklch(0.32 0.08 15))'),
  },
};

// ============================================================================
// Rich Modern Custom Expert Icons & Palettes
// ============================================================================

export const CUSTOM_EXPERT_ICONS: Record<string, LucideIcon> = {
  code: Code2,
  terminal: Terminal,
  fileCode: FileCode2,
  cpu: Cpu,
  brain: Brain,
  sparkles: Sparkles,
  palette: Palette,
  layers: Layers,
  chart: ChartColumn,
  database: Database,
  boxes: Boxes,
  radar: Radar,
  scale: Scale,
  wrench: Wrench,
  microscope: Microscope,
  bookOpen: BookOpen,
  compass: Compass,
  rocket: Rocket,
  shield: Shield,
  bot: Bot,
  zap: Zap,
  cloud: Cloud,
};

export const CUSTOM_EXPERT_GRADIENTS = [
  // Titanium Slate
  'linear-gradient(135deg, #334155, #0F172A)',
  // Electric Violet
  'linear-gradient(135deg, #7C3AED, #4C1D95)',
  // Ocean Sapphire
  'linear-gradient(135deg, #2563EB, #1E3A8A)',
  // Cyber Cyan
  'linear-gradient(135deg, #0284C7, #0369A1)',
  // Emerald Depth
  'linear-gradient(135deg, #059669, #064E3B)',
  // Amber Flame
  'linear-gradient(135deg, #D97706, #78350F)',
  // Sunset Coral
  'linear-gradient(135deg, #E11D48, #881337)',
  // Midnight Indigo
  'linear-gradient(135deg, #4F46E5, #312E81)',
  // Teal Matrix
  'linear-gradient(135deg, #0D9488, #134E4A)',
  // Magenta Neon
  'linear-gradient(135deg, #C026D3, #701A75)',
  // Royal Cobalt
  'linear-gradient(135deg, #1D4ED8, #0B132B)',
  // Deep Forest
  'linear-gradient(135deg, #15803D, #14532D)',
  // Warm Terracotta
  'linear-gradient(135deg, #EA580C, #9A3412)',
  // Deep Ruby
  'linear-gradient(135deg, #BE123C, #4C0519)',
  // Aurora Obsidian
  'linear-gradient(135deg, #1E293B, #020617)',
  // Golden Sand
  'linear-gradient(135deg, #CA8A04, #713F12)',
];

export interface ExpertAvatarProps {
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
          'size-10 shrink-0 overflow-hidden rounded-xl after:hidden shadow-xs ring-1 ring-white/10',
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
