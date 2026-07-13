import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@shared/components/ui/dropdown-menu';
import { Clock, Folder, FolderPlus } from 'lucide-react';
import React, { useCallback, useEffect, useState } from 'react';

import { coworkService } from '../../services/cowork';
import { i18nService } from '../../services/i18n';
import { getCompactFolderName } from '../../utils/path';

interface FolderSelectorPopoverProps {
  /** Trigger element (typically a Button) */
  children: React.ReactNode;
  /** Called when a folder is selected */
  onSelectFolder: (path: string) => void;
  /** Dropdown side relative to trigger (default: "top") */
  side?: 'top' | 'bottom';
  /** Dropdown alignment relative to trigger (default: "start") */
  align?: 'start' | 'center' | 'end';
}

const isWindowsDriveRoot = (dirPath: string): boolean => {
  if (window.electron.platform !== 'win32') return false;
  return /^[a-zA-Z]:[/\\]?$/.test(dirPath.trim());
};

const FolderSelectorPopover: React.FC<FolderSelectorPopoverProps> = ({
  children,
  onSelectFolder,
  side = 'top',
  align = 'start',
}) => {
  const [open, setOpen] = useState(false);
  const [recentFolders, setRecentFolders] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Load recent folders when the dropdown opens
  useEffect(() => {
    if (open) {
      const loadRecentFolders = async () => {
        setIsLoading(true);
        try {
          const folders = await coworkService.getRecentCwds(10);
          setRecentFolders(folders);
        } catch (error) {
          console.error('Failed to load recent folders:', error);
          setRecentFolders([]);
        } finally {
          setIsLoading(false);
        }
      };
      loadRecentFolders();
    }
  }, [open]);

  const handleAddFolder = useCallback(async () => {
    setOpen(false);
    try {
      const result = await window.electron.dialog.selectDirectory();
      if (result.success && result.path) {
        if (isWindowsDriveRoot(result.path)) {
          window.dispatchEvent(new CustomEvent('app:showToast', { detail: i18nService.t('folderDriveRootNotAllowed') }));
          return;
        }
        onSelectFolder(result.path);
      }
    } catch (error) {
      console.error('Failed to select directory:', error);
    }
  }, [onSelectFolder]);

  const handleSelectRecentFolder = useCallback((path: string) => {
    if (isWindowsDriveRoot(path)) {
      window.dispatchEvent(new CustomEvent('app:showToast', { detail: i18nService.t('folderDriveRootNotAllowed') }));
      return;
    }
    onSelectFolder(path);
    setOpen(false);
  }, [onSelectFolder]);

  const truncatePath = (path: string, maxLength = 40): string => {
    if (!path) return i18nService.t('noFolderSelected');
    return getCompactFolderName(path, maxLength) || i18nService.t('noFolderSelected');
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger render={children as React.ReactElement} />
      <DropdownMenuContent side={side} align={align} className="w-56">
        {/* Add Folder option */}
        <DropdownMenuItem onClick={handleAddFolder}>
          <FolderPlus className="h-4 w-4 text-muted-foreground" />
          <span>{i18nService.t('addFolder')}</span>
        </DropdownMenuItem>

        {/* Recent Folders submenu */}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Clock className="h-4 w-4 text-muted-foreground" />
            <span>{i18nService.t('recentFolders')}</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="max-h-28 overflow-y-auto">
            {isLoading ? (
              <div className="px-2 py-1.5 text-sm text-muted-foreground">
                {i18nService.t('loading')}
              </div>
            ) : recentFolders.length === 0 ? (
              <div className="px-2 py-1.5 text-sm text-muted-foreground">
                {i18nService.t('noRecentFolders')}
              </div>
            ) : (
              recentFolders.map((folder, index) => (
                <DropdownMenuItem
                  key={index}
                  onClick={() => handleSelectRecentFolder(folder)}
                >
                  <Folder className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                  <span className="truncate">{truncatePath(folder)}</span>
                </DropdownMenuItem>
              ))
            )}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default FolderSelectorPopover;
