import { Button } from '@shared/components/ui/button';
import { Dialog, DialogContent, DialogFooter } from '@shared/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@shared/components/ui/dropdown-menu';
import { Ellipsis, ListChecks, Pencil, Pin, Trash2, TriangleAlert } from 'lucide-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';

import { i18nService } from '../../services/i18n';
import type { CoworkSessionStatus, CoworkSessionSummary } from '../../types/cowork';

interface CoworkSessionItemProps {
  session: CoworkSessionSummary;
  hasUnread: boolean;
  isActive: boolean;
  isBatchMode: boolean;
  isSelected: boolean;
  showBatchOption?: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onTogglePin: (pinned: boolean) => void;
  onRename: (title: string) => void;
  onToggleSelection: () => void;
  onEnterBatchMode: () => void;
}

const statusLabels: Record<CoworkSessionStatus, string> = {
  idle: 'coworkStatusIdle',
  running: 'coworkStatusRunning',
  completed: 'coworkStatusCompleted',
  error: 'coworkStatusError',
};

const formatRelativeTime = (timestamp: number): { compact: string; full: string } => {
  const now = Date.now();
  const diff = Math.max(0, now - timestamp);

  const minutes = Math.max(1, Math.floor(diff / 60000));
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes <= 60) {
    return {
      compact: `${minutes}m`,
      full: `${minutes} ${i18nService.t('minutesAgo')}`,
    };
  } else if (hours < 24) {
    return {
      compact: `${hours}h`,
      full: `${hours} ${i18nService.t('hoursAgo')}`,
    };
  } else if (days === 1) {
    return {
      compact: '1d',
      full: i18nService.t('yesterday'),
    };
  } else {
    return {
      compact: `${days}d`,
      full: `${days} ${i18nService.t('daysAgo')}`,
    };
  }
};

