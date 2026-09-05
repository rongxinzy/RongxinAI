import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@shared/components/ui/dropdown-menu';
import { ShieldAlert, ShieldCheck } from 'lucide-react';
import React from 'react';

import { CoworkPermissionMode } from '../../../shared/cowork/constants';
import { i18nService } from '../../services/i18n';
import { PromptSelectorButton } from './PromptSelectorButton';

interface PermissionModeMenuProps {
  value: CoworkPermissionMode;
  onChange: (mode: CoworkPermissionMode) => void;
  disabled?: boolean;
  compact?: boolean;
}

const PERMISSION_MODE_LABEL_KEYS = {
  [CoworkPermissionMode.Ask]: 'permissionModeAsk',
  [CoworkPermissionMode.AllowAll]: 'permissionModeAllowAll',
} as const;

/**
 * Work-mode permission selector: 请求权限 (ask before acting) vs 全部允许
 * (execute without authorization). Persisted via cowork config.
 */
const PermissionModeMenu: React.FC<PermissionModeMenuProps> = ({
  value,
  onChange,
  disabled = false,
  compact = false,
}) => {
  const TriggerIcon = value === CoworkPermissionMode.Ask ? ShieldCheck : ShieldAlert;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        nativeButton={true}
        disabled={disabled}
        render={
          <PromptSelectorButton
            disabled={disabled}
            compact={compact}
            label={i18nService.t(PERMISSION_MODE_LABEL_KEYS[value])}
            icon={<TriggerIcon className="size-4" />}
          />
        }
      />
      <DropdownMenuContent side="bottom" align="start" sideOffset={4} className="w-56 p-2">
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={nextValue => onChange(nextValue as CoworkPermissionMode)}
          className="space-y-1"
        >
          {(
            [
              [CoworkPermissionMode.Ask, 'permissionModeAsk', 'permissionModeAskDescription'],
              [
                CoworkPermissionMode.AllowAll,
                'permissionModeAllowAll',
                'permissionModeAllowAllDescription',
              ],
            ] as const
          ).map(([mode, labelKey, descriptionKey]) => (
            <DropdownMenuRadioItem
              key={mode}
              value={mode}
              className="items-start gap-2 rounded-lg px-2 py-2.5 data-checked:bg-surface-raised"
            >
              {mode === CoworkPermissionMode.Ask ? (
                <ShieldCheck className="mt-0.5 size-5" />
              ) : (
                <ShieldAlert className="mt-0.5 size-5" />
              )}
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-sm">{i18nService.t(labelKey)}</span>
                <span className="text-xs text-muted-foreground">
                  {i18nService.t(descriptionKey)}
                </span>
              </div>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default PermissionModeMenu;
