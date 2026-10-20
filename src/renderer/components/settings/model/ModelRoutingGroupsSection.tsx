import { Badge } from '@shared/components/ui/badge';
import { Button } from '@shared/components/ui/button';
import { DestructiveConfirmDialog } from '@shared/components/ui/destructive-confirm-dialog';
import { Input } from '@shared/components/ui/input';
import { Label } from '@shared/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shared/components/ui/select';
import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import {
  MagpieProviderRouting,
  type MagpieRoutingGroup,
  type MagpieRoutingState,
} from '../../../../shared/magpie/routingUsage';
import { i18nService } from '../../../services/i18n';
import { showAppError } from '../../../services/appToast';
import { MODEL_ROUTING_OPTIONS } from './modelRoutingUsageConstants';

interface ModelRoutingGroupsSectionProps {
  routing: MagpieRoutingState | null;
  disabled?: boolean;
  onRoutingChange: (state: MagpieRoutingState) => void;
}

export function ModelRoutingGroupsSection({
  routing,
  disabled = false,
  onRoutingChange,
}: ModelRoutingGroupsSectionProps) {
  const [newName, setNewName] = useState('');
  const [newMember, setNewMember] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const api = window.electron.magpie;

  const moveGroup = async (index: number, direction: -1 | 1) => {
    if (!routing || !api?.arrangeRoutingGroups) return;
    const order = routing.groups.map(group => group.id);
    const target = index + direction;
    if (target < 0 || target >= order.length) return;
    const next = [...order];
    [next[index], next[target]] = [next[target], next[index]];
    try {
      onRoutingChange(await api.arrangeRoutingGroups(next));
    } catch (cause) {
      showAppError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const createGroup = async () => {
    if (!api?.saveRoutingGroup) return;
    const name = newName.trim();
    const member = newMember.trim();
    if (!name || !member) return;
    const id = name
      .toLowerCase()
      .replace(/[^a-z0-9.-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80);
    if (!id) return;
    try {
      onRoutingChange(
        await api.saveRoutingGroup({
          id,
          name,
          members: [member],
          routing: MagpieProviderRouting.Ordered,
        }),
      );
      setNewName('');
      setNewMember('');
    } catch (cause) {
      showAppError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const updateGroupRouting = async (group: MagpieRoutingGroup, routingMode: string) => {
    if (!api?.saveRoutingGroup) return;
    try {
      onRoutingChange(
        await api.saveRoutingGroup({
          id: group.id,
          name: group.name,
          members: group.members,
          routing: routingMode,
          off: group.off,
          renameFrom: group.id,
        }),
      );
    } catch (cause) {
      showAppError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const confirmDelete = async () => {
    if (!deleteId || !api?.deleteRoutingGroup) return;
    try {
      onRoutingChange(await api.deleteRoutingGroup(deleteId));
      setDeleteId(null);
    } catch (cause) {
      showAppError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {!routing?.groups.length ? (
        <p className="text-sm text-muted-foreground">{i18nService.t('modelRoutingEmpty')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {routing.groups.map((group, index) => (
            <li
              key={group.id}
              className="flex flex-col gap-3 rounded-lg border border-border-subtle px-4 py-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium text-foreground">{group.name}</p>
                  <p className="truncate text-sm text-muted-foreground">{group.id}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={disabled || index === 0}
                    onClick={() => void moveGroup(index, -1)}
                    aria-label={i18nService.t('modelRoutingMoveUp')}
                  >
                    <ChevronUp className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={disabled || index === routing.groups.length - 1}
                    onClick={() => void moveGroup(index, 1)}
                    aria-label={i18nService.t('modelRoutingMoveDown')}
                  >
                    <ChevronDown className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={disabled}
                    onClick={() => setDeleteId(group.id)}
                    aria-label={i18nService.t('modelRoutingDelete')}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Label className="text-sm text-muted-foreground">
                  {i18nService.t('modelRoutingModeLabel')}
                </Label>
                <Select
                  items={Object.fromEntries(
                    MODEL_ROUTING_OPTIONS.map(mode => [
                      mode,
                      i18nService.t(`modelRoutingMode_${mode}`),
                    ]),
                  )}
                  value={group.routing ?? MagpieProviderRouting.Ordered}
                  onValueChange={value => {
                    if (value) void updateGroupRouting(group, value);
                  }}
                  disabled={disabled}
                >
                  <SelectTrigger className="w-[min(100%,14rem)]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MODEL_ROUTING_OPTIONS.map(mode => (
                      <SelectItem key={mode} value={mode}>
                        {i18nService.t(`modelRoutingMode_${mode}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!group.ready ? (
                  <Badge variant="outline">{i18nService.t('modelRoutingNotReady')}</Badge>
                ) : null}
              </div>
              <ol className="flex flex-col gap-1 text-sm text-muted-foreground">
                {group.members.map((member, memberIndex) => (
                  <li key={`${group.id}-${member}`} className="truncate">
                    <span className="text-foreground">{memberIndex + 1}.</span> {member}
                  </li>
                ))}
              </ol>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-3 border-t border-border pt-4">
        <h3 className="text-sm font-medium">{i18nService.t('modelRoutingCreateTitle')}</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="routing-group-name">{i18nService.t('modelRoutingName')}</Label>
            <Input
              id="routing-group-name"
              value={newName}
              disabled={disabled}
              onChange={event => setNewName(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="routing-group-member">{i18nService.t('modelRoutingFirstMember')}</Label>
            <Select
              items={Object.fromEntries(
                (routing?.models ?? []).map(model => [model.id, model.name]),
              )}
              value={newMember}
              onValueChange={value => setNewMember(value ?? '')}
              disabled={disabled || !routing?.models.length}
            >
              <SelectTrigger id="routing-group-member" className="w-full">
                <SelectValue placeholder={i18nService.t('modelRoutingPickModel')} />
              </SelectTrigger>
              <SelectContent>
                {(routing?.models ?? []).map(model => (
                  <SelectItem key={model.id} value={model.id}>
                    {model.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <Button
          type="button"
          disabled={disabled || !newName.trim() || !newMember.trim()}
          onClick={() => void createGroup()}
        >
          <Plus className="size-4" />
          {i18nService.t('modelRoutingCreate')}
        </Button>
      </div>

      <DestructiveConfirmDialog
        open={deleteId !== null}
        title={i18nService.t('modelRoutingDeleteTitle')}
        description={i18nService.t('modelRoutingDeleteDescription')}
        cancelLabel={i18nService.t('magpieExternalCancel')}
        confirmLabel={i18nService.t('modelRoutingDeleteConfirm')}
        onCancel={() => setDeleteId(null)}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}
