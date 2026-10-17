import { Alert, AlertDescription } from '@shared/components/ui/alert';
import { Button } from '@shared/components/ui/button';
import { Checkbox } from '@shared/components/ui/checkbox';
import { DestructiveConfirmDialog } from '@shared/components/ui/destructive-confirm-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shared/components/ui/dialog';
import { Field, FieldDescription, FieldLabel } from '@shared/components/ui/field';
import { Bot, Code2, RefreshCw, Sparkles, Terminal, Workflow } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  MAGPIE_EXTERNAL_AGENT_CATALOG,
  MagpieExternalAgentId,
  resolveMagpieExternalAgentRowId,
} from '../../../shared/magpie/constants';
import type {
  MagpieAgent,
  MagpieAgentConnectPreview,
  MagpieAgents,
  MagpieModelSelection,
  MagpieStatus,
} from '../../../shared/magpie/types';
import { localStore } from '../../services/store';
import { i18nService } from '../../services/i18n';
import { ExternalAgentRow } from './ExternalAgentRow';

const STORE_DISCONNECT_ON_QUIT = 'magpie_disconnect_external_on_quit';

const ROW_META: Record<
  MagpieExternalAgentId,
  { labelKey: string; icon: typeof Bot; connectHintKey: string }
> = {
  [MagpieExternalAgentId.ClaudeCode]: {
    labelKey: 'magpieExternalAgentClaude',
    icon: Sparkles,
    connectHintKey: 'magpieExternalConnectHintClaude',
  },
  [MagpieExternalAgentId.OpenCode]: {
    labelKey: 'magpieExternalAgentOpenCode',
    icon: Workflow,
    connectHintKey: 'magpieExternalConnectHintOpenCode',
  },
  [MagpieExternalAgentId.Gemini]: {
    labelKey: 'magpieExternalAgentGemini',
    icon: Bot,
    connectHintKey: 'magpieExternalConnectHintGemini',
  },
  [MagpieExternalAgentId.Pi]: {
    labelKey: 'magpieExternalAgentPi',
    icon: Terminal,
    connectHintKey: 'magpieExternalConnectHintPi',
  },
  [MagpieExternalAgentId.Codex]: {
    labelKey: 'magpieExternalAgentCodex',
    icon: Code2,
    connectHintKey: 'magpieExternalConnectHintCodex',
  },
};

function findCatalogAgent(
  agents: MagpieAgent[],
  catalogId: MagpieExternalAgentId,
): MagpieAgent | undefined {
  const entry = MAGPIE_EXTERNAL_AGENT_CATALOG.find(row => row.id === catalogId);
  if (!entry) return undefined;
  return agents.find(agent => entry.upstreamIds.includes(agent.id));
}

