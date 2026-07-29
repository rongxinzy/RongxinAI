import { PromptInputButton } from '@shared/components/ai-elements/prompt-input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@shared/components/ui/dropdown-menu';
import { ChevronDown } from 'lucide-react';
import React from 'react';

import { CoworkPermissionMode } from '../../../shared/cowork/constants';
import { i18nService } from '../../services/i18n';

interface PermissionModeMenuProps {
  value: CoworkPermissionMode;
  onChange: (mode: CoworkPermissionMode) => void;
  disabled?: boolean;
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
}) => {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        nativeButton={false}
        disabled={disabled}
        render={
          <PromptInputButton
            disabled={disabled}
            className="gap-1 px-2 text-sm hover:bg-surface-raised"
          >
            <span>{i18nService.t(PERMISSION_MODE_LABEL_KEYS[value])}</span>
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          </PromptInputButton>
        }
      />
      <DropdownMenuContent side="top" align="start" sideOffset={4} className="w-56">
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={nextValue => onChange(nextValue as CoworkPermissionMode)}
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
            <DropdownMenuRadioItem key={mode} value={mode} className="items-start py-1.5">
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
