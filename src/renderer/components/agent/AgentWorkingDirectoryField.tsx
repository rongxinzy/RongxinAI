import { Button } from '@shared/components/ui/button';
import { Folder, X } from 'lucide-react';
import React, { useRef, useState } from 'react';

import { i18nService } from '../../services/i18n';
import { getCompactFolderName } from '../../utils/path';
import FolderSelectorPopover from '../cowork/FolderSelectorPopover';

interface AgentWorkingDirectoryFieldProps {
  value: string;
  onChange: (value: string) => void;
  compact?: boolean;
}

const truncatePath = (value: string, maxLength = 72): string => {
  if (!value.trim()) return i18nService.t('noFolderSelected');
  return getCompactFolderName(value, maxLength) || value;
};

const AgentWorkingDirectoryField: React.FC<AgentWorkingDirectoryFieldProps> = ({ value, onChange, compact = false }) => {
  const [showFolderMenu, setShowFolderMenu] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const handleFolderSelect = (path: string) => {
    onChange(path);
    setShowFolderMenu(false);
  };

  if (compact) {
    const hasValue = value.trim().length > 0;
    return (
      <div className="relative min-w-0">
        <div
          className={`inline-flex h-8 min-w-0 max-w-[240px] items-center rounded-lg bg-surface-raised/70 text-sm transition-colors hover:bg-surface-raised ${
            showFolderMenu ? 'text-foreground' : 'text-secondary'
          }`}
        >
          <Button
            ref={buttonRef}
            type="button"
            variant="ghost"
            title={hasValue ? value : i18nService.t('noFolderSelected')}
            aria-label={i18nService.t('agentDefaultWorkingDirectory')}
            onClick={() => setShowFolderMenu((open) => !open)}
            className="inline-flex h-full min-w-0 flex-1 items-center gap-2 rounded-lg pl-2.5 pr-2"
          >
            <Folder className="h-4 w-4 flex-shrink-0" />
            <span className={`truncate ${hasValue ? 'text-foreground' : 'text-secondary'}`}>
              {truncatePath(value, 40)}
            </span>
          </Button>
          {hasValue && (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={i18nService.t('clear')}
              title={i18nService.t('clear')}
              onClick={() => onChange('')}
              className="h-full flex-shrink-0 inline-flex items-center justify-center rounded-lg text-secondary hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
        <FolderSelectorPopover
          isOpen={showFolderMenu}
          onClose={() => setShowFolderMenu(false)}
          onSelectFolder={handleFolderSelect}
          anchorRef={buttonRef as React.RefObject<HTMLElement>}
          portal
          placement="top"
        />
      </div>
    );
  }

  return (
    <div className="relative">
      <label className="block text-sm font-medium text-secondary mb-1">
        {i18nService.t('agentDefaultWorkingDirectory')}
      </label>
      <div className="flex items-center gap-2">
        <Button
          ref={buttonRef}
          type="button"
          variant="outline"
          onClick={() => setShowFolderMenu((open) => !open)}
          className="min-w-0 flex-1 flex items-center gap-2 justify-start px-3 py-2 h-auto text-sm font-normal"
        >
          <Folder className="h-4 w-4 flex-shrink-0 text-secondary" />
          <span className={`flex-1 truncate text-left ${value.trim() ? '' : 'text-secondary'}`}>
            {truncatePath(value)}
          </span>
        </Button>
        {value.trim() && (
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label={i18nService.t('clear')}
            onClick={() => onChange('')}
            className="h-10 w-10 flex-shrink-0 inline-flex items-center justify-center text-secondary hover:text-foreground"
          >
            <X className="h-3.5 w-3.5 text-secondary" />
          </Button>
        )}
      </div>
      <p className="mt-1 text-xs text-secondary/70">
        {i18nService.t('agentDefaultWorkingDirectoryHint')}
      </p>
      <FolderSelectorPopover
        isOpen={showFolderMenu}
        onClose={() => setShowFolderMenu(false)}
        onSelectFolder={handleFolderSelect}
        anchorRef={buttonRef as React.RefObject<HTMLElement>}
      />
    </div>
  );
};

export default AgentWorkingDirectoryField;