export function MagpieAgentsPanel() {
  const [status, setStatus] = useState<MagpieStatus | null>(null);
  const [agents, setAgents] = useState<MagpieAgents | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [disconnectOnQuit, setDisconnectOnQuit] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmMode, setConfirmMode] = useState<'connect' | 'disconnect'>('connect');
  const [pendingAgentId, setPendingAgentId] = useState<string | null>(null);
  const [preview, setPreview] = useState<MagpieAgentConnectPreview | null>(null);
  const [disconnectAllOpen, setDisconnectAllOpen] = useState(false);
  const mounted = useRef(false);
  const locked = useRef(false);
  const epoch = useRef(0);

  const api = window.electron?.magpie;

  const readStatus = useCallback(async () => {
    if (!api) return;
    const request = epoch.current;
    try {
      const next = await api.status();
      if (!mounted.current || request !== epoch.current) return;
      setStatus(next);
      if (next.state !== 'running') setAgents(null);
    } catch {
      if (!mounted.current || request !== epoch.current) return;
      setStatus(null);
      setAgents(null);
      setError('magpieActionFailed');
    }
  }, [api]);

  const loadAgents = useCallback(async () => {
    if (!api) return;
    const next = await api.agents();
    if (mounted.current) setAgents(next);
  }, [api]);

  useEffect(() => {
    mounted.current = true;
    epoch.current += 1;
    if (!api) setError('magpieUnavailable');
    else void readStatus();
    void localStore.getItem<boolean>(STORE_DISCONNECT_ON_QUIT).then(value => {
      if (mounted.current) setDisconnectOnQuit(value === true);
    });
    const timer = window.setInterval(() => {
      if (api && !locked.current) void readStatus();
    }, 3000);
    return () => {
      mounted.current = false;
      epoch.current += 1;
      window.clearInterval(timer);
    };
  }, [api, readStatus]);

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

  const running = status?.state === 'running';
  const catalogAgents = useMemo(() => {
    const list = agents?.agents ?? [];
    // Pi is the embedded runtime; it is internal and never exposed as a
    // user-facing external Agent.
    return MAGPIE_EXTERNAL_AGENT_CATALOG.filter(entry => entry.id !== MagpieExternalAgentId.Pi).map(
      entry => ({
        entry,
        agent: findCatalogAgent(list, entry.id),
      }),
    );
  }, [agents]);
  const hasConnectedAgent = agents?.agents.some(agent => agent.wired) === true;
  const hasDetectedAgent = catalogAgents.some(({ agent }) => Boolean(agent));

  const beginToggle = async (catalogId: MagpieExternalAgentId, next: boolean) => {
    const agent = findCatalogAgent(agents?.agents ?? [], catalogId);
    if (!agent || agent.cliMissing) return;
    const upstreamId = agent.id;
    setPendingAgentId(upstreamId);
    setConfirmMode(next ? 'connect' : 'disconnect');
    setPreview(null);
    if (!next && api?.previewAgent) {
      try {
        setPreview(await api.previewAgent(upstreamId));
      } catch {
        setPreview({ changes: [], error: 'preview failed' });
      }
    }
    setConfirmOpen(true);
  };

  const confirmToggle = async () => {
    if (!api || !pendingAgentId) return;
    await run(async () => {
      if (confirmMode === 'connect') {
        const next = await api.connectAgent(pendingAgentId);
        if (mounted.current) setAgents(next);
      } else {
        const next = await api.disconnectAgent(pendingAgentId);
        if (mounted.current) setAgents(next);
      }
      setConfirmOpen(false);
      setPendingAgentId(null);
      setPreview(null);
    });
  };

  const applyModel = async (selection: MagpieModelSelection) => {
    if (!api?.setModel) return;
    await run(async () => {
      const next = await api.setModel(selection);
      if (mounted.current) setAgents(next);
    });
  };

  const catalogIdForPending = pendingAgentId
    ? resolveMagpieExternalAgentRowId(pendingAgentId)
    : null;

  return (
    <section className="space-y-4" aria-label={i18nService.t('magpieTitle')} aria-busy={busy}>
      <Alert>
        <AlertDescription>{i18nService.t('magpieExternalKeepRunningNotice')}</AlertDescription>
      </Alert>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {i18nService.t(error)}
        </p>
      )}

      {!running && (
        <p className="text-sm text-muted-foreground">
          {i18nService.t('magpieExternalServiceRequired')}
        </p>
      )}

      {running && (
        <>
          {!agents ? (
            <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed border-border px-4 py-5">
              <p className="text-sm text-muted-foreground">{i18nService.t('magpieNotLoaded')}</p>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => void run(loadAgents)}
              >
                <RefreshCw data-icon="inline-start" />
                {i18nService.t('magpieRefreshManagement')}
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                {!hasDetectedAgent ? (
                  <p className="text-sm text-muted-foreground">{i18nService.t('magpieNoAgents')}</p>
                ) : null}
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => void run(loadAgents)}
                  >
                    <RefreshCw data-icon="inline-start" />
                    {i18nService.t('magpieRefreshManagement')}
                  </Button>
                  {hasConnectedAgent ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => setDisconnectAllOpen(true)}
                    >
                      {i18nService.t('magpieExternalDisconnectAll')}
                    </Button>
                  ) : null}
                </div>
              </div>
              {agents.pending && (
                <p role="status" className="text-sm text-muted-foreground">
                  {i18nService.t('magpieDiscoveryPending')}
                </p>
              )}
              {hasDetectedAgent ? (
                <div className="flex flex-col gap-4">
                  {catalogAgents.map(({ entry, agent }) => (
                    <ExternalAgentRow
                      key={entry.id}
                      catalogId={entry.id}
                      labelKey={ROW_META[entry.id].labelKey}
                      icon={ROW_META[entry.id].icon}
                      agent={agent}
                      busy={busy}
                      onToggle={next => void beginToggle(entry.id, next)}
                      onApplyModel={applyModel}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          )}
        </>
      )}

      <Field className="gap-2">
        <div className="flex items-start gap-2">
          <Checkbox
            id="magpie-disconnect-on-quit"
            checked={disconnectOnQuit}
            disabled={busy}
            onCheckedChange={checked => {
              const value = checked === true;
              setDisconnectOnQuit(value);
              void localStore.setItem(STORE_DISCONNECT_ON_QUIT, value);
            }}
          />
          <div className="space-y-1">
            <FieldLabel htmlFor="magpie-disconnect-on-quit">
              {i18nService.t('magpieExternalDisconnectOnQuit')}
            </FieldLabel>
            <FieldDescription>
              {i18nService.t('magpieExternalDisconnectOnQuitHint')}
            </FieldDescription>
          </div>
        </div>
      </Field>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {i18nService.t(
                confirmMode === 'connect'
                  ? 'magpieExternalConnectConfirmTitle'
                  : 'magpieExternalDisconnectConfirmTitle',
              )}
            </DialogTitle>
            <DialogDescription>
              {catalogIdForPending && i18nService.t(ROW_META[catalogIdForPending].connectHintKey)}
              {status?.gatewayUrl && (
                <span className="mt-2 block text-xs">
                  {i18nService.t('magpieExternalGatewayTarget').replace('{url}', status.gatewayUrl)}
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          {confirmMode === 'disconnect' && preview && preview.changes.length > 0 && (
            <ul className="max-h-48 space-y-2 overflow-y-auto text-sm text-muted-foreground">
              {preview.changes.map(change => (
                <li key={change.path}>
                  <span className="font-medium text-foreground">{change.path}</span>
                  {change.lines?.map((line, index) => (
                    <div key={`${change.path}-${index}`}>
                      {line.op} {line.text ?? line.was}
                    </div>
                  ))}
                </li>
              ))}
            </ul>
          )}
          {preview?.error && <p className="text-sm text-destructive">{preview.error}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              {i18nService.t('magpieExternalCancel')}
            </Button>
            <Button disabled={busy} onClick={() => void confirmToggle()}>
              {i18nService.t(
                confirmMode === 'connect'
                  ? 'magpieExternalConnectConfirmAction'
                  : 'magpieExternalDisconnectConfirmAction',
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DestructiveConfirmDialog
        open={disconnectAllOpen}
        title={i18nService.t('magpieExternalDisconnectAllTitle')}
        description={i18nService.t('magpieExternalDisconnectAllDescription')}
        cancelLabel={i18nService.t('magpieExternalCancel')}
        confirmLabel={i18nService.t('magpieExternalDisconnectAll')}
        isConfirming={busy}
        onCancel={() => setDisconnectAllOpen(false)}
        onConfirm={() => {
          setDisconnectAllOpen(false);
          void run(async () => {
            if (!api?.disconnectAllAgents) return;
            const next = await api.disconnectAllAgents();
            if (mounted.current) setAgents(next);
          });
        }}
      />
    </section>
  );
}
