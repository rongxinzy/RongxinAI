import { Button } from '@shared/components/ui/button';
import { Checkbox } from '@shared/components/ui/checkbox';
import { Dialog, DialogContent, DialogFooter } from '@shared/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@shared/components/ui/dropdown-menu';
import { Input } from '@shared/components/ui/input';
import { Ellipsis, ListChecks, Loader, Pencil, Pin, Share, Trash2, TriangleAlert } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';

import { i18nService } from '../../services/i18n';
import { AgentSidebarIndicator } from './constants';
import { formatAgentTaskRelativeTime } from './time';
import type { AgentSidebarTaskNode } from './types';

interface AgentTaskRowProps {
  task: AgentSidebarTaskNode;
  isBatchMode: boolean;
  isSelected: boolean;
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
  task, isBatchMode, isSelected, showBatchOption = false,
  onSelect, onDelete, onShare, onTogglePin, onRename, onToggleSelection, onEnterBatchMode,
}) => {
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [suppressPinHover, setSuppressPinHover] = useState(false);
  const [renameValue, setRenameValue] = useState(task.title);
  const [menuOpen, setMenuOpen] = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (!isRenaming) setRenameValue(task.title); }, [isRenaming, task.title]);

  useEffect(() => {
    if (!isRenaming) return;
    requestAnimationFrame(() => { renameInputRef.current?.focus(); renameInputRef.current?.select(); });
  }, [isRenaming]);

  const handleRowClick = () => {
    if (isRenaming) return;
    if (isBatchMode) { onToggleSelection(); return; }
    onSelect();
  };

  const handleRenameSave = async () => {
    const nextTitle = renameValue.trim();
    setIsRenaming(false);
    if (nextTitle && nextTitle !== task.title) await onRename(nextTitle);
  };

  const handleRenameCancel = () => { setRenameValue(task.title); setIsRenaming(false); };

  const indicatorLabel = task.indicator === AgentSidebarIndicator.Running
    ? i18nService.t('myAgentSidebarRunning') : i18nService.t('myAgentSidebarUnreadResult');
  const relativeTime = formatAgentTaskRelativeTime(task.updatedAt || task.createdAt);
  const showRelativeTime = task.indicator === AgentSidebarIndicator.None;
  const pinLabel = task.pinned ? i18nService.t('coworkUnpinSession') : i18nService.t('coworkPinSession');

  return (
    <div
      className={`group relative -ml-[6px] flex h-[30px] w-[calc(100%+12px)] cursor-pointer items-center gap-2 rounded-md ${
        isBatchMode ? 'pl-4' : 'pl-[38px]'
      } pr-2.5 text-[14px] font-normal transition-colors ${
        task.isSelected
          ? 'bg-black/[0.06] text-foreground dark:bg-white/[0.07]'
          : 'text-foreground/80 hover:bg-black/[0.03] hover:text-foreground dark:hover:bg-white/[0.04]'
      }`}
      onClick={handleRowClick}
      onMouseMove={() => setSuppressPinHover(false)}
      onMouseLeave={() => setSuppressPinHover(false)}
      role="treeitem" aria-level={2} aria-selected={task.isSelected}
    >
      {!isBatchMode && !isRenaming && (
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={(event) => {
            event.stopPropagation();
            setSuppressPinHover(true);
            event.currentTarget.blur();
            void onTogglePin(!task.pinned);
          }}
          className={`absolute left-[13px] top-1/2 -translate-y-1/2 ${suppressPinHover ? 'pointer-events-none opacity-0' : task.pinned ? 'opacity-[0.46]' : 'pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-[0.3]'}`}
          aria-label={pinLabel} title={pinLabel}
        >
          <Pin className="h-3.5 w-3.5" />
        </Button>
      )}

      {isBatchMode && (
        <Checkbox checked={isSelected} onCheckedChange={() => onToggleSelection()}
          onClick={(e) => e.stopPropagation()} className="h-3.5 w-3.5 shrink-0" />
      )}

      {isRenaming ? (
        <Input ref={renameInputRef} type="text" value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)} onClick={(e) => e.stopPropagation()}
          onBlur={() => void handleRenameSave()}
          onKeyDown={(e) => { if (e.key === 'Enter') void handleRenameSave(); if (e.key === 'Escape') handleRenameCancel(); }}
          className="min-w-0 flex-1 border border-border bg-background px-1.5 py-0.5 text-[14px] font-normal" />
      ) : (
        <>
          <span className="min-w-0 flex-1 truncate">{task.title}</span>
          {task.indicator === AgentSidebarIndicator.Running && (
            <span className="inline-flex h-3 w-3 shrink-0 items-center justify-center transition-opacity group-hover:opacity-0" title={indicatorLabel}>
              <Loader className="h-3 w-3 animate-spin text-muted-foreground" />
            </span>
          )}
          {task.indicator === AgentSidebarIndicator.CompletedUnread && (
            <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-blue-500 transition-opacity group-hover:opacity-0" title={indicatorLabel} />
          )}
          {showRelativeTime && (
            <span className="shrink-0 whitespace-nowrap text-[12px] font-normal text-foreground opacity-[0.28] transition-opacity group-hover:opacity-0"
              title={relativeTime.full}>{relativeTime.compact}</span>
          )}
        </>
      )}

      {!isBatchMode && !isRenaming && (
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger render={
            <Button variant="ghost" size="icon-xs"
              className={`absolute right-1 top-1/2 -translate-y-1/2 ${menuOpen ? 'opacity-[0.46]' : 'opacity-0 group-hover:opacity-[0.3]'}`}
              aria-label={i18nService.t('coworkSessionActions')}>
              <Ellipsis className="h-4 w-4" />
            </Button>
          }>
          </DropdownMenuTrigger>
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
            <DropdownMenuItem onClick={() => void onShare()}>
              <Share className="h-3.5 w-3.5" /> {i18nService.t('coworkShareSession')}
            </DropdownMenuItem>
            <DropdownMenuItem className="text-red-500 focus:text-red-500" onClick={() => setShowConfirmDelete(true)}>
              <Trash2 className="h-3.5 w-3.5" /> {i18nService.t('deleteSession')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <Dialog open={showConfirmDelete} onOpenChange={(o) => { if (!o) setShowConfirmDelete(false); }}>
        <DialogContent className="max-w-sm" showCloseButton={false}>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-full bg-red-100 dark:bg-red-900/30">
              <TriangleAlert className="h-5 w-5 text-red-600 dark:text-red-500" />
            </div>
            <h2 className="text-base font-semibold">{i18nService.t('deleteTaskConfirmTitle')}</h2>
          </div>
          <p className="text-sm text-muted-foreground">{i18nService.t('deleteTaskConfirmMessage')}</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowConfirmDelete(false)}>{i18nService.t('cancel')}</Button>
            <Button variant="destructive" onClick={() => { setShowConfirmDelete(false); void onDelete(); }}>{i18nService.t('deleteSession')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AgentTaskRow;
