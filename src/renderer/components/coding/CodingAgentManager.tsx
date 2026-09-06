import { Badge } from '@shared/components/ui/badge';
import { Button } from '@shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shared/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@shared/components/ui/dropdown-menu';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@shared/components/ui/empty';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@shared/components/ui/field';
import { Input } from '@shared/components/ui/input';
import { ScrollArea } from '@shared/components/ui/scroll-area';
import { Spinner } from '@shared/components/ui/spinner';
import { PageTabs } from '@shared/components/ui/page-tabs';
import { Tabs, TabsContent } from '@shared/components/ui/tabs';
import { Textarea } from '@shared/components/ui/textarea';
import { Bot, ChevronDown, Plus, RefreshCw, ShieldCheck } from 'lucide-react';
import { useState, type FormEvent } from 'react';

import {
  CodingAgentEnvironmentKey,
  CodingAgentProfileStatus,
  type AddCodingAgentProfileInput,
  type CodingAgentAuthMethod,
  type CodingAgentProfile,
} from '../../../shared/codingAgent';
import { i18nService } from '../../services/i18n';
import {
  CodingAgentManagerTab,
  CodingAgentStatusI18nKey,
  type CodingAgentManagerTab as CodingAgentManagerTabValue,
} from './constants';

interface CodingAgentManagerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profiles: CodingAgentProfile[];
  onDiscover: () => Promise<boolean>;
  onAddProfile: (input: AddCodingAgentProfileInput) => Promise<boolean>;
  onProbe: (profileId: string) => Promise<boolean>;
  onTrust: (profileId: string) => Promise<boolean>;
  onAuthenticate: (profileId: string, methodId: string) => Promise<boolean>;
  onTerminalAuthenticate: (profileId: string, methodId: string) => Promise<boolean>;
}

