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
  MoonStar,
  Presentation,
  TrendingUp,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface PresetExpertAvatarStyle {
  icon: LucideIcon;
  /** CSS background (gradient tile). Decorative artwork, intentionally theme-independent. */
  background: string;
  /** Icon stroke color; defaults to white. */
  iconColor?: string;
}

/** Soft top-left sheen layered over every tile so avatars read as lit, flat artwork. */
const TILE_SHEEN =
  'radial-gradient(120% 120% at 18% 12%, rgb(255 255 255 / 0.22), rgb(255 255 255 / 0) 48%)';

const tile = (gradient: string) => `${TILE_SHEEN}, ${gradient}`;

/**
 * Avatar art for the built-in preset experts, keyed by the preset name
 * (the machine id in zhiyuan-expert-manager/presets/{preset}/plugin.json).
 *
 * Each preset gets a distinct hue + profession icon so the expert cards on the
 * Experts page are recognizable at a glance. Unknown presets fall back to the
 * initial-letter avatar rendered by {@link ExpertAvatar}.
 */
export const PRESET_EXPERT_AVATARS: Record<string, PresetExpertAvatarStyle> = {
  // CAD 工程专家 — drafting compass on steel blue
  'cad-engineering-expert': {
    icon: DraftingCompass,
    background: tile('linear-gradient(135deg, oklch(0.62 0.11 235), oklch(0.45 0.12 250))'),
  },
  // 文案创作专家 — quill on warm amber
  'content-writer': {
    icon: Feather,
    background: tile('linear-gradient(135deg, oklch(0.78 0.15 70), oklch(0.66 0.19 42))'),
  },
  // 数据分析专家 — bar chart on blue
  'data-analyst': {
    icon: ChartColumn,
    background: tile('linear-gradient(135deg, oklch(0.67 0.16 252), oklch(0.56 0.2 262))'),
  },
  // 日报专家 — checklist on teal
  'daily-report-expert': {
    icon: ClipboardCheck,
    background: tile('linear-gradient(135deg, oklch(0.7 0.13 190), oklch(0.56 0.14 205))'),
  },
  // 股票研究专家 — trend line on emerald
  'equity-research': {
    icon: TrendingUp,
    background: tile('linear-gradient(135deg, oklch(0.72 0.15 160), oklch(0.6 0.15 172))'),
  },
  // 财务会计专家 — calculator on deep indigo
  'finance-accounting-expert': {
    icon: Calculator,
    background: tile('linear-gradient(135deg, oklch(0.58 0.13 278), oklch(0.48 0.16 285))'),
  },
  // 传统命理顾问 — moon & star on violet
  'fortune-consultant': {
    icon: MoonStar,
    background: tile('linear-gradient(135deg, oklch(0.66 0.17 305), oklch(0.55 0.21 315))'),
  },
  // 营销战役专家 — megaphone on coral
  'marketing-campaign-expert': {
    icon: Megaphone,
    background: tile('linear-gradient(135deg, oklch(0.72 0.17 30), oklch(0.62 0.21 15))'),
  },
  // 售前技术顾问 — presentation board on cyan
  'presales-technical-consultant': {
    icon: Presentation,
    background: tile('linear-gradient(135deg, oklch(0.72 0.12 215), oklch(0.62 0.14 225))'),
  },
  // React 开发专家 — atom on navy (React-style dark tile, light cyan glyph)
  'react-dev': {
    icon: Atom,
    background: tile('linear-gradient(135deg, oklch(0.38 0.09 255), oklch(0.3 0.08 265))'),
    iconColor: 'oklch(0.88 0.11 210)',
  },
};

interface ExpertAvatarProps {
  /** Preset machine name (e.g. content-writer); selects the avatar art. */
  name: string;
  /** Localized display name, used for the fallback initial of unknown experts. */
  label: string;
  className?: string;
}

export function ExpertAvatar({ name, label, className }: ExpertAvatarProps) {
  const style = PRESET_EXPERT_AVATARS[name];

  if (!style) {
    return (
      <Avatar
        className={cn(
          'theme-scene-expert-empty-avatar shrink-0 overflow-hidden after:hidden',
          className,
        )}
      >
        <AvatarFallback className="theme-scene-expert-fallback">
          {label.slice(0, 1).toUpperCase()}
        </AvatarFallback>
      </Avatar>
    );
  }

  const Icon = style.icon;
  return (
    <Avatar
      aria-hidden="true"
      className={cn(
        'theme-scene-expert-avatar shrink-0 overflow-hidden after:hidden',
        className,
      )}
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
