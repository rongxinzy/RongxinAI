import { Alert, AlertDescription, AlertTitle } from '@shared/components/ui/alert';
import { Badge } from '@shared/components/ui/badge';
import { Button } from '@shared/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@shared/components/ui/card';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@shared/components/ui/collapsible';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogFooterSurface,
  DialogHeader,
  DialogTitle,
} from '@shared/components/ui/dialog';
import { FieldDescription } from '@shared/components/ui/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shared/components/ui/select';
import { Spinner } from '@shared/components/ui/spinner';
import { ChevronDown, CheckCircle2, Info, RefreshCw } from 'lucide-react';
import { useRef, useState } from 'react';

import {
  CodingAgentCheckPhase,
  CodingAgentEnvironmentKey,
  CodingAgentProfileStatus,
  type CodingAgentProfile,
} from '../../../shared/codingAgent';
import type { MagpieAgent, MagpieModelSelection } from '../../../shared/magpie/types';
import { i18nService } from '../../services/i18n';
import { CodingAgentStatusI18nKey } from './constants';
import {
  canCheckConnection,
  checkPhaseLabels,
  connectionHelpKey,
  isConnectionCheckRunning,
} from './agentConnectionFeedback';

export interface CodingAgentConnectionRowProps {
  profile: CodingAgentProfile;
  onProbe: (profileId: string) => Promise<boolean>;
  onTrust: (profileId: string) => Promise<boolean>;
  disabled?: boolean;
  magpieAgent?: MagpieAgent | null;
  onApplyMagpieModel?: (selection: MagpieModelSelection) => Promise<boolean>;
}

