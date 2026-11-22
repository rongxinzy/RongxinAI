import { cn } from '@shared/lib/utils';
import { Building2, Cpu, KeyRound, Layers, Plug } from 'lucide-react';
import type { ComponentType } from 'react';
import {
  AnthropicIcon,
  DeepSeekIcon,
  GeminiIcon,
  GrokIcon,
  MiniMaxIcon,
  MoonshotIcon,
  OpenAIIcon,
  OpenRouterIcon,
  QianfanIcon,
  QwenIcon,
  StepfunIcon,
  VolcengineIcon,
  XiaomiIcon,
  ZhipuIcon,
} from './icons';
import { type PresetBrandKey, resolveProviderAvatarKind } from './providerPresetMatcher';

export interface ProviderAvatarProps {
  name?: string;
  providerKey?: string;
  baseUrl?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const PRESET_BRAND_ICONS: Record<PresetBrandKey, ComponentType<{ className?: string }>> = {
  deepseek: DeepSeekIcon,
  qwen: QwenIcon,
  zhipu: ZhipuIcon,
  openai: OpenAIIcon,
  anthropic: AnthropicIcon,
  gemini: GeminiIcon,
  moonshot: MoonshotIcon,
  minimax: MiniMaxIcon,
  volcengine: VolcengineIcon,
  qianfan: QianfanIcon,
  stepfun: StepfunIcon,
  xiaomi: XiaomiIcon,
  grok: GrokIcon,
  openrouter: OpenRouterIcon,
};

function getInitialLabel(name?: string, providerKey?: string): string {
  const source = (name || providerKey || '?').trim();
  const first = source.charAt(0).toUpperCase();
  return first || '?';
}

export function ProviderAvatar({
  name,
  providerKey,
  baseUrl,
  size = 'md',
  className,
}: ProviderAvatarProps) {
  const kind = resolveProviderAvatarKind({ providerKey, name, baseUrl });

  const sizeClass =
    size === 'sm' ? 'size-5 text-[10px]' : size === 'lg' ? 'size-9 text-sm' : 'size-8 text-xs';
  const brandIconClass = size === 'sm' ? 'size-3.5' : size === 'lg' ? 'size-5' : 'size-4.5';
  const lucideIconClass = size === 'sm' ? 'size-3' : size === 'lg' ? 'size-4' : 'size-4';

  const brandBoxClass = cn(
    'inline-flex shrink-0 items-center justify-center rounded-md bg-muted text-foreground select-none',
    sizeClass,
    className,
  );
  const neutralBoxClass = cn(
    'inline-flex shrink-0 items-center justify-center rounded-md bg-muted font-semibold text-muted-foreground select-none',
    sizeClass,
    className,
  );

  if (kind && kind in PRESET_BRAND_ICONS) {
    const BrandIcon = PRESET_BRAND_ICONS[kind as PresetBrandKey];
    return (
      <span aria-hidden="true" className={brandBoxClass}>
        <BrandIcon className={brandIconClass} />
      </span>
    );
  }

  if (kind === 'llamacpp') {
    return (
      <span aria-hidden="true" className={neutralBoxClass}>
        <Cpu className={lucideIconClass} />
      </span>
    );
  }
  if (kind === 'organization') {
    return (
      <span aria-hidden="true" className={neutralBoxClass}>
        <Building2 className={lucideIconClass} />
      </span>
    );
  }
  if (kind === 'subscription') {
    return (
      <span aria-hidden="true" className={neutralBoxClass}>
        <KeyRound className={lucideIconClass} />
      </span>
    );
  }
  if (kind === 'group') {
    return (
      <span aria-hidden="true" className={neutralBoxClass}>
        <Layers className={lucideIconClass} />
      </span>
    );
  }
  if (kind === 'custom') {
    return (
      <span aria-hidden="true" className={neutralBoxClass}>
        <Plug className={lucideIconClass} />
      </span>
    );
  }

  return (
    <span aria-hidden="true" className={neutralBoxClass}>
      {getInitialLabel(name, providerKey)}
    </span>
  );
}