export const CodingAgentManager = ({
  open,
  onOpenChange,
  profiles,
  onDiscover,
  onAddProfile,
  onProbe,
  onTrust,
  onAuthenticate,
  onTerminalAuthenticate,
}: CodingAgentManagerProps) => {
  const [activeTab, setActiveTab] = useState<CodingAgentManagerTabValue>(
    CodingAgentManagerTab.Local,
  );
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [command, setCommand] = useState('');
  const [argumentsText, setArgumentsText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const readyCount = profiles.filter(
    profile => profile.status === CodingAgentProfileStatus.Ready,
  ).length;
  const summary = i18nService
    .t('codingAgentManagerSummary')
    .replace('{count}', String(profiles.length))
    .replace('{ready}', String(readyCount));

  const discover = async () => {
    setDiscovering(true);
    try {
      await onDiscover();
    } finally {
      setDiscovering(false);
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    const saved = await onAddProfile({
      name,
      description,
      command,
      args: argumentsText
        .split('\n')
        .map(argument => argument.trim())
        .filter(Boolean),
    });
    setSubmitting(false);
    if (!saved) return;
    setName('');
    setDescription('');
    setCommand('');
    setArgumentsText('');
    setActiveTab(CodingAgentManagerTab.Local);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="theme-control-sizing-4 flex h-[min(44rem,calc(100dvh-2rem))] flex-col gap-0 overflow-hidden sm:max-w-3xl">
        <DialogHeader className="theme-part-coding-agent-manager-dialog-header-1">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 space-y-2">
              <DialogTitle>{i18nService.t('codingAgentManagerTitle')}</DialogTitle>
              <DialogDescription>
                {i18nService.t('codingAgentManagerDescription')}
              </DialogDescription>
              <p className="text-xs text-muted-foreground">{summary}</p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={discovering}
              onClick={() => void discover()}
            >
              {discovering ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <RefreshCw data-icon="inline-start" />
              )}
              {i18nService.t(discovering ? 'codingAgentScanning' : 'codingAgentRescan')}
            </Button>
          </div>
        </DialogHeader>

        <Tabs
          value={activeTab}
          onValueChange={value => setActiveTab(value as CodingAgentManagerTabValue)}
          className="min-h-0 flex-1 gap-0"
        >
          <PageTabs
            bare
            value={activeTab}
            className="mx-6 mt-2 shrink-0"
            items={[
              {
                value: CodingAgentManagerTab.Local,
                label: `${i18nService.t('codingAgentLocalAgents')} (${profiles.length})`,
              },
              {
                value: CodingAgentManagerTab.Custom,
                label: i18nService.t('codingAgentCustomAgent'),
              },
            ]}
          />

          <TabsContent value={CodingAgentManagerTab.Local} className="min-h-0">
            <ScrollArea className="h-full">
              <div className="p-6 pt-4">
                {profiles.length === 0 ? (
                  <Empty className="theme-scene-coding-empty min-h-80">
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <Bot />
                      </EmptyMedia>
                      <EmptyTitle>{i18nService.t('codingAgentManagerEmptyTitle')}</EmptyTitle>
                      <EmptyDescription>
                        {i18nService.t('codingAgentManagerEmptyDescription')}
                      </EmptyDescription>
                    </EmptyHeader>
                    <EmptyContent>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setActiveTab(CodingAgentManagerTab.Custom)}
                      >
                        <Plus data-icon="inline-start" />
                        {i18nService.t('codingAgentAddCustomAgent')}
                      </Button>
                    </EmptyContent>
                  </Empty>
                ) : (
                  <div className="overflow-hidden rounded-xl border border-border">
                    {profiles.map(profile => (
                      <AgentRow
                        key={profile.id}
                        profile={profile}
                        onProbe={onProbe}
                        onTrust={onTrust}
                        onAuthenticate={onAuthenticate}
                        onTerminalAuthenticate={onTerminalAuthenticate}
                      />
                    ))}
                  </div>
                )}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value={CodingAgentManagerTab.Custom} className="min-h-0">
            <form className="flex h-full min-h-0 flex-col" onSubmit={event => void submit(event)}>
              <ScrollArea className="min-h-0 flex-1">
                <div className="p-6 pt-4">
                  <div className="mb-5 rounded-xl border border-border bg-muted/30 p-4">
                    <div className="flex gap-3">
                      <ShieldCheck className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      <div>
                        <p className="text-sm font-medium">
                          {i18nService.t('codingAgentCustomAgentTitle')}
                        </p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {i18nService.t('codingAgentCustomAgentDescription')}
                        </p>
                      </div>
                    </div>
                  </div>
                  <FieldGroup>
                    <Field>
                      <FieldLabel htmlFor="coding-agent-name">
                        {i18nService.t('codingAgentProfileName')}
                      </FieldLabel>
                      <Input
                        id="coding-agent-name"
                        value={name}
                        onChange={event => setName(event.target.value)}
                        required
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="coding-agent-description">
                        {i18nService.t('codingAgentProfileDescription')}
                      </FieldLabel>
                      <Input
                        id="coding-agent-description"
                        value={description}
                        onChange={event => setDescription(event.target.value)}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="coding-agent-command">
                        {i18nService.t('codingAgentProfileCommand')}
                      </FieldLabel>
                      <Input
                        id="coding-agent-command"
                        value={command}
                        onChange={event => setCommand(event.target.value)}
                        required
                      />
                      <FieldDescription>
                        {i18nService.t('codingAgentProfileCommandHint')}
                      </FieldDescription>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="coding-agent-arguments">
                        {i18nService.t('codingAgentProfileArguments')}
                      </FieldLabel>
                      <Textarea
                        id="coding-agent-arguments"
                        className="theme-control-sizing-5"
                        value={argumentsText}
                        onChange={event => setArgumentsText(event.target.value)}
                      />
                      <FieldDescription>
                        {i18nService.t('codingAgentProfileArgumentsHint')}
                      </FieldDescription>
                    </Field>
                  </FieldGroup>
                </div>
              </ScrollArea>
              <DialogFooter className="theme-part-coding-agent-manager-dialog-footer-1 mx-0 mb-0 shrink-0">
                <Button type="submit" disabled={submitting}>
                  {submitting && <Spinner data-icon="inline-start" />}
                  {i18nService.t('codingAgentAddProfile')}
                </Button>
              </DialogFooter>
            </form>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};

interface AgentRowProps {
  profile: CodingAgentProfile;
  onProbe: (profileId: string) => Promise<boolean>;
  onTrust: (profileId: string) => Promise<boolean>;
  onAuthenticate: (profileId: string, methodId: string) => Promise<boolean>;
  onTerminalAuthenticate: (profileId: string, methodId: string) => Promise<boolean>;
}

const AgentRow = ({
  profile,
  onProbe,
  onTrust,
  onAuthenticate,
  onTerminalAuthenticate,
}: AgentRowProps) => {
  const installedCommand =
    profile.environment[CodingAgentEnvironmentKey.CodexPath] ??
    profile.environment[CodingAgentEnvironmentKey.ClaudeCodeExecutable] ??
    profile.command;
  return (
    <div className="flex min-w-0 items-center gap-3 border-b border-border px-4 py-3 last:border-b-0">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <Bot className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <p className="truncate text-sm font-medium">{profile.name}</p>
          <Badge
            variant={
              profile.status === CodingAgentProfileStatus.Incompatible ? 'destructive' : 'secondary'
            }
          >
            {i18nService.t(CodingAgentStatusI18nKey[profile.status])}
          </Badge>
        </div>
        {profile.description && (
          <p className="mt-0.5 truncate text-sm text-muted-foreground">{profile.description}</p>
        )}
        {installedCommand && (
          <p
            className="mt-1 truncate font-mono text-xs text-muted-foreground"
            title={installedCommand}
          >
            {installedCommand}
          </p>
        )}
      </div>
      <AgentRowAction
        profile={profile}
        onProbe={onProbe}
        onTrust={onTrust}
        onAuthenticate={onAuthenticate}
        onTerminalAuthenticate={onTerminalAuthenticate}
      />
    </div>
  );
};

const AgentRowAction = ({
  profile,
  onProbe,
  onTrust,
  onAuthenticate,
  onTerminalAuthenticate,
}: AgentRowProps) => {
  const [pending, setPending] = useState(false);
  const run = async (action: () => Promise<boolean>) => {
    setPending(true);
    try {
      await action();
    } finally {
      setPending(false);
    }
  };
  const authenticate = (method: CodingAgentAuthMethod) =>
    method.type === 'terminal'
      ? onTerminalAuthenticate(profile.id, method.id)
      : onAuthenticate(profile.id, method.id);

  if (profile.status === CodingAgentProfileStatus.Untrusted) {
    return (
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() => void run(() => onTrust(profile.id))}
      >
        {pending && <Spinner data-icon="inline-start" />}
        {i18nService.t('codingAgentTrustAgent')}
      </Button>
    );
  }
  if (
    profile.command &&
    (profile.status === CodingAgentProfileStatus.Detected ||
      profile.status === CodingAgentProfileStatus.Unavailable)
  ) {
    return (
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() => void run(() => onProbe(profile.id))}
      >
        {pending && <Spinner data-icon="inline-start" />}
        {i18nService.t('codingAgentProbeAgent')}
      </Button>
    );
  }
  if (profile.status === CodingAgentProfileStatus.NeedsAuth) {
    // A stale NeedsAuth flag can survive an agent upgrade or a completed
    // terminal login, so always offer re-probing as a self-healing path.
    const probeButton = profile.command ? (
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() => void run(() => onProbe(profile.id))}
      >
        {pending && <Spinner data-icon="inline-start" />}
        {i18nService.t('codingAgentProbeAgent')}
      </Button>
    ) : null;
    if (profile.authMethods.length === 0) return probeButton;
    const authControl =
      profile.authMethods.length === 1 ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => void run(() => authenticate(profile.authMethods[0]))}
        >
          {pending && <Spinner data-icon="inline-start" />}
          {i18nService.t('codingAgentAuthenticate')}
        </Button>
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger
            nativeButton
            render={
              <Button type="button" size="sm" variant="outline" disabled={pending}>
                {pending ? <Spinner data-icon="inline-start" /> : null}
                {i18nService.t('codingAgentAuthenticate')}
                <ChevronDown data-icon="inline-end" />
              </Button>
            }
          />
          <DropdownMenuContent align="end">
            {profile.authMethods.map(method => (
              <DropdownMenuItem
                key={method.id}
                onClick={() => void run(() => authenticate(method))}
              >
                {method.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      );
    return (
      <div className="flex items-center gap-1.5">
        {probeButton}
        {authControl}
      </div>
    );
  }
  return null;
};