export function CodingAgentConnectionRow({
  profile,
  onProbe,
  onTrust,
  disabled,
  magpieAgent,
  onApplyMagpieModel,
}: CodingAgentConnectionRowProps) {
  const [pending, setPending] = useState(false);
  const [actionFailed, setActionFailed] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [selectedModels, setSelectedModels] = useState<Record<string, string>>({});
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [pendingSelection, setPendingSelection] = useState<MagpieModelSelection | null>(null);
  const [isApplyingModel, setIsApplyingModel] = useState(false);

  // Guard synchronous repeated clicks as well as the disabled render that follows.
  const actionInFlight = useRef(false);
  const running = isConnectionCheckRunning(profile);
  const busy = pending || running;
  const phase = profile.connectionCheck?.phase;
  const failed =
    phase === CodingAgentCheckPhase.Failed ||
    actionFailed ||
    profile.status === CodingAgentProfileStatus.NeedsAuth ||
    profile.status === CodingAgentProfileStatus.Unavailable ||
    profile.status === CodingAgentProfileStatus.Incompatible;
  const installedCommand =
    profile.environment[CodingAgentEnvironmentKey.CodexPath] ??
    profile.environment[CodingAgentEnvironmentKey.ClaudeCodeExecutable] ??
    profile.command;
  const managed = Boolean(profile.environment[CodingAgentEnvironmentKey.ManagedAdapterId]);
  const discovered =
    managed || Boolean(profile.environment[CodingAgentEnvironmentKey.RegistryAgentId]);
  const t = (key: string) => i18nService.t(key);

  const run = async (action: () => Promise<boolean>) => {
    if (actionInFlight.current || running || disabled) return;
    actionInFlight.current = true;
    setPending(true);
    setActionFailed(false);
    try {
      setActionFailed(!(await action()));
    } catch {
      setActionFailed(true);
    } finally {
      actionInFlight.current = false;
      setPending(false);
    }
  };

  const handleConfirmApply = async () => {
    if (!pendingSelection || !onApplyMagpieModel) return;
    setIsApplyingModel(true);
    try {
      const ok = await onApplyMagpieModel(pendingSelection);
      if (ok) {
        setConfirmDialogOpen(false);
        setPendingSelection(null);
      }
    } finally {
      setIsApplyingModel(false);
    }
  };

  return (
    <>
      <Card size="sm" aria-label={profile.name} aria-busy={busy}>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <CardTitle>{profile.name}</CardTitle>
              <Badge
                variant={
                  failed || profile.status === CodingAgentProfileStatus.Incompatible
                    ? 'destructive'
                    : 'secondary'
                }
              >
                {busy ? t('codingAgentChecking') : t(CodingAgentStatusI18nKey[profile.status])}
              </Badge>
              {magpieAgent && (
                <Badge
                  variant={magpieAgent.wired ? 'secondary' : 'outline'}
                  className="text-xs font-normal"
                >
                  {t(magpieAgent.wired ? 'magpieWiredGateway' : 'magpieDirectMode')}
                </Badge>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {profile.status === CodingAgentProfileStatus.Untrusted && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || disabled}
                  onClick={() => void run(() => onTrust(profile.id))}
                >
                  {t('codingAgentTrustAgent')}
                </Button>
              )}
              {canCheckConnection(profile) && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || disabled}
                  onClick={() => void run(() => onProbe(profile.id))}
                >
                  {busy ? (
                    <Spinner aria-hidden="true" data-icon="inline-start" />
                  ) : (
                    <RefreshCw data-icon="inline-start" />
                  )}
                  {t(
                    busy
                      ? 'codingAgentChecking'
                      : profile.status === CodingAgentProfileStatus.Ready || profile.connectionCheck
                        ? 'codingAgentRecheck'
                        : 'codingAgentProbeAgent',
                  )}
                </Button>
              )}
            </div>
          </div>
          <CardDescription>
            {t(
              profile.isBuiltin
                ? 'codingAgentBuiltinSource'
                : managed
                  ? 'codingAgentLocalConfigSource'
                  : discovered
                    ? 'codingAgentDiscoveredSource'
                    : 'codingAgentCustomSource',
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div aria-live="polite" aria-atomic="true">
            {busy ? (
              <Alert role="status">
                <Spinner aria-hidden="true" />
                <AlertTitle>
                  {t(phase && running ? checkPhaseLabels[phase] : 'codingAgentChecking')}
                </AlertTitle>
                <AlertDescription>{t('codingAgentCheckRequestHint')}</AlertDescription>
              </Alert>
            ) : phase === CodingAgentCheckPhase.Complete && !failed ? (
              <Alert role="status">
                <CheckCircle2 />
                <AlertTitle>{t('codingAgentCheckComplete')}</AlertTitle>
                <AlertDescription>{t('codingAgentCheckVerifiedHint')}</AlertDescription>
              </Alert>
            ) : !profile.isBuiltin &&
              (profile.status !== CodingAgentProfileStatus.Ready || failed) ? (
              <Alert
                variant={failed ? 'destructive' : 'default'}
                role={failed ? 'alert' : 'status'}
              >
                <Info />
                <AlertTitle>
                  {t(failed ? 'codingAgentCheckFailed' : 'codingAgentCheckNextStep')}
                </AlertTitle>
                <AlertDescription>
                  {t(
                    actionFailed && !profile.connectionCheck?.failure
                      ? 'codingAgentCheckConnectionHelp'
                      : connectionHelpKey(profile),
                  )}
                </AlertDescription>
              </Alert>
            ) : null}
            {!busy && failed && magpieAgent && !magpieAgent.wired && (
              <p className="mt-1 text-xs text-muted-foreground">{t('magpieProbeGuideNoModel')}</p>
            )}
            {!busy && profile.connectionCheck?.checkedAt && (
              <FieldDescription>
                {t('codingAgentCheckLastTime').replace(
                  '{time}',
                  new Date(profile.connectionCheck.checkedAt).toLocaleString(
                    i18nService.getLanguage() === 'zh' ? 'zh-CN' : 'en-US',
                  ),
                )}
              </FieldDescription>
            )}
          </div>
          {!profile.isBuiltin && (
            <Collapsible open={detailsOpen} onOpenChange={setDetailsOpen}>
              <CollapsibleTrigger nativeButton render={<Button size="sm" variant="ghost" />}>
                <ChevronDown data-icon="inline-start" />
                {t(detailsOpen ? 'codingAgentHideDetails' : 'codingAgentShowDetails')}
              </CollapsibleTrigger>
              <CollapsibleContent className="flex flex-col gap-2">
                <FieldDescription>{t('codingAgentInstalledPath')}</FieldDescription>
                <div className="break-all select-text">
                  {installedCommand ?? t('codingAgentNotInstalled')}
                </div>
                {profile.environment[CodingAgentEnvironmentKey.ManagedAdapterVersion] && (
                  <FieldDescription>
                    {t('codingAgentAdapterVersion').replace(
                      '{version}',
                      profile.environment[CodingAgentEnvironmentKey.ManagedAdapterVersion],
                    )}
                  </FieldDescription>
                )}
                {!discovered && profile.description && (
                  <FieldDescription>{profile.description}</FieldDescription>
                )}
                <FieldDescription>{t('codingAgentLocalConfigHelp')}</FieldDescription>

                {magpieAgent && magpieAgent.models.length > 0 && (
                  <div className="mt-3 flex flex-col gap-3 rounded-lg border border-border bg-muted/20 p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-foreground">
                        {t('magpieModelConfigTitle')}
                      </span>
                      {magpieAgent.wired ? (
                        <Badge variant="secondary" className="text-[11px] font-normal">
                          {t('magpieConfigured')}
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className="text-[11px] font-normal text-muted-foreground"
                        >
                          {t('magpieDirectMode')}
                        </Badge>
                      )}
                    </div>
                    {magpieAgent.models.map(field => {
                      const currentVal = selectedModels[field.key] ?? field.value ?? '';
                      const options = (field.options ?? []).filter(
                        (opt, idx, arr) =>
                          opt.value && arr.findIndex(o => o.value === opt.value) === idx,
                      );
                      if (field.value && !options.some(o => o.value === field.value)) {
                        options.unshift({ value: field.value });
                      }
                      return (
                        <div key={field.key} className="flex flex-col gap-1.5">
                          <div className="flex items-center justify-between text-xs text-muted-foreground">
                            <span>{field.label}</span>
                            <span className="font-mono text-[11px] text-foreground">
                              {field.value || t('magpieModelUnset')}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Select
                              value={currentVal || null}
                              onValueChange={next =>
                                setSelectedModels(prev => ({ ...prev, [field.key]: next ?? '' }))
                              }
                              disabled={
                                disabled || busy || isApplyingModel || magpieAgent.cliMissing
                              }
                            >
                              <SelectTrigger
                                aria-label={`${profile.name} · ${field.label}`}
                                className="h-8 flex-1 text-xs"
                              >
                                <SelectValue placeholder={t('magpieSelectModel')} />
                              </SelectTrigger>
                              <SelectContent>
                                {options.map(opt => (
                                  <SelectItem key={opt.value} value={opt.value} className="text-xs">
                                    {opt.label || opt.value}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 shrink-0 text-xs"
                              disabled={
                                disabled ||
                                busy ||
                                isApplyingModel ||
                                !currentVal ||
                                currentVal === field.value
                              }
                              onClick={() => {
                                setPendingSelection({
                                  agentId: magpieAgent.id,
                                  field: field.key,
                                  value: currentVal,
                                });
                                setConfirmDialogOpen(true);
                              }}
                            >
                              {t('magpieApplyModel')}
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CollapsibleContent>
            </Collapsible>
          )}
        </CardContent>
      </Card>

      <Dialog open={confirmDialogOpen} onOpenChange={setConfirmDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('magpieWireConfirmTitle')}</DialogTitle>
            <DialogDescription>{t('magpieWireConfirmDesc')}</DialogDescription>
          </DialogHeader>
          <div className="py-2 text-sm text-muted-foreground">
            <p>
              {t('magpieWireTargetAgent')}:{' '}
              <span className="font-medium text-foreground">{profile.name}</span>
            </p>
            {pendingSelection && (
              <p className="mt-1">
                {t('magpieWireTargetModel')}:{' '}
                <span className="font-mono font-medium text-foreground">
                  {pendingSelection.value}
                </span>
              </p>
            )}
          </div>
          <DialogFooter surface={DialogFooterSurface.Seamless}>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setConfirmDialogOpen(false)}
              disabled={isApplyingModel}
            >
              {t('cancel')}
            </Button>
            <Button
              type="button"
              onClick={() => void handleConfirmApply()}
              disabled={isApplyingModel}
            >
              {isApplyingModel && <Spinner data-icon="inline-start" />}
              {t('confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
