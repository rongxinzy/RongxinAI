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
import { Bot, Plus, RefreshCw, ShieldCheck } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';

import {
  CodingAgentProfileStatus,
  type AddCodingAgentProfileInput,
  type CodingAgentProfile,
} from '../../../shared/codingAgent';
import type { MagpieAgents, MagpieModelSelection } from '../../../shared/magpie/types';
import { i18nService } from '../../services/i18n';
import { showAppError } from '../../services/appToast';
import {
  CodingAgentManagerTab,
  type CodingAgentManagerTab as CodingAgentManagerTabValue,
} from './constants';
import { CodingAgentConnectionRow } from './CodingAgentConnectionRow';
import { MagpieAgentsPanel } from './MagpieAgentsPanel';
import { isConnectionCheckRunning } from './agentConnectionFeedback';

interface CodingAgentManagerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profiles: CodingAgentProfile[];
  onDiscover: () => Promise<boolean>;
  onAddProfile: (input: AddCodingAgentProfileInput) => Promise<boolean>;
  onProbe: (profileId: string) => Promise<boolean>;
  onTrust: (profileId: string) => Promise<boolean>;
}

export const CodingAgentManager = ({
  open,
  onOpenChange,
  profiles,
  onDiscover,
  onAddProfile,
  onProbe,
  onTrust,
}: CodingAgentManagerProps) => {
  const [activeTab, setActiveTab] = useState<CodingAgentManagerTabValue>(
    CodingAgentManagerTab.Local,
  );
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [command, setCommand] = useState('');
  const [argumentsText, setArgumentsText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const submissionInFlight = useRef(false);
  const [discovering, setDiscovering] = useState(false);
  const discoveryInFlight = useRef(false);
  const [magpieAgents, setMagpieAgents] = useState<MagpieAgents | null>(null);
  const checking = profiles.some(isConnectionCheckRunning);
  const readyCount = profiles.filter(
    profile => profile.status === CodingAgentProfileStatus.Ready,
  ).length;
  const summary = i18nService
    .t('codingAgentManagerSummary')
    .replace('{count}', String(profiles.length))
    .replace('{ready}', String(readyCount));

  useEffect(() => {
    if (open && window.electron?.magpie?.agents) {
      void window.electron.magpie
        .agents()
        .then(res => {
          setMagpieAgents(res);
        })
        .catch(() => {
          /* ignore */
        });
    }
  }, [open]);

  const handleApplyMagpieModel = async (selection: MagpieModelSelection) => {
    if (!window.electron?.magpie?.setModel) return false;
    try {
      const updated = await window.electron.magpie.setModel(selection);
      setMagpieAgents(updated);
      return true;
    } catch (err: unknown) {
      showAppError(err instanceof Error ? err.message : 'Apply model failed');
      return false;
    }
  };

  const findMagpieAgent = (profile: CodingAgentProfile) => {
    if (!magpieAgents?.agents) return null;
    const id = profile.id.toLowerCase();
    const name = profile.name.toLowerCase();
    return (
      magpieAgents.agents.find(
        a =>
          a.id.toLowerCase() === id ||
          a.name.toLowerCase() === name ||
          (id.includes('codex') && a.id === 'codex') ||
          (id.includes('claude') && a.id === 'claude'),
      ) ?? null
    );
  };

  const discover = async () => {
    if (discoveryInFlight.current || checking) return;
    discoveryInFlight.current = true;
    setDiscovering(true);
    try {
      await onDiscover();
    } catch (error) {
      showAppError(error, 'codingAgentActionFailed');
    } finally {
      discoveryInFlight.current = false;
      setDiscovering(false);
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submissionInFlight.current) return;
    submissionInFlight.current = true;
    setSubmitting(true);
    try {
      const saved = await onAddProfile({
        name,
        description,
        command,
        args: argumentsText
          .split('\n')
          .map(argument => argument.trim())
          .filter(Boolean),
      });
      if (!saved) return;
      setName('');
      setDescription('');
      setCommand('');
      setArgumentsText('');
      setActiveTab(CodingAgentManagerTab.Local);
    } catch (error) {
      showAppError(error, 'codingAgentActionFailed');
    } finally {
      submissionInFlight.current = false;
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="theme-control-sizing-4 flex h-[min(42rem,calc(100dvh-2rem))] flex-col gap-0 overflow-hidden sm:max-w-2xl">
        <DialogHeader className="theme-part-coding-agent-manager-dialog-header-1 shrink-0">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 space-y-1">
              <DialogTitle className="text-base font-semibold text-foreground">
                {i18nService.t('codingAgentManagerTitle')}
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                {activeTab === CodingAgentManagerTab.Magpie
                  ? i18nService.t('magpieExternalPanelDescription')
                  : summary}
              </DialogDescription>
            </div>
            {activeTab !== CodingAgentManagerTab.Magpie && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="shrink-0"
                disabled={discovering || checking}
                onClick={() => void discover()}
              >
                {discovering ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <RefreshCw data-icon="inline-start" />
                )}
                {i18nService.t(discovering ? 'codingAgentScanning' : 'codingAgentRescan')}
              </Button>
            )}
          </div>
        </DialogHeader>

        <Tabs
          value={activeTab}
          onValueChange={value => setActiveTab(value as CodingAgentManagerTabValue)}
          className="min-h-0 flex-1 flex flex-col gap-0"
        >
          <div className="shrink-0 border-b border-border-subtle px-6">
            <PageTabs
              bare
              value={activeTab}
              className="gap-6"
              items={[
                {
                  value: CodingAgentManagerTab.Local,
                  label: `${i18nService.t('codingAgentLocalAgents')} (${profiles.length})`,
                },
                {
                  value: CodingAgentManagerTab.Custom,
                  label: i18nService.t('codingAgentCustomAgent'),
                },
                { value: CodingAgentManagerTab.Magpie, label: i18nService.t('magpieTitle') },
              ]}
            />
          </div>

          <TabsContent value={CodingAgentManagerTab.Local} className="min-h-0 flex-1 flex flex-col">
            <ScrollArea className="h-full">
              <div className="p-6">
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
                  <div className="flex flex-col gap-3">
                    {profiles.map(profile => (
                      <CodingAgentConnectionRow
                        key={profile.id}
                        profile={profile}
                        disabled={discovering}
                        onProbe={onProbe}
                        onTrust={onTrust}
                        magpieAgent={findMagpieAgent(profile)}
                        onApplyMagpieModel={handleApplyMagpieModel}
                      />
                    ))}
                  </div>
                )}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent
            value={CodingAgentManagerTab.Magpie}
            className="min-h-0 flex-1 flex flex-col"
          >
            <ScrollArea className="h-full">
              <div className="p-6">
                {open && activeTab === CodingAgentManagerTab.Magpie && <MagpieAgentsPanel />}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent
            value={CodingAgentManagerTab.Custom}
            className="min-h-0 flex-1 flex flex-col"
          >
            <form className="flex h-full min-h-0 flex-col" onSubmit={event => void submit(event)}>
              <ScrollArea className="min-h-0 flex-1">
                <div className="p-6">
                  <div className="mb-4 flex items-start gap-3 rounded-lg border border-border-subtle bg-muted/20 p-3.5">
                    <ShieldCheck className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <div className="space-y-0.5">
                      <p className="text-xs font-medium text-foreground">
                        {i18nService.t('codingAgentCustomAgentTitle')}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {i18nService.t('codingAgentCustomAgentDescription')}
                      </p>
                    </div>
                  </div>
                  <FieldGroup className="space-y-3.5">
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
                        className="theme-control-sizing-5 min-h-[5rem]"
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
              <DialogFooter className="theme-part-coding-agent-manager-dialog-footer-1 mx-0 mb-0 shrink-0 border-t border-border-subtle px-6 py-3 flex items-center justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setActiveTab(CodingAgentManagerTab.Local)}
                >
                  {i18nService.t('cancel')}
                </Button>
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
