import { Button } from '@shared/components/ui/button';
import { DestructiveConfirmDialog } from '@shared/components/ui/destructive-confirm-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@shared/components/ui/dropdown-menu';
import { Input } from '@shared/components/ui/input';
import { cn } from '@shared/lib/utils';
import {
  Ellipsis,
  ListChecks,
  Loader,
  Pencil,
  Pin,
  Share,
  Trash2,
} from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';

import { i18nService } from '../../services/i18n';
import type { RootState } from '../../store';
import { selectHasPendingPermissionForSession } from '../../store/selectors/coworkSelectors';
import { useSelector } from 'react-redux';
import { BatchSelectionCheckbox } from './BatchSelectionCheckbox';
import { AgentSidebarIndicator } from './constants';
import OverflowingSessionTitle from './OverflowingSessionTitle';
import { formatAgentTaskRelativeTime } from './time';
import type { AgentSidebarTaskNode } from './types';

interface AgentTaskRowProps {
  task: AgentSidebarTaskNode;
  isBatchMode: boolean;
  isSelected: boolean;
  isNested?: boolean;
  showBatchOption?: boolean;
  onSelect: () => void;
  onDelete: () => Promise<void>;
  onShare: () => Promise<void>;
  onTogglePin: (pinned: boolean) => Promise<void>;
  onRename: (title: string) => Promise<void>;
  onToggleSelection: () => void;
  onEnterBatchMode: () => void;
}

