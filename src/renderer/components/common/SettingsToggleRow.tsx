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
    <div>
      <h4 className="mb-3 text-sm font-medium text-foreground">{label}</h4>
      <label className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{description}</span>
        <Switch
          checked={checked}
          onCheckedChange={onCheckedChange}
          disabled={disabled}
        />
      </label>
    </div>
  );
}

export { SettingsToggleRow };