const CoworkSessionItem: React.FC<CoworkSessionItemProps> = ({
  session,
  hasUnread,
  isActive,
  isBatchMode,
  isSelected,
  showBatchOption = true,
  onSelect,
  onDelete,
  onTogglePin,
  onRename,
  onToggleSelection,
  onEnterBatchMode,
}) => {
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(session.title);
  const actionButtonRef = useRef<HTMLButtonElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const ignoreNextBlurRef = useRef(false);

  useEffect(() => {
    if (!isRenaming) {
      setRenameValue(session.title);
      ignoreNextBlurRef.current = false;
    }
  }, [isRenaming, session.title]);

  const handleTogglePin = React.useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onTogglePin(!session.pinned);
  }, [onTogglePin, session.pinned]);

  const handleRenameClick = React.useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    ignoreNextBlurRef.current = false;
    setIsRenaming(true);
    setShowConfirmDelete(false);
    setRenameValue(session.title);
  }, [session.title]);

  const handleRenameSave = (e?: React.SyntheticEvent) => {
    e?.stopPropagation();
    ignoreNextBlurRef.current = true;
    const nextTitle = renameValue.trim();
    if (nextTitle && nextTitle !== session.title) {
      onRename(nextTitle);
    }
    setIsRenaming(false);
  };

  const handleRenameCancel = (e?: React.MouseEvent | React.KeyboardEvent) => {
    e?.stopPropagation();
    ignoreNextBlurRef.current = true;
    setRenameValue(session.title);
    setIsRenaming(false);
  };

  const handleRenameBlur = (event: React.FocusEvent<HTMLInputElement>) => {
    if (ignoreNextBlurRef.current) {
      ignoreNextBlurRef.current = false;
      return;
    }
    handleRenameSave(event);
  };

  const handleDeleteClick = React.useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setShowConfirmDelete(true);
  }, []);

  const handleConfirmDelete = () => {
    onDelete();
    setShowConfirmDelete(false);
  };

  const handleCancelDelete = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    setShowConfirmDelete(false);
  };

  const handleBatchClick = React.useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onEnterBatchMode();
  }, [onEnterBatchMode]);

  useEffect(() => {
    if (!isRenaming) return;

    requestAnimationFrame(() => {
      renameInputRef.current?.focus();
   
      renameInputRef.current?.select();
    });
  }, [isRenaming]);

  const pinButtonLabel = session.pinned ? i18nService.t('coworkUnpinSession') : i18nService.t('coworkPinSession');
  const actionLabel = i18nService.t('coworkSessionActions');
  const renameLabel = i18nService.t('renameConversation');
  const deleteLabel = i18nService.t('deleteSession');
  const relativeTime = formatRelativeTime(session.updatedAt);
  const showRunningIndicator = session.status === 'running';
  const showUnreadIndicator = !showRunningIndicator && hasUnread;
  const showStatusIndicator = showRunningIndicator || showUnreadIndicator;
  const showRelativeTime = !showStatusIndicator;
  const batchLabel = i18nService.t('batchOperations');
  const menuItems = useMemo(() => {
    const items = [
      { key: 'rename', label: renameLabel, onClick: handleRenameClick },
      { key: 'pin', label: pinButtonLabel, onClick: handleTogglePin },
      { key: 'delete', label: deleteLabel, onClick: handleDeleteClick },
    ];
    if (showBatchOption) {
      items.unshift({ key: 'batch', label: batchLabel, onClick: handleBatchClick });
    }
    return items;
  }, [
    batchLabel,
    deleteLabel,
    handleBatchClick,
    handleDeleteClick,
    handleRenameClick,
    handleTogglePin,
    pinButtonLabel,
    renameLabel,
    showBatchOption,
  ]);

  return (
    <div
      onClick={() => {
        if (isRenaming) return;
        if (isBatchMode) {
          onToggleSelection();
          return;
        }
        onSelect();
      }}
      className={`group relative p-3 rounded-lg cursor-pointer transition-all duration-150 ${
        isActive
          ? 'bg-black/[0.06] dark:bg-white/[0.08]'
          : 'hover:bg-black/[0.04] dark:hover:bg-white/[0.05]'
      }`}
    >
      {/* Content area */}
      <div className="flex items-start">
        {isBatchMode && (
          <div className="flex items-center mr-2 mt-0.5 flex-shrink-0">
            <input
              type="checkbox"
              checked={isSelected}
              onChange={(e) => {
                e.stopPropagation();
                onToggleSelection();
              }}
              onClick={(e) => e.stopPropagation()}
              className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 accent-primary cursor-pointer"
            />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className={`flex items-center mb-1 ${showStatusIndicator ? 'gap-2' : 'gap-0'}`}>
            {/* Status indicator */}
            {showStatusIndicator && (
              <span
                className={`block w-2 h-2 rounded-full bg-blue-500 flex-shrink-0 ${
                  showRunningIndicator ? 'shadow-[0_0_6px_rgba(59,130,246,0.5)] animate-pulse' : ''
                }`}
                title={showRunningIndicator ? i18nService.t(statusLabels[session.status]) : undefined}
              />
            )}
            {isRenaming ? (
              <input
                ref={renameInputRef}
                value={renameValue}
                onChange={(event) => setRenameValue(event.target.value)}
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    handleRenameSave(event);
                  }
                  if (event.key === 'Escape') {
                    handleRenameCancel(event);
                  }
                }}
                onBlur={handleRenameBlur}
                className="flex-1 min-w-0 rounded-lg border border-border bg-background px-2 py-1 text-sm font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              />
            ) : (
              <h3 className="text-sm font-medium text-foreground truncate">
                {session.title}
              </h3>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {showRelativeTime && (
              <span className="whitespace-nowrap" title={relativeTime.full}>
                {relativeTime.compact}
              </span>
            )}
            <span className="text-[10px] uppercase tracking-wider whitespace-nowrap">
              {i18nService.t(statusLabels[session.status])}
            </span>
          </div>
        </div>
      </div>

      {/* Actions - absolutely positioned overlay */}
      {!isBatchMode && (
      <div
        className={`absolute right-1.5 top-1.5 transition-opacity ${
          isRenaming
            ? 'opacity-0 pointer-events-none'
            : session.pinned
              ? 'opacity-100'
              : 'opacity-0 group-hover:opacity-100'
        }`}
      >
        <DropdownMenu>
          <DropdownMenuTrigger render={
            <Button ref={actionButtonRef as React.Ref<HTMLButtonElement>} variant="ghost" size="icon-sm" aria-label={actionLabel}>
              {session.pinned ? (
                <span className="relative block h-4 w-4">
                  <Pin className="h-4 w-4 transition-opacity duration-150 group-hover:opacity-0" />
                  <Ellipsis className="absolute inset-0 h-4 w-4 opacity-0 transition-opacity duration-150 group-hover:opacity-100" />
                </span>
              ) : (
                <Ellipsis className="h-4 w-4" />
              )}
            </Button>
          } />
          <DropdownMenuContent align="end" className="min-w-[124px]">
            {menuItems.map((item) => (
              <DropdownMenuItem key={item.key} onClick={item.onClick}>
                <span className="flex items-center gap-2">
                  {item.key === 'batch' && <ListChecks className="h-4 w-4" />}
                  {item.key === 'rename' && <Pencil className="h-4 w-4" />}
                  {item.key === 'pin' && <Pin className={`h-4 w-4 ${session.pinned ? 'opacity-60' : ''}`} />}
                  {item.key === 'delete' && <Trash2 className="h-4 w-4" />}
                  {item.label}
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      )}

      {/* Delete Confirmation Dialog */}
      <Dialog open={showConfirmDelete} onOpenChange={(open) => { if (!open) handleCancelDelete(); }}>
        <DialogContent className="max-w-sm" showCloseButton={false}>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-full bg-red-100 dark:bg-red-900/30">
              <TriangleAlert className="h-5 w-5 text-red-600 dark:text-red-500" />
            </div>
            <h2 className="text-base font-semibold">{i18nService.t('deleteTaskConfirmTitle')}</h2>
          </div>
          <p className="text-sm text-muted-foreground">{i18nService.t('deleteTaskConfirmMessage')}</p>
          <DialogFooter>
            <Button variant="outline" onClick={handleCancelDelete}>{i18nService.t('cancel')}</Button>
            <Button variant="destructive" onClick={handleConfirmDelete}>{i18nService.t('deleteSession')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default CoworkSessionItem;
