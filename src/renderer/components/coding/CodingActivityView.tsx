import { CodeBlock } from '@shared/components/ai-elements/code-block';
import { Tool, ToolContent, ToolHeader } from '@shared/components/ai-elements/tool';
import { Badge } from '@shared/components/ui/badge';
import {
  Brain,
  CheckCircle2,
  Circle,
  FileText,
  FolderInput,
  FolderOpen,
  Globe,
  Loader2,
  Pencil,
  Repeat,
  Search,
  Terminal,
  Trash2,
  Wrench,
} from 'lucide-react';
import { memo, type ReactNode } from 'react';

import { i18nService } from '../../services/i18n';
import type { Artifact } from '../../types/artifact';
import ArtifactPreviewCard from '../artifacts/ArtifactPreviewCard';
import { CodingDiffView } from './CodingDiffView';
import { getCodingEventText, type CodingConversationActivity } from './codingEventProjection';
import {
  parsePlanEntries,
  parseToolCallView,
  hasToolCallDetails,
  type CodingToolCallLocation,
} from './codingToolCall';
import {
  CodingConversationActivityKind,
  CodingExternalActivityStatus,
  CodingToolPartState,
  type CodingToolPartState as CodingToolPartStateType,
} from './constants';

const TOOL_KIND_ICON: Record<string, ReactNode> = {
  read: <FileText className="size-4 text-muted-foreground" />,
  edit: <Pencil className="size-4 text-muted-foreground" />,
  delete: <Trash2 className="size-4 text-muted-foreground" />,
  move: <FolderInput className="size-4 text-muted-foreground" />,
  search: <Search className="size-4 text-muted-foreground" />,
  execute: <Terminal className="size-4 text-muted-foreground" />,
  think: <Brain className="size-4 text-muted-foreground" />,
  fetch: <Globe className="size-4 text-muted-foreground" />,
  switch_mode: <Repeat className="size-4 text-muted-foreground" />,
};

const TOOL_KIND_I18N_KEY: Record<string, string> = {
  read: 'codingAgentToolKindRead',
  edit: 'codingAgentToolKindEdit',
  delete: 'codingAgentToolKindDelete',
  move: 'codingAgentToolKindMove',
  search: 'codingAgentToolKindSearch',
  execute: 'codingAgentToolKindExecute',
  think: 'codingAgentToolKindThink',
  fetch: 'codingAgentToolKindFetch',
  switch_mode: 'codingAgentToolKindSwitchMode',
  other: 'codingAgentToolKindOther',
};

const toolKindIcon = (kind: string | null): ReactNode =>
  (kind && TOOL_KIND_ICON[kind]) ?? <Wrench className="size-4 text-muted-foreground" />;

const toolKindLabel = (kind: string | null): string | null =>
  kind ? i18nService.t(TOOL_KIND_I18N_KEY[kind] ?? 'codingAgentToolKindOther') : null;

const activityState = (activity: CodingConversationActivity): CodingToolPartStateType => {
  if (activity.kind === CodingConversationActivityKind.Permission) {
    return CodingToolPartState.ApprovalRequested;
  }
  const status = activity.event.payload.status;
  if (status === CodingExternalActivityStatus.Failed) return CodingToolPartState.OutputError;
  if (status === CodingExternalActivityStatus.Completed) return CodingToolPartState.OutputAvailable;
  if (status === CodingExternalActivityStatus.Pending) return CodingToolPartState.InputStreaming;
  return CodingToolPartState.InputAvailable;
};

const activityStatusLabel = (state: CodingToolPartStateType): string => {
  const keys = {
    [CodingToolPartState.ApprovalRequested]: 'codingAgentPermissionEvent',
    [CodingToolPartState.InputAvailable]: 'codingAgentToolRunning',
    [CodingToolPartState.InputStreaming]: 'codingAgentToolPending',
    [CodingToolPartState.OutputAvailable]: 'codingAgentToolCompleted',
    [CodingToolPartState.OutputError]: 'codingAgentToolFailed',
  } as const;
  return i18nService.t(keys[state]);
};

const rawLanguage = (value: string): string => {
  const trimmed = value.trimStart();
  return trimmed.startsWith('{') || trimmed.startsWith('[') ? 'json' : 'text';
};

const RawSection = ({ label, value }: { label: string; value: string }) => (
  <div className="space-y-2 overflow-hidden">
    <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">{label}</h4>
    <div className="max-h-72 overflow-auto rounded-md bg-muted/50">
      <CodeBlock code={value} language={rawLanguage(value)} />
    </div>
  </div>
);

const revealLocation = (path: string) => {
  void window.electron.shell.showItemInFolder(path).then(result => {
    if (!result?.success) void window.electron.shell.openPath(path);
  });
};

const LocationChip = ({ location }: { location: CodingToolCallLocation }) => (
  <button
    type="button"
    title={i18nService.t('codingAgentShowInFolder')}
    onClick={() => revealLocation(location.path)}
    className="flex max-w-full cursor-pointer items-center gap-1 rounded-md border border-border bg-muted/40 px-2 py-0.5 font-mono text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
  >
    <FolderOpen className="size-3 shrink-0" />
    <span className="truncate">
      {location.path}
      {location.line !== null ? `:${location.line}` : ''}
    </span>
  </button>
);

