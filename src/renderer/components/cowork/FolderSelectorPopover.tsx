import { Button } from '@shared/components/ui/button';
import { ChevronRight, Clock, Folder, FolderPlus } from 'lucide-react';
import React, { useCallback,useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { coworkService } from '../../services/cowork';
import { i18nService } from '../../services/i18n';
import { getCompactFolderName } from '../../utils/path';

interface FolderSelectorPopoverProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectFolder: (path: string) => void;
  anchorRef: React.RefObject<HTMLElement>;
  portal?: boolean;
  placement?: 'top' | 'bottom';
}

const POPOVER_WIDTH = 224; // matches w-56
const POPOVER_VIEWPORT_MARGIN = 8;

const FolderSelectorPopover: React.FC<FolderSelectorPopoverProps> = ({
  isOpen,
  onClose,
  onSelectFolder,
  anchorRef,
  portal = false,
  placement = 'top',
}) => {
  const [recentFolders, setRecentFolders] = useState<string[]>([]);
  const [showRecentSubmenu, setShowRecentSubmenu] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [portalStyle, setPortalStyle] = useState<React.CSSProperties>({});
  const popoverRef = useRef<HTMLDivElement>(null);
  const submenuRef = useRef<HTMLDivElement>(null);
  const recentFoldersRef = useRef<HTMLDivElement>(null);
  const submenuCloseTimerRef = useRef<NodeJS.Timeout | null>(null);

  const updatePortalPosition = useCallback(() => {
    if (!anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    const left = Math.min(
      Math.max(rect.left, POPOVER_VIEWPORT_MARGIN),
      window.innerWidth - POPOVER_WIDTH - POPOVER_VIEWPORT_MARGIN
    );
    const nextStyle: React.CSSProperties = {
      left,
      position: 'fixed',
      width: POPOVER_WIDTH,
      zIndex: 10000,
    };

    if (placement === 'top') {
      nextStyle.bottom = window.innerHeight - rect.top + 8;
    } else {
      nextStyle.top = rect.bottom + 8;
    }

    setPortalStyle(nextStyle);
  }, [anchorRef, placement]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (submenuCloseTimerRef.current) {
        clearTimeout(submenuCloseTimerRef.current);
      }
    };
  }, []);

  // Load recent folders when popover opens
  useLayoutEffect(() => {
    if (isOpen && portal) {
      updatePortalPosition();
    }
  }, [isOpen, portal, updatePortalPosition]);

  useEffect(() => {
    if (isOpen) {
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
    } else {
      setShowRecentSubmenu(false);
      if (submenuCloseTimerRef.current) {
        clearTimeout(submenuCloseTimerRef.current);
        submenuCloseTimerRef.current = null;
      }
    }
  }, [isOpen, portal, updatePortalPosition]);

  useEffect(() => {
    if (!isOpen || !portal) return;

    window.addEventListener('resize', updatePortalPosition);
    window.addEventListener('scroll', updatePortalPosition, true);

    return () => {
      window.removeEventListener('resize', updatePortalPosition);
      window.removeEventListener('scroll', updatePortalPosition, true);
    };
  }, [isOpen, portal, updatePortalPosition]);

  // Handle click outside
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      const isInsidePopover = popoverRef.current?.contains(target);
      const isInsideSubmenu = submenuRef.current?.contains(target);
      const isInsideAnchor = anchorRef.current?.contains(target);

      if (!isInsidePopover && !isInsideSubmenu && !isInsideAnchor) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside, true);
    return () => document.removeEventListener('mousedown', handleClickOutside, true);
  }, [isOpen, onClose, anchorRef]);

  // Handle escape key
  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  const isWindowsDriveRoot = (dirPath: string): boolean => {
    if (window.electron.platform !== 'win32') return false;
    return /^[a-zA-Z]:[/\\]?$/.test(dirPath.trim());
  };

  const handleAddFolder = async () => {
    onClose();
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
  };

  const handleSelectRecentFolder = (path: string) => {
    if (isWindowsDriveRoot(path)) {
      window.dispatchEvent(new CustomEvent('app:showToast', { detail: i18nService.t('folderDriveRootNotAllowed') }));
      return;
    }
    onSelectFolder(path);
    onClose();
  };

  const truncatePath = (path: string, maxLength = 40): string => {
    if (!path) return i18nService.t('noFolderSelected');
    return getCompactFolderName(path, maxLength) || i18nService.t('noFolderSelected');
  };

  const handleSubmenuMouseEnter = useCallback(() => {
    if (submenuCloseTimerRef.current) {
      clearTimeout(submenuCloseTimerRef.current);
      submenuCloseTimerRef.current = null;
    }
    setShowRecentSubmenu(true);
  }, []);

  const handleSubmenuMouseLeave = useCallback(() => {
    if (submenuCloseTimerRef.current) {
      clearTimeout(submenuCloseTimerRef.current);
    }
    submenuCloseTimerRef.current = setTimeout(() => {
      setShowRecentSubmenu(false);
      submenuCloseTimerRef.current = null;
    }, 150);
  }, []);

  if (!isOpen) return null;

  const popoverContent = (
    <>
      {/* Main popover */}
      <div
        ref={popoverRef}
        className={`${portal ? '' : 'absolute bottom-full left-0 mb-2'} w-56 rounded-lg border border-border bg-surface shadow-lg z-50`}
        style={portal ? portalStyle : undefined}
      >
        {/* Add Folder option */}
        <Button variant="ghost" className="w-full justify-start gap-3 rounded-t-lg" onClick={handleAddFolder}>
          <FolderPlus className="h-4 w-4 text-secondary" />
          <span>{i18nService.t('addFolder')}</span>
        </Button>

        {/* Recent Folders option */}
        <div
          ref={recentFoldersRef}
          className="relative"
          onMouseEnter={handleSubmenuMouseEnter}
          onMouseLeave={handleSubmenuMouseLeave}
        >
          <Button variant="ghost" className="w-full justify-between gap-3 rounded-b-lg">
            <div className="flex items-center gap-3">
              <Clock className="h-4 w-4 text-secondary" />
              <span>{i18nService.t('recentFolders')}</span>
            </div>
            <ChevronRight className="h-3 w-3 text-secondary" />
          </Button>

          {/* Recent folders submenu */}
          {showRecentSubmenu && (
            <div
              ref={submenuRef}
              className="absolute left-full top-0 w-56 max-h-[7rem] overflow-y-auto rounded-lg border border-border bg-surface shadow-lg z-[99999]"
              onMouseEnter={handleSubmenuMouseEnter}
              onMouseLeave={handleSubmenuMouseLeave}
            >
              {isLoading ? (
                <div className="px-3 py-2.5 text-sm text-secondary">
                  {i18nService.t('loading')}
                </div>
              ) : recentFolders.length === 0 ? (
                <div className="px-3 py-2.5 text-sm text-secondary">
                  {i18nService.t('noRecentFolders')}
                </div>
              ) : (
                recentFolders.map((folder, index) => (
                  <Button
                    key={index}
                    variant="ghost"
                    className="w-full justify-start gap-2 first:rounded-t-lg last:rounded-b-lg"
                    onClick={() => handleSelectRecentFolder(folder)}
                  >
                    <Folder className="h-4 w-4 flex-shrink-0 text-secondary" />
                    <span className="truncate">{truncatePath(folder)}</span>
                  </Button>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );

  return portal ? createPortal(popoverContent, document.body) : popoverContent;
};

export default FolderSelectorPopover;
