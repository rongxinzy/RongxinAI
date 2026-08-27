import { Badge } from '@shared/components/ui/badge';
import { ScrollArea } from '@shared/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@shared/components/ui/tabs';
import { Terminal } from '@shared/components/ai-elements/terminal';
import { FileDiff, Terminal as TerminalIcon } from 'lucide-react';

import { CodingEventKind, type CodingEvent } from '../../../shared/codingAgent';
import { i18nService } from '../../services/i18n';

interface CodingInspectorProps {
  events: CodingEvent[];
}

const eventText = (event: CodingEvent): string =>
  typeof event.payload.content === 'string'
    ? event.payload.content
    : JSON.stringify(event.payload, null, 2);

export const CodingInspector = ({ events }: CodingInspectorProps) => {
  const changes = events.filter(event => event.kind === CodingEventKind.FileChange);
  const terminals = events.filter(event => event.kind === CodingEventKind.Terminal);
  return (
    <Tabs defaultValue="changes" className="flex h-full min-h-0">
      <TabsList className="mx-4 mt-3">
        <TabsTrigger value="changes">
          <FileDiff data-icon="inline-start" />
          {i18nService.t('codingAgentChanges')}
        </TabsTrigger>
        <TabsTrigger value="terminal">
          <TerminalIcon data-icon="inline-start" />
          {i18nService.t('codingAgentTerminal')}
        </TabsTrigger>
      </TabsList>
      <TabsContent value="changes" className="min-h-0">
        {changes.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">
            {i18nService.t('codingAgentInspectorEmpty')}
          </p>
        ) : (
          <ScrollArea className="h-full px-4 pb-4">
            <div className="flex flex-col gap-2">
              {changes.map(event => (
                <div key={event.id} className="rounded-lg border border-border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-mono text-xs">
                      {typeof event.payload.path === 'string'
                        ? event.payload.path
                        : i18nService.t('codingAgentChanges')}
                    </span>
                    <Badge variant="secondary">{event.kind}</Badge>
                  </div>
                  <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-xs">
                    {eventText(event)}
                  </pre>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </TabsContent>
      <TabsContent value="terminal" className="min-h-0">
        {terminals.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">
            {i18nService.t('codingAgentInspectorEmpty')}
          </p>
        ) : (
          <ScrollArea className="h-full px-4 pb-4">
            <div className="flex flex-col gap-3">
              {terminals.map(event => (
                <Terminal
                  key={event.id}
                  output={eventText(event)}
                  className="rounded-lg border border-border"
                />
              ))}
            </div>
          </ScrollArea>
        )}
      </TabsContent>
    </Tabs>
  );
};