const AgentTaskRow: React.FC<AgentTaskRowProps> = ({
  task,
  isBatchMode,
  isSelected,
  isNested = true,
  showBatchOption = false,
  onSelect,
  onDelete,
  onShare,
  onTogglePin,
  onRename,
  onToggleSelection,
  onEnterBatchMode,
}) => {
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(task.title);
  const [menuOpen, setMenuOpen] = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isRenaming) setRenameValue(task.title);
  }, [isRenaming, task.title]);

  useEffect(() => {
    if (!isRenaming) return;
    requestAnimationFrame(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    });
  }, [isRenaming]);

  const handleRowClick = () => {
    if (isRenaming) return;
    if (isBatchMode) {
      onToggleSelection();
      return;
    }
    onSelect();
  };

  const handleRenameSave = async () => {
    const nextTitle = renameValue.trim();
    setIsRenaming(false);
    if (nextTitle && nextTitle !== task.title) await onRename(nextTitle);
  };

  const handleRenameCancel = () => {
    setRenameValue(task.title);
    setIsRenaming(false);
  };

  const indicatorLabel =
    task.indicator === AgentSidebarIndicator.Running
      ? i18nService.t('myAgentSidebarRunning')
      : i18nService.t('myAgentSidebarUnreadResult');
  const relativeTime = formatAgentTaskRelativeTime(task.updatedAt || task.createdAt);
  const isRunning = task.indicator === AgentSidebarIndicator.Running;
  const pinLabel = task.pinned
    ? i18nService.t('coworkUnpinSession')
    : i18nService.t('coworkPinSession');
  const hasPendingPermission = useSelector((state: RootState) =>
    selectHasPendingPermissionForSession(state, task.id),
  );
  const showRelativeTime = !isRunning && !hasPendingPermission;

  return (
    <div
      className={`sidebar-session-row group relative ${
        isNested ? 'ml-[-6px] w-[calc(100%+12px)]' : 'ml-0 w-full'
      } flex h-[30px] cursor-pointer items-center gap-2 rounded-md ${
        isBatchMode ? 'pl-4' : isNested ? 'pl-[38px]' : 'pl-3'
      } ${!isBatchMode && !isRenaming ? 'pr-[58px]' : 'pr-2.5'} text-sm font-normal transition-colors active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${
        isSelected
          ? 'sidebar-interactive-surface-active text-foreground'
          : 'sidebar-interactive-surface text-muted-foreground hover:text-foreground'
      }`}
      onClick={handleRowClick}
      onKeyDown={e => {
        if (e.target !== e.currentTarget) return;
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        handleRowClick();
      }}
      role="treeitem"
      aria-level={2}
      aria-selected={isSelected}
      tabIndex={0}
    >
      {isBatchMode && (
        <BatchSelectionCheckbox checked={isSelected} onToggleSelection={onToggleSelection} />
      )}

      {isRenaming ? (
        <Input
          ref={renameInputRef}
          type="text"
          value={renameValue}
          onChange={e => setRenameValue(e.target.value)}
          onClick={e => e.stopPropagation()}
          onBlur={() => void handleRenameSave()}
          onKeyDown={e => {
            if (e.key === 'Enter') void handleRenameSave();
            if (e.key === 'Escape') handleRenameCancel();
          }}
          className="min-w-0 flex-1 border border-border bg-background px-1.5 py-0.5 text-sm font-normal"
        />
      ) : (
        <>
          <OverflowingSessionTitle title={task.title} />
          {hasPendingPermission && (
            <span className="inline-flex shrink-0 items-center rounded-full bg-success/15 px-2 py-0.5 text-xs font-medium text-success">
              {i18nService.t('workbenchTaskStatusWaitingApproval')}
            </span>
          )}
        </>
      )}

      {!isBatchMode && !isRenaming && (
        <div className="absolute right-1 top-1/2 flex h-6 w-[52px] -translate-y-1/2 items-center justify-end">
          {showRelativeTime && (
            <span
              className="absolute inset-y-0 right-0 flex items-center whitespace-nowrap text-xs font-normal text-foreground opacity-[0.28] transition-opacity group-hover:pointer-events-none group-hover:opacity-0"
              title={relativeTime.full}
            >
              {relativeTime.compact}
            </span>
          )}
          {hasPendingPermission && (
            <span
              className="absolute inset-y-0 right-0 inline-flex size-6 items-center justify-center transition-opacity group-hover:pointer-events-none group-hover:opacity-0"
              title={i18nService.t('workbenchTaskStatusWaitingApproval')}
            >
              <Loader className="size-3 animate-spin text-success [animation-duration:1.8s]" />
            </span>
          )}
          {!hasPendingPermission && isRunning && (
            <span
              className="absolute inset-y-0 right-0 inline-flex size-6 items-center justify-center transition-opacity group-hover:pointer-events-none group-hover:opacity-0"
              title={indicatorLabel}
            >
              <Loader className="size-3 animate-spin text-muted-foreground" />
            </span>
          )}
          <div className="absolute right-0 flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={event => {
                event.stopPropagation();
                event.currentTarget.blur();
                void onTogglePin(!task.pinned);
              }}
              className={cn(
                'pointer-events-none opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-[0.3]',
                task.pinned && 'text-foreground group-hover:opacity-[0.46]',
              )}
              aria-label={pinLabel}
              title={pinLabel}
            >
              <Pin className={task.pinned ? 'fill-current' : undefined} />
            </Button>
            <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className={cn(
                      'pointer-events-none opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-[0.3]',
                      menuOpen && 'pointer-events-auto opacity-[0.46]',
                    )}
                    aria-label={i18nService.t('coworkSessionActions')}
                  >
                    <Ellipsis />
                  </Button>
                }
              ></DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[124px]">
                {showBatchOption && (
                  <DropdownMenuItem onClick={() => onEnterBatchMode()}>
                    <ListChecks className="h-3.5 w-3.5" /> {i18nService.t('batchOperations')}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={() => setIsRenaming(true)}>
                  <Pencil className="h-3.5 w-3.5" /> {i18nService.t('renameConversation')}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => void onTogglePin(!task.pinned)}>
                  <Pin className="h-3.5 w-3.5" /> {pinLabel}
                </DropdownMenuItem>
                <DropdownMenuItem className="hidden" onClick={() => void onShare()}>
                  <Share className="h-3.5 w-3.5" /> {i18nService.t('coworkShareSession')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-red-500 focus:text-red-500"
                  onClick={() => setShowConfirmDelete(true)}
                >
                  <Trash2 className="h-3.5 w-3.5" /> {i18nService.t('deleteSession')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      )}

      <DestructiveConfirmDialog
        open={showConfirmDelete}
        title={i18nService.t('deleteTaskConfirmTitle')}
        description={i18nService.t('deleteTaskConfirmMessage')}
        cancelLabel={i18nService.t('cancel')}
        confirmLabel={i18nService.t('deleteSession')}
        confirmVariant="outline"
        onCancel={() => setShowConfirmDelete(false)}
        onConfirm={() => {
          setShowConfirmDelete(false);
          void onDelete();
        }}
      />
    </div>
  );
};

export default AgentTaskRow;
