import { Building2, Cpu, KeyRound, Layers } from 'lucide-react';
import { cn } from '@shared/lib/utils';

export interface ProviderAvatarProps {
  name?: string;
  providerKey?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

function getInitialLabel(name?: string, providerKey?: string): string {
  const source = (name || providerKey || '?').trim();
  const first = source.charAt(0).toUpperCase();
  return first || '?';
}

export function ProviderAvatar({ name, providerKey, size = 'md', className }: ProviderAvatarProps) {
  const key = (providerKey || '').toLowerCase();
  const sizeClass =
    size === 'sm' ? 'size-4 text-[10px]' : size === 'lg' ? 'size-9 text-sm' : 'size-6 text-xs';
  const iconClass = size === 'sm' ? 'size-3' : size === 'lg' ? 'size-4' : 'size-3.5';

  const baseClass = cn(
    'inline-flex shrink-0 items-center justify-center rounded-md bg-muted font-semibold text-muted-foreground select-none',
    sizeClass,
    className,
  );

  if (key === 'llamacpp' || key === 'ollama') {
    return (
      <span aria-hidden="true" className={baseClass}>
        <Cpu className={iconClass} />
      </span>
    );
  }
  if (key === 'custom_aisphere' || key === 'organization' || key === 'enterprise') {
    return (
      <span aria-hidden="true" className={baseClass}>
        <Building2 className={iconClass} />
      </span>
    );
  }
  if (key.startsWith('sub_') || key === 'subscription') {
    return (
      <span aria-hidden="true" className={baseClass}>
        <KeyRound className={iconClass} />
      </span>
    );
  }
  if (key === 'group') {
    return (
      <span aria-hidden="true" className={baseClass}>
        <Layers className={iconClass} />
      </span>
    );
  }

  return (
    <span aria-hidden="true" className={baseClass}>
      {getInitialLabel(name, providerKey)}
    </span>
  );
}
