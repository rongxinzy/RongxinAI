import { Badge } from '@shared/components/ui/badge';
import { Button } from '@shared/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shared/components/ui/select';
import { useEffect, useRef, useState } from 'react';
import type {
  MagpieAgent,
  MagpieAgents,
  MagpieModelSelection,
  MagpieStatus,
} from '../../../shared/magpie/types';
import { i18nService } from '../../services/i18n';

// Official Magpie API projections only. Upstream: yetone/magpie (MIT),
// internal/gui/api.go: /api/state, /api/agents/cli and /api/set.
// Reading management state may synchronize local CLI configuration.
function AgentModelField({
  agent,
  field,
  disabled,
  onApply,
}: {
  agent: MagpieAgent;
  field: MagpieAgent['models'][number];
  disabled: boolean;
  onApply: (selection: MagpieModelSelection) => void;
}) {
  const [value, setValue] = useState(field.value);
  useEffect(() => setValue(field.value), [field.value]);
  const options = (field.options ?? []).filter(
    (option, index, all) =>
      option.value && all.findIndex(candidate => candidate.value === option.value) === index,
  );
  if (field.value && !options.some(option => option.value === field.value)) {
    options.unshift({ value: field.value });
  }
  const label = `${agent.name} · ${field.label}`;
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        {field.label}: {field.value || i18nService.t('magpieModelUnset')}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={value || null}
          onValueChange={next => setValue(next ?? '')}
          disabled={disabled || options.length === 0}
        >
          <SelectTrigger aria-label={label} className="min-w-0 flex-1">
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
          disabled={disabled || !value || value === field.value}
          onClick={() => onApply({ agentId: agent.id, field: field.key, value })}
        >
          {i18nService.t('magpieApplyModel')}
        </Button>
      </div>
    </div>
  );
}

export function MagpieAgentsPanel() {
  const [status, setStatus] = useState<MagpieStatus | null>(null);
  const [agents, setAgents] = useState<MagpieAgents | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(false);
  const locked = useRef(false);
  const epoch = useRef(0);

  const readStatus = async () => {
    const request = epoch.current;
    try {
      const next = await window.electron.magpie.status();
      if (!mounted.current || request !== epoch.current) return;
      setStatus(next);
      if (next.state !== 'running') setAgents(null);
    } catch {
      if (!mounted.current || request !== epoch.current) return;
      setStatus(null);
      setAgents(null);
      setError('magpieActionFailed');
    }
  };

  useEffect(() => {
    mounted.current = true;
    epoch.current += 1;
    // status never launches the process or reads official management state.
    const api = window.electron?.magpie;
    if (!api) setError('magpieUnavailable');
    else void readStatus();
    const timer = window.setInterval(() => {
      if (api && !locked.current) void readStatus();
    }, 3000);
    return () => {
      mounted.current = false;
      epoch.current += 1;
      window.clearInterval(timer);
    };
  }, []);

  const run = async (action: () => Promise<void>) => {
    if (locked.current) return;
    locked.current = true;
    epoch.current += 1;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch {
      if (mounted.current) setError('magpieActionFailed');
    } finally {
      if (mounted.current) await readStatus();
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const loadManagement = async () => {
    const nextAgents = await window.electron.magpie.agents();
    if (mounted.current) {
      setAgents(nextAgents);
    }
  };
  const start = () =>
    run(async () => {
      const next = await window.electron.magpie.start();
      if (!mounted.current) return;
      setStatus(next);
      if (next.state === 'running') await loadManagement();
      else if (next.state === 'failed') setError('magpieActionFailed');
    });
  const stop = () =>
    run(async () => {
      const next = await window.electron.magpie.stop();
      if (!mounted.current) return;
      setStatus(next);
      if (next.state === 'stopped') {
        setAgents(null);
      }
    });
  const apply = (selection: MagpieModelSelection) =>
    void run(async () => {
      const next = await window.electron.magpie.setModel(selection);
      if (mounted.current) setAgents(next);
    });
  const running = status?.state === 'running';
  const transitioning = status?.state === 'starting' || status?.state === 'stopping';

  return (
    <section className="space-y-4" aria-label={i18nService.t('magpieTitle')} aria-busy={busy}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-medium">{i18nService.t('magpieTitle')}</h3>
        {status && <Badge variant="outline">{i18nService.t(`magpieState_${status.state}`)}</Badge>}
        {status?.version && <span className="text-xs text-muted-foreground">{status.version}</span>}
      </div>
      <p className="text-sm text-muted-foreground">{i18nService.t('magpieActivationNotice')}</p>
      <p className="text-xs text-muted-foreground">
        {i18nService.t(
          status?.subscriptionAccountsEnabled ? 'magpiePrivacyWithAccounts' : 'magpiePrivacyNotice',
        )}
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {i18nService.t(error)}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {(!status || transitioning) && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !window.electron?.magpie}
            onClick={() =>
              void run(async () => {
                const next = await window.electron.magpie.status();
                if (mounted.current) setStatus(next);
              })
            }
          >
            {i18nService.t('magpieCheckStatus')}
          </Button>
        )}
        {!running ? (
          <Button
            size="sm"
            disabled={!status || busy || transitioning}
            onClick={() => void start()}
          >
            {i18nService.t('magpieEnable')}
          </Button>
        ) : (
          <>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void run(loadManagement)}
            >
              {i18nService.t('magpieRefreshManagement')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void run(() => window.electron.magpie.openManagement())}
            >
              {i18nService.t('magpieOpenManagement')}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void stop()}>
              {i18nService.t('magpieStop')}
            </Button>
          </>
        )}
      </div>
      {running && (
        <>
          <p className="text-xs text-muted-foreground">{i18nService.t('magpieApplyNotice')}</p>
          {!agents && (
            <p className="text-sm text-muted-foreground">{i18nService.t('magpieNotLoaded')}</p>
          )}
          {agents?.pending && (
            <p role="status" className="text-sm text-muted-foreground">
              {i18nService.t('magpieDiscoveryPending')}
            </p>
          )}
          {agents && agents.agents.length === 0 && (
            <p className="text-sm text-muted-foreground">{i18nService.t('magpieNoAgents')}</p>
          )}
          {agents?.agents.map(agent => (
            <div key={agent.id} className="space-y-3 border-t border-border-subtle pt-3">
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="text-sm font-medium">{agent.name}</h4>
                <Badge variant="outline">
                  {i18nService.t(agent.cliMissing ? 'magpieCliMissing' : 'magpieAgentDetected')}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {agent.version || agent.appVersion || i18nService.t('magpieVersionUnknown')}
                </span>
                {agent.wired && (
                  <Badge variant="secondary">{i18nService.t('magpieConfigured')}</Badge>
                )}
              </div>
              {agent.models.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  {i18nService.t('magpieNoModelField')}
                </p>
              )}
              {agent.models.map(field => (
                <AgentModelField
                  key={field.key}
                  agent={agent}
                  field={field}
                  disabled={busy || agent.cliMissing}
                  onApply={apply}
                />
              ))}
            </div>
          ))}
        </>
      )}
      <p className="text-xs text-muted-foreground">{i18nService.t('magpieLicenseNotice')}</p>
    </section>
  );
}
