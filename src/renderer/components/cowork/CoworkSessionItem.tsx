import { Button } from '@shared/components/ui/button';
import { Checkbox } from '@shared/components/ui/checkbox';
import { DestructiveConfirmDialog } from '@shared/components/ui/destructive-confirm-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@shared/components/ui/dropdown-menu';
import { Ellipsis, ListChecks, Pencil, Pin, Trash2 } from 'lucide-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';

import { i18nService } from '../../services/i18n';
import type { CoworkSessionStatus, CoworkSessionSummary } from '../../types/cowork';

interface CoworkSessionItemProps {
  session: CoworkSessionSummary;
  hasUnread: boolean;
  hasPendingPermission: boolean;
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

const channelTitlePlatforms: Record<string, string> = {
  飞书: 'feishu',
  Feishu: 'feishu',
  钉钉: 'dingtalk',
  DingTalk: 'dingtalk',
  企业微信: 'wecom',
  WeCom: 'wecom',
  微信: 'weixin',
  WeChat: 'weixin',
  QQ: 'qq',
  TG: 'telegram',
  Telegram: 'telegram',
  Discord: 'discord',
};

const formatSessionTitle = (title: string): string => {
  const match = /^\[([^\]]+)]\s+(.+)$/.exec(title);
  if (!match) return title;

  const platform = channelTitlePlatforms[match[1]];
  if (!platform) return title;

  return i18nService
    .t('channelConversationTitle')
    .replace('{channel}', i18nService.t(platform))
    .replace('{id}', match[2]);
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
  hasPendingPermission,
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

  const handleTogglePin = React.useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onTogglePin(!session.pinned);
    },
    [onTogglePin, session.pinned],
  );

  const handleRenameClick = React.useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      ignoreNextBlurRef.current = false;
      setIsRenaming(true);
      setShowConfirmDelete(false);
      setRenameValue(session.title);
    },
    [session.title],
  );

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

  const handleBatchClick = React.useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onEnterBatchMode();
    },
    [onEnterBatchMode],
  );

  useEffect(() => {
    if (!isRenaming) return;

    requestAnimationFrame(() => {
      renameInputRef.current?.focus();

      renameInputRef.current?.select();
    });
  }, [isRenaming]);

  const pinButtonLabel = session.pinned
    ? i18nService.t('coworkUnpinSession')
    : i18nService.t('coworkPinSession');
  const actionLabel = i18nService.t('coworkSessionActions');
  const renameLabel = i18nService.t('renameConversation');
  const deleteLabel = i18nService.t('deleteSession');
  const relativeTime = formatRelativeTime(session.updatedAt);
  const displayTitle = formatSessionTitle(session.title);
  const showRunningIndicator = session.status === 'running';
  const showPendingPermission = hasPendingPermission;
  const showUnreadIndicator = !showRunningIndicator && hasUnread;
  const showStatusIndicator = showRunningIndicator || showUnreadIndicator || showPendingPermission;
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
      role="button"
      tabIndex={0}
      onClick={() => {
        if (isRenaming) return;
        if (isBatchMode) {
          onToggleSelection();
          return;
        }
        onSelect();
      }}
      onKeyDown={e => {
        if (e.target !== e.currentTarget) return;
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        if (isRenaming) return;
        if (isBatchMode) {
          onToggleSelection();
          return;
        }
        onSelect();
      }}
      className={`group relative p-3 rounded-lg cursor-pointer transition-colors duration-150 active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${
        isSelected || isActive
          ? 'bg-black/4 dark:bg-white/5'
          : 'hover:bg-black/4 dark:hover:bg-white/5'
      }`}
    >
      {/* Content area */}
      <div className={`flex items-start ${!isBatchMode && !isRenaming ? 'pr-8' : ''}`}>
        {isBatchMode && (
          <div className="flex items-center mr-2 mt-0.5 shrink-0">
            <Checkbox
              checked={isSelected}
              onCheckedChange={() => onToggleSelection()}
              onClick={e => e.stopPropagation()}
              className="h-4 w-4 rounded cursor-pointer"
            />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className={`flex items-center mb-1 ${showStatusIndicator ? 'gap-2' : 'gap-0'}`}>
            {/* Status indicator */}
            {showStatusIndicator && (
              <span
                className={`block w-2 h-2 rounded-full shrink-0 ${
                  showPendingPermission ? 'bg-success animate-pulse' : 'bg-ring'
                }`}
                title={
                  showPendingPermission
                    ? i18nService.t('workbenchTaskStatusWaitingApproval')
                    : showRunningIndicator
                      ? i18nService.t(statusLabels[session.status])
                      : undefined
                }
              />
            )}
            {isRenaming ? (
              <input
                ref={renameInputRef}
                value={renameValue}
                onChange={event => setRenameValue(event.target.value)}
                onClick={event => event.stopPropagation()}
                onKeyDown={event => {
                  if (event.key === 'Enter') {
                    handleRenameSave(event);
                  }
                  if (event.key === 'Escape') {
                    handleRenameCancel(event);
                  }
                }}
                onBlur={handleRenameBlur}
                className="flex-1 min-w-0 rounded-lg border border-input bg-background px-2 py-1 text-sm font-medium text-foreground transition-colors outline-none hover:ring-1 hover:ring-ring/40 focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/40"
              />
            ) : (
              <div className="flex min-w-0 items-center gap-2">
                <h3 className="min-w-0 truncate text-sm font-medium text-foreground">
                  {displayTitle}
                </h3>
                {showPendingPermission && (
                  <span className="inline-flex shrink-0 items-center rounded-full bg-success/15 px-2 py-0.5 text-xs font-medium text-success">
                    {i18nService.t('workbenchTaskStatusWaitingApproval')}
                  </span>
                )}
              </div>
            )}
          </div>
          {!showPendingPermission && (
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
          )}
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
            <DropdownMenuTrigger
              render={
                <Button
                  ref={actionButtonRef as React.Ref<HTMLButtonElement>}
                  variant="ghost"
                  size="icon-sm"
                  aria-label={actionLabel}
                >
                  {session.pinned ? (
                    <span className="relative block h-4 w-4">
                      <Pin className="h-4 w-4 transition-opacity duration-150 group-hover:opacity-0" />
                      <Ellipsis className="absolute inset-0 h-4 w-4 opacity-0 transition-opacity duration-150 group-hover:opacity-100" />
                    </span>
                  ) : (
                    <Ellipsis className="h-4 w-4" />
                  )}
                </Button>
              }
            />
            <DropdownMenuContent align="end" className="min-w-[124px]">
              {menuItems.map(item => (
                <DropdownMenuItem key={item.key} onClick={item.onClick}>
                  <span className="flex items-center gap-2">
                    {item.key === 'batch' && <ListChecks className="h-4 w-4" />}
                    {item.key === 'rename' && <Pencil className="h-4 w-4" />}
                    {item.key === 'pin' && (
                      <Pin className={`h-4 w-4 ${session.pinned ? 'opacity-60' : ''}`} />
                    )}
                    {item.key === 'delete' && <Trash2 className="h-4 w-4" />}
                    {item.label}
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      <DestructiveConfirmDialog
        open={showConfirmDelete}
        title={i18nService.t('deleteTaskConfirmTitle')}
        description={i18nService.t('deleteTaskConfirmMessage')}
        cancelLabel={i18nService.t('cancel')}
        confirmLabel={i18nService.t('deleteSession')}
        cancelVariant="outline"
        confirmVariant="outline"
        onCancel={handleCancelDelete}
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
};

export default CoworkSessionItem;
