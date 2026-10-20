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
import { useEffect, useState } from 'react';
import {
  MagpieProviderRouting,
  type MagpieRoutingGroup,
  type MagpieRoutingState,
} from '../../../../shared/magpie/routingUsage';
import { i18nService } from '../../../services/i18n';
import { showAppError } from '../../../services/appToast';
import { routingGroupIdFromName } from './modelRoutingGroupId';
import { MODEL_ROUTING_OPTIONS, routingModeLabel } from './modelRoutingUsageConstants';

interface ModelRoutingGroupsSectionProps {
  routing: MagpieRoutingState | null;
  disabled?: boolean;
  loadError?: boolean;
  onRoutingChange: (state: MagpieRoutingState) => void;
}

function memberDraftKey(group: MagpieRoutingGroup): string {
  return group.id;
}

export function ModelRoutingGroupsSection({
  routing,
  disabled = false,
  loadError = false,
  onRoutingChange,
}: ModelRoutingGroupsSectionProps) {
  const [newName, setNewName] = useState('');
  const [newMembers, setNewMembers] = useState<string[]>(['', '']);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [memberDrafts, setMemberDrafts] = useState<Record<string, string[]>>({});
  const api = window.electron.magpie;

  useEffect(() => {
    if (!routing) return;
    setMemberDrafts(previous => {
      const next = { ...previous };
      for (const group of routing.groups) {
        const key = memberDraftKey(group);
        if (!next[key]) next[key] = [...group.members];
      }
      return next;
    });
  }, [routing]);

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
    const members = newMembers.map(m => m.trim()).filter(Boolean);
    if (!name || members.length < 2) {
      showAppError(i18nService.t('modelRoutingMembersRequired'));
      return;
    }
    const id = routingGroupIdFromName(name);
    if (!id) return;
    try {
      onRoutingChange(
        await api.saveRoutingGroup({
          id,
          name,
          members,
          routing: MagpieProviderRouting.Smart,
        }),
      );
      setNewName('');
      setNewMembers(['', '']);
    } catch (cause) {
      showAppError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const saveGroupMembers = async (group: MagpieRoutingGroup) => {
    if (!api?.saveRoutingGroup) return;
    const members = (memberDrafts[memberDraftKey(group)] ?? group.members)
      .map(m => m.trim())
      .filter(Boolean);
    if (members.length < 2) {
      showAppError(i18nService.t('modelRoutingMembersRequired'));
      return;
    }
    try {
      onRoutingChange(
        await api.saveRoutingGroup({
          id: group.id,
          name: group.name,
          members,
          routing: group.routing,
          off: group.off,
          affinity: group.affinity,
        }),
      );
    } catch (cause) {
      showAppError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const updateGroupRouting = async (group: MagpieRoutingGroup, routingMode: string) => {
    if (!api?.saveRoutingGroup) return;
    const members = memberDrafts[memberDraftKey(group)] ?? group.members;
    try {
      onRoutingChange(
        await api.saveRoutingGroup({
          id: group.id,
          name: group.name,
          members,
          routing: routingMode,
          off: group.off,
          affinity: group.affinity,
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

  const updateDraftMember = (group: MagpieRoutingGroup, index: number, value: string) => {
    const key = memberDraftKey(group);
    const base = [...(memberDrafts[key] ?? group.members)];
    base[index] = value;
    setMemberDrafts({ ...memberDrafts, [key]: base });
  };

  const addDraftMember = (group: MagpieRoutingGroup) => {
    const key = memberDraftKey(group);
    const base = [...(memberDrafts[key] ?? group.members), ''];
    setMemberDrafts({ ...memberDrafts, [key]: base });
  };

  const removeDraftMember = (group: MagpieRoutingGroup, index: number) => {
    const key = memberDraftKey(group);
    const base = [...(memberDrafts[key] ?? group.members)];
    base.splice(index, 1);
    setMemberDrafts({ ...memberDrafts, [key]: base });
  };

  const moveDraftMember = (group: MagpieRoutingGroup, index: number, direction: -1 | 1) => {
    const key = memberDraftKey(group);
    const base = [...(memberDrafts[key] ?? group.members)];
    const target = index + direction;
    if (target < 0 || target >= base.length) return;
    [base[index], base[target]] = [base[target], base[index]];
    setMemberDrafts({ ...memberDrafts, [key]: base });
  };

  const modelItems = Object.fromEntries(
    (routing?.models ?? []).map(model => [model.id, model.name]),
  );

  return (
    <div className="flex flex-col gap-4">
      {!loadError && !routing?.groups.length ? (
        <p className="text-sm text-muted-foreground">{i18nService.t('modelRoutingEmpty')}</p>
      ) : null}

      {!loadError && routing?.groups.length ? (
        <ul className="flex flex-col gap-2">
          {routing.groups.map((group, index) => {
            const draft = memberDrafts[memberDraftKey(group)] ?? group.members;
            const routingValue = group.routing ?? MagpieProviderRouting.Smart;
            return (
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
                      MODEL_ROUTING_OPTIONS.map(mode => [mode, routingModeLabel(mode)]),
                    )}
                    value={routingValue}
                    onValueChange={value => {
                      if (value !== null && value !== undefined)
                        void updateGroupRouting(group, value);
                    }}
                    disabled={disabled}
                  >
                    <SelectTrigger className="w-[min(100%,14rem)]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {MODEL_ROUTING_OPTIONS.map(mode => (
                        <SelectItem key={mode || 'smart'} value={mode}>
                          {routingModeLabel(mode)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {!group.ready ? (
                    <Badge variant="outline">{i18nService.t('modelRoutingNotReady')}</Badge>
                  ) : null}
                </div>
                <div className="flex flex-col gap-2">
                  <Label className="text-sm text-muted-foreground">
                    {i18nService.t('modelRoutingMembersLabel')}
                  </Label>
                  <ol className="flex flex-col gap-2">
                    {draft.map((member, memberIndex) => (
                      <li
                        key={`${group.id}-member-${memberIndex}`}
                        className="flex flex-wrap gap-2"
                      >
                        <span className="pt-2 text-sm text-muted-foreground">
                          {memberIndex + 1}.
                        </span>
                        <Select
                          items={modelItems}
                          value={member}
                          onValueChange={value =>
                            updateDraftMember(group, memberIndex, value ?? '')
                          }
                          disabled={disabled}
                        >
                          <SelectTrigger className="min-w-[12rem] flex-1">
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
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          disabled={disabled || memberIndex === 0}
                          onClick={() => moveDraftMember(group, memberIndex, -1)}
                          aria-label={i18nService.t('modelRoutingMoveUp')}
                        >
                          <ChevronUp className="size-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          disabled={disabled || memberIndex === draft.length - 1}
                          onClick={() => moveDraftMember(group, memberIndex, 1)}
                          aria-label={i18nService.t('modelRoutingMoveDown')}
                        >
                          <ChevronDown className="size-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          disabled={disabled || draft.length <= 2}
                          onClick={() => removeDraftMember(group, memberIndex)}
                          aria-label={i18nService.t('modelRoutingRemoveMember')}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </li>
                    ))}
                  </ol>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={disabled}
                      onClick={() => addDraftMember(group)}
                    >
                      <Plus className="size-4" />
                      {i18nService.t('modelRoutingAddMember')}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      disabled={disabled}
                      onClick={() => void saveGroupMembers(group)}
                    >
                      {i18nService.t('modelRoutingSaveMembers')}
                    </Button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}

      {!loadError ? (
        <div className="flex flex-col gap-3 border-t border-border pt-4">
          <h3 className="text-sm font-medium">{i18nService.t('modelRoutingCreateTitle')}</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="routing-group-name">{i18nService.t('modelRoutingName')}</Label>
              <Input
                id="routing-group-name"
                value={newName}
                disabled={disabled}
                onChange={event => setNewName(event.target.value)}
              />
            </div>
            {newMembers.map((member, index) => (
              <div key={`new-member-${index}`} className="flex flex-col gap-1.5">
                <Label htmlFor={`routing-group-member-${index}`}>
                  {i18nService.t('modelRoutingMemberSlot').replace('{n}', String(index + 1))}
                </Label>
                <Select
                  items={modelItems}
                  value={member}
                  onValueChange={value => {
                    const next = [...newMembers];
                    next[index] = value ?? '';
                    setNewMembers(next);
                  }}
                  disabled={disabled || !routing?.models.length}
                >
                  <SelectTrigger id={`routing-group-member-${index}`} className="w-full">
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
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={disabled || newMembers.length >= 8}
              onClick={() => setNewMembers([...newMembers, ''])}
            >
              <Plus className="size-4" />
              {i18nService.t('modelRoutingAddMember')}
            </Button>
            <Button
              type="button"
              disabled={
                disabled ||
                !newName.trim() ||
                newMembers.map(m => m.trim()).filter(Boolean).length < 2
              }
              onClick={() => void createGroup()}
            >
              <Plus className="size-4" />
              {i18nService.t('modelRoutingCreate')}
            </Button>
          </div>
        </div>
      ) : null}

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
