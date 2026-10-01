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
import { useRef, useState, type FormEvent } from 'react';

import {
  CodingAgentProfileStatus,
  type AddCodingAgentProfileInput,
  type CodingAgentProfile,
} from '../../../shared/codingAgent';
import { i18nService } from '../../services/i18n';
import { showAppError } from '../../services/appToast';
import {
  CodingAgentManagerTab,
  type CodingAgentManagerTab as CodingAgentManagerTabValue,
} from './constants';
import { CodingAgentConnectionRow } from './CodingAgentConnectionRow';
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
  const checking = profiles.some(isConnectionCheckRunning);
  const readyCount = profiles.filter(
    profile => profile.status === CodingAgentProfileStatus.Ready,
  ).length;
  const summary = i18nService
    .t('codingAgentManagerSummary')
    .replace('{count}', String(profiles.length))
    .replace('{ready}', String(readyCount));

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
      <DialogContent className="theme-control-sizing-4 flex h-[min(44rem,calc(100dvh-2rem))] flex-col gap-0 overflow-hidden sm:max-w-3xl">
        <DialogHeader className="theme-part-coding-agent-manager-dialog-header-1">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 space-y-2">
              <DialogTitle>{i18nService.t('codingAgentManagerTitle')}</DialogTitle>
              <DialogDescription>{summary}</DialogDescription>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
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
                  <div className="flex flex-col gap-3">
                    {profiles.map(profile => (
                      <CodingAgentConnectionRow
                        key={profile.id}
                        profile={profile}
                        disabled={discovering}
                        onProbe={onProbe}
                        onTrust={onTrust}
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
