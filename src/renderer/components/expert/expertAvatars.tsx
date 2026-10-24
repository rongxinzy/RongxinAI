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

import { CUSTOM_EXPERT_GRADIENTS, CuteCustomExpertArt } from './cuteCustomExpertArtworks';
import {
  CadEngineerArt,
  ContentWriterArt,
  DailyReportArt,
  DataAnalystArt,
  EquityResearchArt,
  FinanceAccountingArt,
  MarketingCampaignArt,
  PresalesConsultantArt,
  ReactDevArt,
} from './cuteExpertArtworks';

export { CUSTOM_EXPERT_GRADIENTS };

export interface PresetExpertAvatarStyle {
  icon: LucideIcon;
  /** Legacy gradient fallback when Artwork is absent; kept for tests and theme hooks. */
  background: string;
  iconColor?: string;
  Artwork?: React.FC<{ className?: string }>;
}

const PASTEL_TILE = 'linear-gradient(135deg, oklch(0.94 0.03 250), oklch(0.9 0.04 240))';

export const PRESET_EXPERT_AVATARS: Record<string, PresetExpertAvatarStyle> = {
  'cad-engineering-expert': {
    icon: DraftingCompass,
    background: PASTEL_TILE,
    iconColor: 'oklch(0.45 0.08 245)',
    Artwork: CadEngineerArt,
  },
  'content-writer': {
    icon: Feather,
    background: PASTEL_TILE,
    iconColor: 'oklch(0.48 0.1 75)',
    Artwork: ContentWriterArt,
  },
  'daily-report-expert': {
    icon: ClipboardCheck,
    background: PASTEL_TILE,
    iconColor: 'oklch(0.45 0.09 165)',
    Artwork: DailyReportArt,
  },
  'data-analyst': {
    icon: ChartColumn,
    background: PASTEL_TILE,
    iconColor: 'oklch(0.45 0.1 245)',
    Artwork: DataAnalystArt,
  },
  'equity-research': {
    icon: TrendingUp,
    background: PASTEL_TILE,
    iconColor: 'oklch(0.45 0.1 155)',
    Artwork: EquityResearchArt,
  },
  'finance-accounting-expert': {
    icon: Calculator,
    background: PASTEL_TILE,
    iconColor: 'oklch(0.45 0.1 285)',
    Artwork: FinanceAccountingArt,
  },
  'marketing-campaign-expert': {
    icon: Megaphone,
    background: PASTEL_TILE,
    iconColor: 'oklch(0.5 0.12 25)',
    Artwork: MarketingCampaignArt,
  },
  'presales-technical-consultant': {
    icon: Presentation,
    background: PASTEL_TILE,
    iconColor: 'oklch(0.45 0.09 220)',
    Artwork: PresalesConsultantArt,
  },
  'react-dev': {
    icon: Atom,
    background: PASTEL_TILE,
    iconColor: 'oklch(0.45 0.09 255)',
    Artwork: ReactDevArt,
  },
};

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

export interface ExpertAvatarProps {
  name: string;
  label: string;
  icon?: string;
  className?: string;
}

export function ExpertAvatar({ name, label, icon, className }: ExpertAvatarProps) {
  const style = PRESET_EXPERT_AVATARS[name];

  if (style?.Artwork) {
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

  if (style) {
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
            style={{ color: style.iconColor ?? 'oklch(0.45 0.08 250)' }}
          />
        </AvatarFallback>
      </Avatar>
    );
  }

  const customIconName = icon?.startsWith('custom:') ? icon.split(':')[1] : icon;

  if (customIconName && CUSTOM_EXPERT_ICONS[customIconName]) {
    return (
      <div
        aria-label={label}
        className={cn(
          'size-10 shrink-0 overflow-hidden rounded-xl shadow-xs select-none',
          className,
        )}
      >
        <CuteCustomExpertArt iconKey={customIconName} />
      </div>
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