const PLAN_STATUS_ICON: Record<string, ReactNode> = {
  pending: <Circle className="size-3.5 shrink-0 text-muted-foreground" />,
  in_progress: <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />,
  completed: <CheckCircle2 className="size-3.5 shrink-0 text-green-600" />,
};

const PLAN_PRIORITY_VARIANT: Record<string, 'destructive' | 'secondary' | 'outline'> = {
  high: 'destructive',
  medium: 'secondary',
  low: 'outline',
};

const PLAN_PRIORITY_I18N_KEY: Record<string, string> = {
  high: 'codingAgentPlanPriorityHigh',
  medium: 'codingAgentPlanPriorityMedium',
  low: 'codingAgentPlanPriorityLow',
};

const PlanActivityBody = ({ activity }: { activity: CodingConversationActivity }) => {
  const entries = parsePlanEntries(activity.event.payload);
  if (!entries || entries.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1.5">
      {entries.map((entry, index) => (
        <li key={index} className="flex items-start gap-2 text-sm">
          <span className="mt-0.5">
            {PLAN_STATUS_ICON[entry.status] ?? PLAN_STATUS_ICON.pending}
          </span>
          <span
            className={
              entry.status === 'completed' ? 'text-muted-foreground line-through' : undefined
            }
          >
            {entry.content}
          </span>
          {entry.priority && (
            <Badge
              variant={PLAN_PRIORITY_VARIANT[entry.priority] ?? 'outline'}
              className="shrink-0 text-xs"
            >
              {i18nService.t(PLAN_PRIORITY_I18N_KEY[entry.priority] ?? entry.priority)}
            </Badge>
          )}
        </li>
      ))}
    </ul>
  );
};

const ToolActivityBody = ({ activity }: { activity: CodingConversationActivity }) => {
  const view = parseToolCallView(activity.event.payload);
  if (!hasToolCallDetails(view)) {
    const fallback = getCodingEventText(activity.event);
    const details =
      fallback ||
      (Object.keys(activity.event.payload).length > 0
        ? JSON.stringify(activity.event.payload, null, 2)
        : '');
    return details ? (
      <pre className="whitespace-pre-wrap break-words font-mono text-xs">{details}</pre>
    ) : null;
  }
  return (
    <div className="flex flex-col gap-3">
      {view.locations.length > 0 && (
        <div className="space-y-1.5">
          <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
            {i18nService.t('codingAgentToolLocations')}
          </h4>
          <div className="flex flex-wrap gap-1.5">
            {view.locations.map((location, index) => (
              <LocationChip key={`${location.path}:${location.line ?? index}`} location={location} />
            ))}
          </div>
        </div>
      )}
      {view.diffs.map(diff => (
        <CodingDiffView
          key={diff.path}
          path={diff.path}
          oldText={diff.oldText}
          newText={diff.newText}
        />
      ))}
      {view.output && (
        <pre className="whitespace-pre-wrap break-words font-mono text-xs">{view.output}</pre>
      )}
      {view.rawInput && (
        <RawSection label={i18nService.t('codingAgentToolInput')} value={view.rawInput} />
      )}
      {view.rawOutput && (
        <RawSection label={i18nService.t('codingAgentToolOutput')} value={view.rawOutput} />
      )}
    </div>
  );
};

const activityTitle = (activity: CodingConversationActivity): string => {
  if (activity.kind === CodingConversationActivityKind.Plan) {
    return i18nService.t('codingAgentPlan');
  }
  if (activity.kind === CodingConversationActivityKind.Permission) {
    return i18nService.t('codingAgentPermissionEvent');
  }
  const view = parseToolCallView(activity.event.payload);
  return view.title ?? toolKindLabel(view.kind) ?? i18nService.t('codingAgentTool');
};

const CodingActivityComponent = ({
  activity,
  artifacts,
}: {
  activity: CodingConversationActivity;
  /** File artifacts produced by this tool call, shown as preview cards. */
  artifacts?: Artifact[];
}) => {
  const state = activityState(activity);
  const isPlan = activity.kind === CodingConversationActivityKind.Plan;
  const isTool = activity.kind === CodingConversationActivityKind.Tool;
  return (
    <div className="flex flex-col gap-2">
      <Tool defaultOpen={activity.kind === CodingConversationActivityKind.Permission}>
        <ToolHeader
          type="dynamic-tool"
          toolName="coding-agent"
          state={state}
          statusLabel={activityStatusLabel(state)}
          title={activityTitle(activity)}
          icon={isTool ? toolKindIcon(parseToolCallView(activity.event.payload).kind) : undefined}
        />
        <ToolContent>
          {isPlan ? (
            <PlanActivityBody activity={activity} />
          ) : isTool ? (
            <ToolActivityBody activity={activity} />
          ) : (
            <pre className="whitespace-pre-wrap break-words font-mono text-xs">
              {getCodingEventText(activity.event) ||
                JSON.stringify(activity.event.payload, null, 2)}
            </pre>
          )}
        </ToolContent>
      </Tool>
      {artifacts && artifacts.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {artifacts.map(artifact => (
            <ArtifactPreviewCard key={artifact.id} artifact={artifact} />
          ))}
        </div>
      )}
    </div>
  );
};

export const CodingActivity = memo(CodingActivityComponent);
