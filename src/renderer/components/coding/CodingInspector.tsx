import { Terminal } from '@shared/components/ai-elements/terminal';
import { Badge } from '@shared/components/ui/badge';
import { ScrollArea } from '@shared/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@shared/components/ui/tabs';
import { FileDiff, Terminal as TerminalIcon } from 'lucide-react';
import { useEffect, useState } from 'react';

import { CodingEventKind, type CodingEvent } from '../../../shared/codingAgent';
import { i18nService } from '../../services/i18n';
import { CodingInspectorTab, type CodingInspectorTab as CodingInspectorTabType } from './constants';
import { getCodingEventText } from './codingEventProjection';

interface CodingInspectorProps {
  events: CodingEvent[];
}

const eventText = (event: CodingEvent): string => {
  const content = getCodingEventText(event);
  if (content) return content;
  return Object.keys(event.payload).length > 0 ? JSON.stringify(event.payload, null, 2) : '';
};

export const CodingInspector = ({ events }: CodingInspectorProps) => {
  const changes = events.filter(event => event.kind === CodingEventKind.FileChange);
  const terminals = events.filter(event => event.kind === CodingEventKind.Terminal);
  const preferredTab =
    changes.length > 0 ? CodingInspectorTab.Changes : CodingInspectorTab.Terminal;
  const [activeTab, setActiveTab] = useState<CodingInspectorTabType>(preferredTab);

  useEffect(() => {
    if (activeTab === CodingInspectorTab.Changes && changes.length === 0) {
      setActiveTab(CodingInspectorTab.Terminal);
    } else if (activeTab === CodingInspectorTab.Terminal && terminals.length === 0) {
      setActiveTab(CodingInspectorTab.Changes);
    }
  }, [activeTab, changes.length, terminals.length]);

  return (
    <Tabs
      value={activeTab}
      onValueChange={value => {
        if (value === CodingInspectorTab.Changes || value === CodingInspectorTab.Terminal) {
          setActiveTab(value);
        }
      }}
      className="h-full min-h-0"
    >
      <TabsList variant="line" className="mx-4 mt-3">
        <TabsTrigger value={CodingInspectorTab.Changes} disabled={changes.length === 0}>
          <FileDiff data-icon="inline-start" />
          {i18nService.t('codingAgentChanges')}
          {changes.length > 0 && <Badge variant="secondary">{changes.length}</Badge>}
        </TabsTrigger>
        <TabsTrigger value={CodingInspectorTab.Terminal} disabled={terminals.length === 0}>
          <TerminalIcon data-icon="inline-start" />
          {i18nService.t('codingAgentTerminal')}
          {terminals.length > 0 && <Badge variant="secondary">{terminals.length}</Badge>}
        </TabsTrigger>
      </TabsList>
      <TabsContent value={CodingInspectorTab.Changes} className="min-h-0">
        <ScrollArea className="h-full px-4 pb-4">
          <div className="flex flex-col gap-2">
            {changes.map(event => (
              <div key={event.id} className="rounded-lg border border-border p-3">
                <span className="block truncate font-mono text-xs font-medium">
                  {typeof event.payload.path === 'string'
                    ? event.payload.path
                    : i18nService.t('codingAgentChanges')}
                </span>
                {eventText(event) && (
                  <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-xs text-muted-foreground">
                    {eventText(event)}
                  </pre>
                )}
              </div>
            ))}
          </div>
        </ScrollArea>
      </TabsContent>
      <TabsContent value={CodingInspectorTab.Terminal} className="min-h-0">
        <ScrollArea className="h-full px-4 pb-4">
          <div className="flex flex-col gap-3">
            {terminals.map(event => (
              <Terminal key={event.id} output={eventText(event)} />
            ))}
          </div>
        </ScrollArea>
      </TabsContent>
    </Tabs>
  );
};
