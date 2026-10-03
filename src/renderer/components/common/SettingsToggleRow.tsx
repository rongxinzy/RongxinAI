import type { ReactNode } from 'react';

import { Switch } from '@shared/components/ui/switch';

type SettingsToggleRowProps = {
  label: ReactNode;
  description: ReactNode;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void | Promise<void>;
};

function SettingsToggleRow({
  label,
  description,
  checked,
  disabled,
  onCheckedChange,
}: SettingsToggleRowProps) {
  return (
    <div className="flex items-center justify-between gap-6">
      <div className="min-w-0 flex-1">
        <h4 className="text-sm font-medium text-foreground">{label}</h4>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      <Switch
        className="shrink-0"
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
      />
    </div>
  );
}

export { SettingsToggleRow };
