import { Badge } from '@shared/components/ui/badge';
import { Button } from '@shared/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shared/components/ui/select';
import { Switch } from '@shared/components/ui/switch';
import type { LucideIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import type { MagpieExternalAgentId } from '../../../shared/magpie/constants';
import type { MagpieAgent, MagpieModelSelection } from '../../../shared/magpie/types';
import { i18nService } from '../../services/i18n';

function primaryModelField(agent: MagpieAgent | undefined) {
  if (!agent?.models.length) return undefined;
  return agent.models.find(field => field.key === 'model') ?? agent.models[0];
}

function countConfiguredModels(agent: MagpieAgent | undefined): number {
  if (!agent?.models.length) return 0;
  return agent.models.filter(field => field.value.trim()).length;
}

export interface ExternalAgentRowProps {
  catalogId: MagpieExternalAgentId;
  labelKey: string;
  icon: LucideIcon;
  agent?: MagpieAgent;
  busy: boolean;
  onToggle: (next: boolean) => void;
  onApplyModel: (selection: MagpieModelSelection) => Promise<void>;
}

export function ExternalAgentRow({
  catalogId,
  labelKey,
  icon: Icon,
  agent,
  busy,
  onToggle,
  onApplyModel,
}: ExternalAgentRowProps) {
  const field = primaryModelField(agent);
  const [draftValue, setDraftValue] = useState(field?.value ?? '');
  useEffect(() => setDraftValue(field?.value ?? ''), [field?.value]);

  const options = useMemo(() => {
    if (!field) return [];
    const list = (field.options ?? []).filter(
      (option, index, all) =>
        option.value && all.findIndex(candidate => candidate.value === option.value) === index,
    );
    if (field.value && !list.some(option => option.value === field.value)) {
      list.unshift({ value: field.value });
    }
    return list;
  }, [field]);

  const statusKey =
    !agent || agent.cliMissing
      ? 'magpieExternalStatusMissing'
      : agent.wired
        ? 'magpieExternalStatusConnected'
        : 'magpieExternalStatusDisconnected';

  const statusDetail =
    agent?.wired && !agent.cliMissing
      ? i18nService
          .t('magpieExternalStatusConnectedDetail')
          .replace('{count}', String(countConfiguredModels(agent)))
      : undefined;

  const upstreamId = agent?.id ?? catalogId;
  const version = agent?.version || agent?.appVersion;

  const applyDraft = async () => {
    if (!field || !draftValue || draftValue === field.value) return;
    await onApplyModel({ agentId: upstreamId, field: field.key, value: draftValue });
  };

  return (
    <div className="flex flex-col gap-3 border-t border-border-subtle pt-4 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-center gap-3">
        <Icon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-sm font-medium">{i18nService.t(labelKey)}</h4>
            <Badge variant="outline">{i18nService.t(statusKey)}</Badge>
            {statusDetail && <span className="text-xs text-muted-foreground">{statusDetail}</span>}
            {agent?.reapplyError && (
              <Badge variant="destructive">{i18nService.t('magpieExternalReapplyError')}</Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {version
              ? i18nService.t('magpieExternalVersion').replace('{version}', version)
              : i18nService.t('magpieVersionUnknown')}
          </p>
        </div>
        <Switch
          checked={Boolean(agent?.wired)}
          disabled={busy || !agent || agent.cliMissing}
          aria-label={i18nService
            .t('magpieExternalToggleLabel')
            .replace('{name}', i18nService.t(labelKey))}
          onCheckedChange={onToggle}
        />
      </div>
      {field && !agent?.cliMissing && (
        <div className="flex flex-wrap items-center gap-2 pl-8">
          <Select
            value={draftValue || null}
            onValueChange={value => setDraftValue(value ?? '')}
            disabled={busy || options.length === 0}
          >
            <SelectTrigger
              className="min-w-0 flex-1"
              aria-label={i18nService.t('magpieSelectModel')}
            >
              <SelectValue placeholder={i18nService.t('magpieSelectModel')} />
            </SelectTrigger>
            <SelectContent>
              {options.map(option => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label || option.value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !draftValue || draftValue === field.value}
            onClick={() => void applyDraft()}
          >
            {i18nService.t('magpieApplyModel')}
          </Button>
        </div>
      )}
    </div>
  );
}
