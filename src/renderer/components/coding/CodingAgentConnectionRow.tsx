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
import { FieldDescription } from '@shared/components/ui/field';
import { Spinner } from '@shared/components/ui/spinner';
import { ChevronDown, CheckCircle2, Info, RefreshCw } from 'lucide-react';
import { useRef, useState } from 'react';

import {
  CodingAgentCheckPhase,
  CodingAgentEnvironmentKey,
  CodingAgentProfileStatus,
  type CodingAgentProfile,
} from '../../../shared/codingAgent';
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
}

export function CodingAgentConnectionRow({
  profile,
  onProbe,
  onTrust,
  disabled,
}: CodingAgentConnectionRowProps) {
  const [pending, setPending] = useState(false);
  const [actionFailed, setActionFailed] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
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

  return (
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
            <Alert variant={failed ? 'destructive' : 'default'} role={failed ? 'alert' : 'status'}>
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
            </CollapsibleContent>
          </Collapsible>
        )}
      </CardContent>
    </Card>
  );
}
