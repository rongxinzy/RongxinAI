import { Folder } from 'lucide-react';
import type { ComponentProps } from 'react';
import { cn } from '@shared/lib/utils';

import FolderSelectorPopover from './FolderSelectorPopover';
import { PromptSelectorButton } from './PromptSelectorButton';

type PromptWorkspaceSelectorProps = Omit<
  ComponentProps<typeof FolderSelectorPopover>,
  'children' | 'side' | 'align'
> & {
  label: string;
  compact: boolean;
  warning: boolean;
  disabled: boolean;
};

export function PromptWorkspaceSelector({
  label,
  compact,
  warning,
  disabled,
  ...popoverProps
}: PromptWorkspaceSelectorProps) {
  return (
    <FolderSelectorPopover {...popoverProps} side="bottom" align="start">
      <PromptSelectorButton
        label={label}
        title={label}
        icon={<Folder className="size-4" />}
        compact={compact}
        disabled={disabled}
        aria-invalid={warning || undefined}
        className={cn(warning && 'theme-prompt-folder-warning')}
      />
    </FolderSelectorPopover>
  );
}
