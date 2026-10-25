import { Archive, Check, EllipsisVertical, Pencil, RotateCcw, Trash2 } from 'lucide-react';
import { Button } from '@shared/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@shared/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@shared/components/ui/tooltip';
import {
  MemoryDeliveryStatus,
  MemoryLifecycleStatus,
  type ManagedMemoryRecord,
} from '../../../../shared/memory';
import { i18nService } from '../../../services/i18n';
import { canEdit } from './memoryRecordPresentation';

export interface MemoryRecordActionProps {
  record: ManagedMemoryRecord;
  busy: boolean;
  inlineLifecycleActions?: boolean;
  onEdit: () => void;
  onConfirm: () => void;
  onArchive: () => void;
  onRestore: () => void;
  onForget: () => void;
}

export function MemoryRecordActions(props: MemoryRecordActionProps) {
  const {
    record,
    busy,
    inlineLifecycleActions = false,
    onEdit,
    onConfirm,
    onArchive,
    onRestore,
    onForget,
  } = props;
  const editable = canEdit(record);
  const active = record.status === MemoryLifecycleStatus.Active;
  const restorable =
    record.status === MemoryLifecycleStatus.Archived ||
    record.status === MemoryLifecycleStatus.Expired;
  const hasPrimaryMenuActions = !inlineLifecycleActions && (editable || active || restorable);
  const confirmDisabled = busy || record.deliveryStatus === MemoryDeliveryStatus.Pending;
  return (
    <div className="flex shrink-0 items-center gap-1">
      {record.status === MemoryLifecycleStatus.NeedsReview && inlineLifecycleActions && (
        <Button type="button" size="sm" onClick={onConfirm} disabled={confirmDisabled}>
          <Check data-icon="inline-start" />
          {i18nService.t('managedMemoryConfirm')}
        </Button>
      )}
      {record.status === MemoryLifecycleStatus.NeedsReview && !inlineLifecycleActions && (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={onConfirm}
                aria-label={i18nService.t('managedMemoryConfirm')}
                disabled={confirmDisabled}
              />
            }
          >
            <Check />
          </TooltipTrigger>
          <TooltipContent>{i18nService.t('managedMemoryConfirm')}</TooltipContent>
        </Tooltip>
      )}
      {inlineLifecycleActions && editable && (
        <Button type="button" variant="outline" size="sm" onClick={onEdit} disabled={busy}>
          <Pencil data-icon="inline-start" />
          {i18nService.t('edit')}
        </Button>
      )}
      {inlineLifecycleActions && active && (
        <Button type="button" variant="outline" size="sm" onClick={onArchive} disabled={busy}>
          <Archive data-icon="inline-start" />
          {i18nService.t('managedMemoryStopUsing')}
        </Button>
      )}
      {inlineLifecycleActions && restorable && (
        <Button type="button" variant="outline" size="sm" onClick={onRestore} disabled={busy}>
          <RotateCcw data-icon="inline-start" />
          {i18nService.t('managedMemoryRestore')}
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={i18nService.t('managedMemoryMoreActions')}
              disabled={busy}
            />
          }
        >
          <EllipsisVertical />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {hasPrimaryMenuActions && (
            <DropdownMenuGroup>
              {editable && (
                <DropdownMenuItem onClick={onEdit}>
                  <Pencil />
                  {i18nService.t('edit')}
                </DropdownMenuItem>
              )}
              {active && (
                <DropdownMenuItem onClick={onArchive}>
                  <Archive />
                  {i18nService.t('managedMemoryStopUsing')}
                </DropdownMenuItem>
              )}
              {restorable && (
                <DropdownMenuItem onClick={onRestore}>
                  <RotateCcw />
                  {i18nService.t('managedMemoryRestore')}
                </DropdownMenuItem>
              )}
            </DropdownMenuGroup>
          )}
          {hasPrimaryMenuActions && <DropdownMenuSeparator />}
          <DropdownMenuGroup>
            <DropdownMenuItem variant="destructive" onClick={onForget}>
              <Trash2 />
              {record.memoryId === null
                ? i18nService.t('managedMemoryRejectCandidate')
                : i18nService.t('delete')}
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
