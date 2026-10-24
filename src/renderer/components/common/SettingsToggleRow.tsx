import { useId, type ReactNode } from 'react';

import { Switch } from '@shared/components/ui/switch';

type SettingsToggleRowProps = {
  label: ReactNode;
  description: ReactNode;
  checked: boolean;
  disabled?: boolean;
  labelHeadingLevel?: 3 | 4;
  onCheckedChange: (checked: boolean) => void | Promise<void>;
};

function SettingsToggleRow({
  label,
  description,
  checked,
  disabled,
  labelHeadingLevel = 4,
  onCheckedChange,
}: SettingsToggleRowProps) {
  const labelId = useId();
  const descriptionId = useId();
  const LabelHeading = labelHeadingLevel === 3 ? 'h3' : 'h4';
  return (
    <div className="flex items-center justify-between gap-6">
      <div className="min-w-0 flex-1">
        <LabelHeading id={labelId} className="text-sm font-medium text-foreground">
          {label}
        </LabelHeading>
        <p id={descriptionId} className="mt-1 text-sm text-muted-foreground">
          {description}
        </p>
      </div>
      <Switch
        className="shrink-0"
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        aria-labelledby={labelId}
        aria-describedby={descriptionId}
      />
    </div>
  );
}

export { SettingsToggleRow };
