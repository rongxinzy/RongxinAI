import { Alert, AlertAction, AlertDescription, AlertTitle } from '@shared/components/ui/alert';
import { Button } from '@shared/components/ui/button';
import { FieldDescription, FieldLabel } from '@shared/components/ui/field';
import { Input } from '@shared/components/ui/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shared/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@shared/components/ui/tabs';
import { ToggleGroup, ToggleGroupItem } from '@shared/components/ui/toggle-group';
import { PlatformRegistry } from '@shared/platform';
import { CircleAlert, X } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { useSelector } from 'react-redux';

import type {
  ScheduledTask,
  ScheduledTaskChannelOption,
  ScheduledTaskConversationOption,
  ScheduledTaskInput,
} from '../../../scheduledTask/types';
import { i18nService } from '../../services/i18n';
import { scheduledTaskService } from '../../services/scheduledTask';
import { RootState } from '../../store';
import { toAgentModelRef } from '../../utils/agentModelRef';
import {
  buildAgentModelValidationTargets,
  resolveFirstUnsupportedAgentModel,
  resolveAgentModelSupportMessageKey,
} from '../../utils/agentModelSupport';
import type { TaskTemplateValues } from './TaskTemplateGallery';
import TaskFormBody from './TaskFormBody';
import TaskTimePicker from './TaskTimePicker';
import { channelOptionValue, findChannelOption } from './channelOptionValue';
import { formatScheduleLabel, type PlanType, scheduleToPlanInfo } from './utils';

interface TaskFormProps {
  mode: 'create' | 'edit';
  task?: ScheduledTask;
  prefill?: TaskTemplateValues;
  onCancel: () => void;
  onSaved: (newTaskId?: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
}

interface CronBuilder {
  minute: string; // e.g. '0', '*/5', '*/15', '*/30', '*'
  hour: string; // e.g. '9', '*/2', '*'
  dom: string; // e.g. '*', '1', '15'
  month: string; // e.g. '*'
  dow: string; // e.g. '*', '1-5', '1', '0'
}

const DEFAULT_CRON_BUILDER: CronBuilder = {
  minute: '0',
  hour: '9',
  dom: '*',
  month: '*',
  dow: '*',
};

function cronBuilderToExpr(b: CronBuilder): string {
  return `${b.minute} ${b.hour} ${b.dom} ${b.month} ${b.dow}`;
}

/** Best-effort parse of a 5-field cron expr into builder fields. */
function exprToCronBuilder(expr: string): CronBuilder | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [minute, hour, dom, month, dow] = parts;
  return { minute, hour, dom, month, dow };
}

interface FormState {
  name: string;
  description: string;
  planType: PlanType;
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekdays: number[];
  monthDay: number;
  payloadText: string;
  notifyChannel: string;
  notifyTo: string;
  cronExpr: string;
  cronTz: string;
  cronMode: 'builder' | 'raw';
  cronBuilder: CronBuilder;
  notifyAccountId: string | undefined;
  workspaceId: string;
  modelId: string;
}

function nowDefaults() {
  const now = new Date();
  return {
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    day: now.getDate(),
    hour: 9,
    minute: 0,
    second: 0,
  };
}

const TASK_NAME_MAX_LENGTH = 200;

const DEFAULT_FORM_STATE: FormState = {
  name: '',
  description: '',
  planType: 'daily',
  ...nowDefaults(),
  weekdays: [1, 2, 3, 4, 5],
  monthDay: 1,
  payloadText: '',
  notifyChannel: 'none',
  notifyTo: '',
  cronExpr: '',
  cronTz: '',
  cronMode: 'builder',
  cronBuilder: { ...DEFAULT_CRON_BUILDER },
  notifyAccountId: undefined,
  workspaceId: '',
  modelId: '',
};

// Cron quick-pick examples: [label key, expr]
const CRON_QUICK_PICKS: Array<{ labelKey: string; expr: string }> = [
  { labelKey: 'scheduledTasksFormCronQuickEveryDay', expr: '0 9 * * *' },
  { labelKey: 'scheduledTasksFormCronQuickWeekday', expr: '0 9 * * 1-5' },
  { labelKey: 'scheduledTasksFormCronQuickEveryHour', expr: '0 * * * *' },
  { labelKey: 'scheduledTasksFormCronQuickEvery15min', expr: '*/15 * * * *' },
];

const PLAN_LABEL_KEY = {
  once: 'scheduledTasksFormScheduleModeOnce',
  hourly: 'scheduledTasksFormScheduleModeHourly',
  daily: 'scheduledTasksFormScheduleModeDaily',
  weekly: 'scheduledTasksFormScheduleModeWeekly',
  monthly: 'scheduledTasksFormScheduleModeMonthly',
  cron: 'scheduledTasksFormScheduleModeCronCustom',
  advanced: 'scheduledTasksFormScheduleModeCronCustom',
} as const;

function isIMChannel(channel: string): boolean {
  return PlatformRegistry.isIMChannel(channel);
}

function createFormState(task?: ScheduledTask, prefill?: TaskTemplateValues): FormState {
  if (!task) {
    const defaults = { ...DEFAULT_FORM_STATE, ...nowDefaults() };
    if (prefill) {
      const parsedBuilder = exprToCronBuilder(prefill.schedule.expr) ?? { ...DEFAULT_CRON_BUILDER };
      return {
        ...defaults,
        name: prefill.name,
        description: prefill.description,
        planType: 'cron',
        cronExpr: prefill.schedule.expr,
        cronMode: 'builder',
        cronBuilder: parsedBuilder,
        payloadText: prefill.promptText,
      };
    }
    return defaults;
  }

  const planInfo = scheduleToPlanInfo(task.schedule);
  const rawCronExpr =
    planInfo.cronExpr ?? (task.schedule.kind === 'cron' ? task.schedule.expr : '');
  const parsedBuilder = rawCronExpr
    ? (exprToCronBuilder(rawCronExpr) ?? { ...DEFAULT_CRON_BUILDER })
    : { ...DEFAULT_CRON_BUILDER };

  return {
    name: task.name,
    description: task.description,
    planType: planInfo.planType,
    year: planInfo.year,
    month: planInfo.month,
    day: planInfo.day,
    hour: planInfo.hour,
    minute: planInfo.minute,
    second: planInfo.second,
    weekdays: planInfo.weekdays,
    monthDay: planInfo.monthDay,
    payloadText: task.payload.kind === 'systemEvent' ? task.payload.text : task.payload.message,
    notifyChannel: task.delivery.channel || 'none',
    notifyTo: task.delivery.to || '',
    cronExpr: rawCronExpr,
    cronTz: planInfo.cronTz ?? (task.schedule.kind === 'cron' ? (task.schedule.tz ?? '') : ''),
    cronMode: 'builder',
    cronBuilder: parsedBuilder,
    notifyAccountId: task.delivery.accountId,
    workspaceId: task.workspaceId || '',
    modelId: task.payload.kind === 'agentTurn' ? (task.payload.model ?? '') : '',
  };
}

function buildScheduleInput(form: FormState): ScheduledTaskInput['schedule'] {
  if (form.planType === 'once') {
    const date = new Date(form.year, form.month - 1, form.day, form.hour, form.minute, form.second);
    return { kind: 'at', at: date.toISOString() };
  }

  if (form.planType === 'cron') {
    const expr =
      form.cronMode === 'builder' ? cronBuilderToExpr(form.cronBuilder) : form.cronExpr.trim();
    const schedule: ScheduledTaskInput['schedule'] & { kind: 'cron' } = {
      kind: 'cron',
      expr,
    };
    if (form.cronTz.trim()) {
      schedule.tz = form.cronTz.trim();
    }
    return schedule;
  }

  const min = String(form.minute);
  const hr = String(form.hour);

  if (form.planType === 'hourly') {
    return { kind: 'cron', expr: `${min} * * * *` };
  }

  if (form.planType === 'daily') {
    return { kind: 'cron', expr: `${min} ${hr} * * *` };
  }

  if (form.planType === 'weekly') {
    const dowField = [...form.weekdays].sort((a, b) => a - b).join(',');
    return { kind: 'cron', expr: `${min} ${hr} * * ${dowField}` };
  }

  return { kind: 'cron', expr: `${min} ${hr} ${form.monthDay} * *` };
}

const WEEKDAY_KEYS = [
  'scheduledTasksFormWeekSun',
  'scheduledTasksFormWeekMon',
  'scheduledTasksFormWeekTue',
  'scheduledTasksFormWeekWed',
  'scheduledTasksFormWeekThu',
  'scheduledTasksFormWeekFri',
  'scheduledTasksFormWeekSat',
] as const;

// Returns the human-readable cron description, or null if the expression is
// syntactically invalid (wrong number of fields, parse error).
// Distinguishes from an empty/blank expression which returns null without error.
function previewCron(expr: string): { ok: true; label: string } | { ok: false } | null {
  const trimmed = expr.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(/\s+/);
  if (parts.length !== 5) return { ok: false };
  try {
    const label = formatScheduleLabel({ kind: 'cron', expr: trimmed });
    return { ok: true, label };
  } catch {
    return { ok: false };
  }
}

const TaskForm: React.FC<TaskFormProps> = ({
  mode,
  task,
  prefill,
  onCancel,
  onSaved,
  onDirtyChange,
}) => {
  const [form, setForm] = useState<FormState>(() => createFormState(task, prefill));
  const initialFormRef = useRef<string>(JSON.stringify(createFormState(task, prefill)));
  const availableModels = useSelector((state: RootState) => state.model.availableModels);
  const defaultSelectedModel = useSelector((state: RootState) => state.model.defaultSelectedModel);
  const workspaces = useSelector((state: RootState) => state.workspace.workspaces);
  const currentWorkspaceId = useSelector((state: RootState) => state.workspace.currentWorkspaceId);

  const [channelOptions, setChannelOptions] = useState<ScheduledTaskChannelOption[]>(() => {
    const base: ScheduledTaskChannelOption[] = [];
    const savedChannel = task?.delivery.channel;
    if (savedChannel && isIMChannel(savedChannel) && !base.some(o => o.value === savedChannel)) {
      const platform = PlatformRegistry.platformOfChannel(savedChannel);
      const label = platform ? PlatformRegistry.get(platform).label : savedChannel;
      base.push({ value: savedChannel, label, accountId: task?.delivery.accountId });
    }
    return base;
  });
  const [conversations, setConversations] = useState<ScheduledTaskConversationOption[]>([]);
  const [conversationsLoading, setConversationsLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [cronPreview, setCronPreview] = useState<
    { ok: true; label: string } | { ok: false } | null
  >(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const isDirty = JSON.stringify(form) !== initialFormRef.current;

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  const isAdvanced = form.planType === 'advanced';
  const isCron = form.planType === 'cron';
  const showConversationSelector = isIMChannel(form.notifyChannel);

  useEffect(() => {
    const nextForm = createFormState(task, prefill);
    initialFormRef.current = JSON.stringify(nextForm);
    setForm(nextForm);
  }, [task, prefill]);

  useEffect(() => {
    if (form.workspaceId) return;
    const workspaceId = currentWorkspaceId ?? workspaces.find(item => !item.isHidden)?.id ?? '';
    if (!workspaceId) return;
    setForm(current => (current.workspaceId ? current : { ...current, workspaceId }));
    const initial = JSON.parse(initialFormRef.current) as FormState;
    if (!initial.workspaceId) {
      initialFormRef.current = JSON.stringify({ ...initial, workspaceId });
    }
  }, [form.workspaceId, currentWorkspaceId, workspaces]);

  useEffect(() => {
    let cancelled = false;
    void scheduledTaskService.listChannels().then(channels => {
      if (cancelled || channels.length === 0) return;
      setChannelOptions(current => {
        // Use the server-returned order (DEFINITIONS order) as the base,
        // then append any saved channel that is not in the list (e.g. disabled platform).
        const next = [...channels];
        for (const saved of current) {
          if (!next.some(item => channelOptionValue(item) === channelOptionValue(saved))) {
            next.push(saved);
          }
        }
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!showConversationSelector) {
      setConversations([]);
      return;
    }

    let cancelled = false;
    const selectedChannelOption = channelOptions.find(
      option => option.value === form.notifyChannel && option.accountId === form.notifyAccountId,
    );
    setConversationsLoading(true);
    void scheduledTaskService
      .listChannelConversations(
        form.notifyChannel,
        form.notifyAccountId,
        selectedChannelOption?.filterAccountId ?? form.notifyAccountId,
      )
      .then(result => {
        if (cancelled) return;
        setConversations(result);
        setConversationsLoading(false);

        if (result.length > 0 && !form.notifyTo) {
          setForm(current => ({ ...current, notifyTo: result[0].conversationId }));
        }
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.notifyChannel, form.notifyAccountId, channelOptions]);

  // Live cron preview
  useEffect(() => {
    if (!isCron) {
      setCronPreview(null);
      return;
    }
    const expr = form.cronMode === 'builder' ? cronBuilderToExpr(form.cronBuilder) : form.cronExpr;
    setCronPreview(previewCron(expr));
  }, [isCron, form.cronMode, form.cronExpr, form.cronBuilder]);

  const updateForm = (patch: Partial<FormState>) => {
    setForm(current => ({ ...current, ...patch }));
  };

  const validate = (): boolean => {
    const nextErrors: Record<string, string> = {};

    if (!form.name.trim()) {
      nextErrors.name = i18nService.t('scheduledTasksFormValidationNameRequired');
    }
    if (!form.modelId) {
      nextErrors.modelId = i18nService.t('scheduledTasksFormValidationModelRequired');
    }
    if (!form.workspaceId) {
      nextErrors.workspaceId = i18nService.t('scheduledTasksFormValidationWorkspaceRequired');
    }
    if (!form.payloadText.trim()) {
      nextErrors.payloadText = i18nService.t('scheduledTasksFormValidationPromptRequired');
    }

    if (form.planType === 'once') {
      const runAt = new Date(
        form.year,
        form.month - 1,
        form.day,
        form.hour,
        form.minute,
        form.second,
      );
      if (runAt.getTime() <= Date.now()) {
        nextErrors.schedule = i18nService.t('scheduledTasksFormValidationDatetimeFuture');
      }
    }

    if (form.planType === 'cron') {
      const expr =
        form.cronMode === 'builder' ? cronBuilderToExpr(form.cronBuilder) : form.cronExpr.trim();
      if (!expr) {
        nextErrors.schedule = i18nService.t('scheduledTasksFormValidationCronRequired');
      } else {
        const parts = expr.split(/\s+/);
        if (parts.length !== 5) {
          nextErrors.schedule = i18nService.t('scheduledTasksFormCronInputHint');
        }
      }
    }

    if (
      !isAdvanced &&
      !isCron &&
      (form.hour < 0 || form.hour > 23 || form.minute < 0 || form.minute > 59)
    ) {
      nextErrors.schedule = i18nService.t('scheduledTasksFormValidationTimeRequired');
    }

    if (form.planType === 'weekly' && form.weekdays.length === 0) {
      nextErrors.schedule = i18nService.t('scheduledTasksFormValidationWeekdayRequired');
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;

    const defaultModelRef = defaultSelectedModel ? toAgentModelRef(defaultSelectedModel) : '';
    const unsupportedModel = resolveFirstUnsupportedAgentModel(
      buildAgentModelValidationTargets({
        primaryModelRef: form.modelId,
        fallbackModelRef: defaultModelRef,
        triageOverride: null,
      }),
      availableModels,
    );
    if (unsupportedModel) {
      setSubmitError(i18nService.t(resolveAgentModelSupportMessageKey(unsupportedModel.reason)));
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    try {
      const schedule = isAdvanced && task ? task.schedule : buildScheduleInput(form);

      const input: ScheduledTaskInput = {
        name: form.name.trim(),
        description: '',
        enabled: true,
        schedule,
        sessionTarget: 'isolated',
        wakeMode: 'now',
        workspaceId: form.workspaceId,
        payload: {
          kind: 'agentTurn',
          message: form.payloadText.trim(),
          ...(form.modelId ? { model: form.modelId } : {}),
        },
        delivery:
          form.notifyChannel === 'none'
            ? { mode: 'none' }
            : {
                mode: 'announce',
                channel: form.notifyChannel,
                ...(form.notifyTo ? { to: form.notifyTo } : {}),
                ...(form.notifyAccountId ? { accountId: form.notifyAccountId } : {}),
              },
      };

      if (mode === 'create') {
        const newId = await scheduledTaskService.createTask(input);
        onSaved(newId ?? undefined);
      } else if (task) {
        await scheduledTaskService.updateTaskById(task.id, input);
        onSaved();
      }
      initialFormRef.current = JSON.stringify(form);
      onDirtyChange?.(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setSubmitError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const getNotifyChannelLabel = (channel: ScheduledTaskChannelOption): string => {
    const platform = PlatformRegistry.platformOfChannel(channel.value);
    const platformLabel = platform ? i18nService.t(platform) || channel.label : channel.label;
    return channel.accountId ? `${platformLabel} · ${channel.label}` : platformLabel;
  };

  const renderPlanSelect = () => (
    <Select
      value={form.planType}
      onValueChange={value => value && updateForm({ planType: value as PlanType })}
    >
      <SelectTrigger className="flex-1 min-w-0">
        <SelectValue>{i18nService.t(PLAN_LABEL_KEY[form.planType])}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectItem value="once">
            {i18nService.t('scheduledTasksFormScheduleModeOnce')}
          </SelectItem>
          <SelectItem value="hourly">
            {i18nService.t('scheduledTasksFormScheduleModeHourly')}
          </SelectItem>
          <SelectItem value="daily">
            {i18nService.t('scheduledTasksFormScheduleModeDaily')}
          </SelectItem>
          <SelectItem value="weekly">
            {i18nService.t('scheduledTasksFormScheduleModeWeekly')}
          </SelectItem>
          <SelectItem value="monthly">
            {i18nService.t('scheduledTasksFormScheduleModeMonthly')}
          </SelectItem>
          <SelectItem value="cron">
            {i18nService.t(
              'scheduledTasksFormScheduleModeCronCustom' as Parameters<typeof i18nService.t>[0],
            )}
          </SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  );

  const renderCronSection = () => {
    // Derive current cron expression from builder or raw input
    const currentExpr =
      form.cronMode === 'builder' ? cronBuilderToExpr(form.cronBuilder) : form.cronExpr;

    const handleSwitchToRaw = () => {
      updateForm({ cronMode: 'raw', cronExpr: cronBuilderToExpr(form.cronBuilder) });
    };

    const handleSwitchToBuilder = () => {
      const parsed = exprToCronBuilder(form.cronExpr);
      if (parsed) {
        updateForm({ cronMode: 'builder', cronBuilder: parsed });
      } else {
        updateForm({ cronMode: 'builder' });
      }
    };

    const fieldSelectClass = 'w-full min-w-20 text-xs';

    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3">{renderPlanSelect()}</div>

        <Tabs
          value={form.cronMode}
          onValueChange={value => {
            if (value === 'builder') handleSwitchToBuilder();
            if (value === 'raw') handleSwitchToRaw();
          }}
          className="gap-0"
        >
          <TabsList>
            <TabsTrigger value="builder">
              {i18nService.t(
                'scheduledTasksFormCronModeBuilder' as Parameters<typeof i18nService.t>[0],
              )}
            </TabsTrigger>
            <TabsTrigger value="raw">
              {i18nService.t(
                'scheduledTasksFormCronModeRaw' as Parameters<typeof i18nService.t>[0],
              )}
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {form.cronMode === 'builder' ? (
          <div className="rounded-lg border border-border bg-muted p-3 flex flex-col gap-2">
            {/* Field labels */}
            <div className="grid grid-cols-5 gap-1.5">
              {(['minute', 'hour', 'dom', 'month', 'dow'] as const).map(field => (
                <div key={field} className="text-left text-xs text-muted-foreground font-medium">
                  {i18nService.t(
                    `scheduledTasksFormCronField_${field}` as Parameters<typeof i18nService.t>[0],
                  )}
                </div>
              ))}
            </div>
            {/* Field selects */}
            <div className="grid grid-cols-5 gap-1.5">
              {/* Minute */}
              <Select
                value={form.cronBuilder.minute}
                onValueChange={value =>
                  value && updateForm({ cronBuilder: { ...form.cronBuilder, minute: value } })
                }
              >
                <SelectTrigger className={fieldSelectClass}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="*">*</SelectItem>
                    {Array.from({ length: 60 }, (_, i) => (
                      <SelectItem key={i} value={String(i)}>
                        {String(i).padStart(2, '0')}
                      </SelectItem>
                    ))}
                    <SelectItem value="*/5">*/5</SelectItem>
                    <SelectItem value="*/10">*/10</SelectItem>
                    <SelectItem value="*/15">*/15</SelectItem>
                    <SelectItem value="*/30">*/30</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
              {/* Hour */}
              <Select
                value={form.cronBuilder.hour}
                onValueChange={value =>
                  value && updateForm({ cronBuilder: { ...form.cronBuilder, hour: value } })
                }
              >
                <SelectTrigger className={fieldSelectClass}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="*">*</SelectItem>
                    {Array.from({ length: 24 }, (_, i) => (
                      <SelectItem key={i} value={String(i)}>
                        {String(i).padStart(2, '0')}
                      </SelectItem>
                    ))}
                    <SelectItem value="*/2">*/2</SelectItem>
                    <SelectItem value="*/4">*/4</SelectItem>
                    <SelectItem value="*/6">*/6</SelectItem>
                    <SelectItem value="*/12">*/12</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
              {/* DOM (day of month) */}
              <Select
                value={form.cronBuilder.dom}
                onValueChange={value =>
                  value && updateForm({ cronBuilder: { ...form.cronBuilder, dom: value } })
                }
              >
                <SelectTrigger className={fieldSelectClass}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="*">*</SelectItem>
                    {Array.from({ length: 31 }, (_, i) => i + 1).map(d => (
                      <SelectItem key={d} value={String(d)}>
                        {d}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              {/* Month */}
              <Select
                value={form.cronBuilder.month}
                onValueChange={value =>
                  value && updateForm({ cronBuilder: { ...form.cronBuilder, month: value } })
                }
              >
                <SelectTrigger className={fieldSelectClass}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="*">*</SelectItem>
                    {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                      <SelectItem key={m} value={String(m)}>
                        {m}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              {/* DOW (day of week) */}
              <Select
                value={form.cronBuilder.dow}
                onValueChange={value =>
                  value && updateForm({ cronBuilder: { ...form.cronBuilder, dow: value } })
                }
              >
                <SelectTrigger className={fieldSelectClass}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="*">*</SelectItem>
                    {WEEKDAY_KEYS.map((key, idx) => (
                      <SelectItem key={idx} value={String(idx)}>
                        {i18nService.t(key)}
                      </SelectItem>
                    ))}
                    <SelectItem value="1-5">
                      {i18nService.t('scheduledTasksCronWeekdays')}
                    </SelectItem>
                    <SelectItem value="0,6">
                      {i18nService.t('scheduledTasksCronWeekends')}
                    </SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            {/* Generated expression preview */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground font-mono bg-surface px-2 py-1 rounded border border-border flex-1 truncate">
                {currentExpr}
              </span>
              {cronPreview !== null && (
                <span
                  className={
                    cronPreview.ok
                      ? 'text-xs shrink-0 text-muted-foreground'
                      : 'text-xs shrink-0 text-destructive'
                  }
                >
                  {cronPreview.ok
                    ? cronPreview.label
                    : i18nService.t(
                        'scheduledTasksFormCronPreviewInvalid' as Parameters<
                          typeof i18nService.t
                        >[0],
                      )}
                </span>
              )}
            </div>
          </div>
        ) : (
          /* Raw expression input */
          <div className="flex flex-col gap-1">
            <Input
              type="text"
              value={form.cronExpr}
              onChange={e => updateForm({ cronExpr: e.target.value })}
              placeholder={i18nService.t(
                'scheduledTasksFormCronInputPlaceholder' as Parameters<typeof i18nService.t>[0],
              )}
              className="w-full"
              spellCheck={false}
            />
            <FieldDescription className="text-xs">
              {i18nService.t(
                'scheduledTasksFormCronInputHint' as Parameters<typeof i18nService.t>[0],
              )}
            </FieldDescription>
            {/* Live preview */}
            {form.cronExpr.trim() && cronPreview !== null && (
              <div
                className={
                  cronPreview.ok
                    ? 'mt-1 flex items-center gap-1.5 text-xs text-muted-foreground'
                    : 'mt-1 flex items-center gap-1.5 text-xs text-destructive'
                }
              >
                {cronPreview.ok ? (
                  <>
                    <span className="opacity-60">
                      {i18nService.t(
                        'scheduledTasksFormCronPreview' as Parameters<typeof i18nService.t>[0],
                      )}
                    </span>
                    <span className="font-medium">{cronPreview.label}</span>
                  </>
                ) : (
                  <span className="font-medium">
                    {i18nService.t(
                      'scheduledTasksFormCronPreviewInvalid' as Parameters<typeof i18nService.t>[0],
                    )}
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        {/* Quick pick chips */}
        <div className="flex flex-col gap-1">
          <p className="text-xs text-muted-foreground mb-1">
            {i18nService.t(
              'scheduledTasksFormCronQuickTitle' as Parameters<typeof i18nService.t>[0],
            )}
          </p>
          <ToggleGroup
            value={[currentExpr]}
            onValueChange={value => {
              const expr = value[0];
              if (!expr) return;
              const parsed = exprToCronBuilder(expr);
              updateForm({
                cronExpr: expr,
                cronBuilder: parsed ?? form.cronBuilder,
              });
            }}
            variant="outline"
            size="sm"
            spacing={1}
            className="flex-wrap"
          >
            {CRON_QUICK_PICKS.map(({ labelKey, expr }) => (
              <ToggleGroupItem key={expr} value={expr}>
                {i18nService.t(labelKey as Parameters<typeof i18nService.t>[0])}
                <span className="ml-1.5 opacity-50 font-mono">{expr}</span>
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>

        {/* Optional timezone */}
        <div className="flex flex-col gap-1">
          <FieldLabel htmlFor="scheduled-task-cron-timezone" className="text-xs">
            {i18nService.t('scheduledTasksFormCronTimezone' as Parameters<typeof i18nService.t>[0])}
            <span className="ml-1 text-muted-foreground font-normal">
              {i18nService.t('scheduledTasksFormOptional')}
            </span>
          </FieldLabel>
          <Input
            id="scheduled-task-cron-timezone"
            type="text"
            value={form.cronTz}
            onChange={e => updateForm({ cronTz: e.target.value })}
            placeholder={i18nService.t(
              'scheduledTasksFormCronTimezonePlaceholder' as Parameters<typeof i18nService.t>[0],
            )}
            className="w-full"
            spellCheck={false}
          />
        </div>
      </div>
    );
  };

  const renderScheduleRow = () => {
    if (isAdvanced) {
      const existingExpr = task?.schedule.kind === 'cron' ? task.schedule.expr : '';
      const existingTz = task?.schedule.kind === 'cron' ? (task.schedule.tz ?? '') : '';
      return (
        <div className="rounded-lg bg-muted p-3 border border-border">
          <p className="text-sm text-muted-foreground">{formatScheduleLabel(task!.schedule)}</p>
          {existingExpr && (
            <div className="flex items-center justify-end mt-2">
              <Button
                type="button"
                variant="link"
                size="xs"
                onClick={() =>
                  updateForm({ planType: 'cron', cronExpr: existingExpr, cronTz: existingTz })
                }
              >
                {i18nService.t(
                  'scheduledTasksFormAdvancedEditAsCron' as Parameters<typeof i18nService.t>[0],
                )}
              </Button>
            </div>
          )}
        </div>
      );
    }

    if (isCron) {
      return renderCronSection();
    }

    if (form.planType === 'once') {
      const dateValue = `${form.year}-${String(form.month).padStart(2, '0')}-${String(form.day).padStart(2, '0')}`;
      return (
        <div className="flex items-center gap-3">
          {renderPlanSelect()}
          <Input
            type="date"
            value={dateValue}
            onChange={e => {
              const [y, mo, d] = e.target.value.split('-').map(Number);
              if (!Number.isNaN(y)) updateForm({ year: y, month: mo, day: d });
            }}
            className="flex-1 min-w-0"
          />
          <TaskTimePicker
            hour={form.hour}
            minute={form.minute}
            second={form.second}
            onChange={updateForm}
          />
        </div>
      );
    }

    if (form.planType === 'daily') {
      return (
        <div className="flex items-center gap-3">
          {renderPlanSelect()}
          <TaskTimePicker hour={form.hour} minute={form.minute} onChange={updateForm} />
        </div>
      );
    }

    if (form.planType === 'hourly') {
      return (
        <div className="flex items-center gap-3">
          {renderPlanSelect()}
          <Select
            value={String(form.minute)}
            onValueChange={value => value !== null && updateForm({ minute: Number(value) })}
          >
            <SelectTrigger className="w-20 shrink-0">
              <SelectValue>{String(form.minute).padStart(2, '0')}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {Array.from({ length: 60 }, (_, i) => (
                  <SelectItem key={i} value={String(i)}>
                    {String(i).padStart(2, '0')}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <span className="shrink-0 text-sm text-muted-foreground">
            {i18nService.t('scheduledTasksFormHourlyMinuteSuffix')}
          </span>
        </div>
      );
    }

    if (form.planType === 'weekly') {
      // Locale-aware weekday order:
      // zh: Mon(1)→Sun(0) — Chinese convention starts with Monday
      // en: Sun(0)→Sat(6) — English convention starts with Sunday
      const WEEKDAY_SHORT_LABELS: [string, number][] =
        i18nService.getLanguage() === 'zh'
          ? [
              ['scheduledTasksFormWeekShortMon', 1],
              ['scheduledTasksFormWeekShortTue', 2],
              ['scheduledTasksFormWeekShortWed', 3],
              ['scheduledTasksFormWeekShortThu', 4],
              ['scheduledTasksFormWeekShortFri', 5],
              ['scheduledTasksFormWeekShortSat', 6],
              ['scheduledTasksFormWeekShortSun', 0],
            ]
          : [
              ['scheduledTasksFormWeekShortSun', 0],
              ['scheduledTasksFormWeekShortMon', 1],
              ['scheduledTasksFormWeekShortTue', 2],
              ['scheduledTasksFormWeekShortWed', 3],
              ['scheduledTasksFormWeekShortThu', 4],
              ['scheduledTasksFormWeekShortFri', 5],
              ['scheduledTasksFormWeekShortSat', 6],
            ];

      return (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
            {renderPlanSelect()}
            <TaskTimePicker hour={form.hour} minute={form.minute} onChange={updateForm} />
          </div>
          <ToggleGroup
            multiple
            value={form.weekdays.map(String)}
            onValueChange={value => updateForm({ weekdays: value.map(Number) })}
            variant="outline"
            size="sm"
            spacing={1}
          >
            {WEEKDAY_SHORT_LABELS.map(([key, dayValue]) => (
              <ToggleGroupItem key={dayValue} value={String(dayValue)}>
                {i18nService.t(key)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      );
    }

    return (
      <div className="flex items-center gap-3">
        {renderPlanSelect()}
        <Select
          value={String(form.monthDay)}
          onValueChange={value => value !== null && updateForm({ monthDay: Number(value) })}
        >
          <SelectTrigger className="flex-1 min-w-0">
            <SelectValue>
              {`${form.monthDay}${i18nService.t('scheduledTasksFormMonthDaySuffix')}`}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {Array.from({ length: 31 }, (_, i) => i + 1).map(d => (
                <SelectItem key={d} value={String(d)}>
                  {d}
                  {i18nService.t('scheduledTasksFormMonthDaySuffix')}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <TaskTimePicker hour={form.hour} minute={form.minute} onChange={updateForm} />
      </div>
    );
  };

  const renderNotifyRow = () => (
    <div className="flex items-center gap-3">
      <Select
        value={
          form.notifyChannel === 'none'
            ? 'none'
            : channelOptionValue({
                value: form.notifyChannel,
                accountId: form.notifyAccountId,
              })
        }
        onValueChange={value => {
          const selected = findChannelOption(channelOptions, value);
          updateForm({
            notifyChannel: selected?.value ?? 'none',
            notifyTo: '',
            notifyAccountId: selected?.accountId,
          });
        }}
      >
        <SelectTrigger className="flex-1 min-w-0">
          <SelectValue>
            {form.notifyChannel === 'none'
              ? i18nService.t('scheduledTasksFormNotifyChannelNone')
              : (() => {
                  const channel = channelOptions.find(
                    option =>
                      option.value === form.notifyChannel &&
                      option.accountId === form.notifyAccountId,
                  );
                  return channel ? getNotifyChannelLabel(channel) : form.notifyChannel;
                })()}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value="none">
              {i18nService.t('scheduledTasksFormNotifyChannelNone')}
            </SelectItem>
            {channelOptions.map(channel => {
              const displayName = getNotifyChannelLabel(channel);
              return (
                <SelectItem
                  key={`${channel.value}:${channel.accountId ?? ''}`}
                  value={channelOptionValue(channel)}
                >
                  {displayName}
                </SelectItem>
              );
            })}
          </SelectGroup>
        </SelectContent>
      </Select>

      {showConversationSelector && (
        <Select
          value={form.notifyTo}
          onValueChange={value => updateForm({ notifyTo: value ?? '' })}
          disabled={conversationsLoading}
        >
          <SelectTrigger className="flex-1 min-w-0">
            <SelectValue
              placeholder={i18nService.t('scheduledTasksFormNotifyConversationLoading')}
            />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {conversations.length === 0 ? (
                <SelectItem value="no-conversation" disabled>
                  {i18nService.t('scheduledTasksFormNotifyConversationNone')}
                </SelectItem>
              ) : (
                conversations.map(conv => (
                  <SelectItem key={conv.conversationId} value={conv.conversationId}>
                    {conv.conversationId}
                  </SelectItem>
                ))
              )}
            </SelectGroup>
          </SelectContent>
        </Select>
      )}
    </div>
  );

  return (
    <div className="flex flex-col min-h-0 h-full">
      <div className="flex-1 overflow-y-auto py-3 min-h-0">
        <TaskFormBody
          mode={mode}
          name={form.name}
          modelId={form.modelId}
          workspaceId={form.workspaceId}
          payloadText={form.payloadText}
          errors={errors}
          modelOptions={availableModels.map(model => ({
            value: toAgentModelRef(model),
            label: model.name,
          }))}
          workspaceOptions={workspaces
            .filter(workspace => !workspace.isHidden)
            .map(workspace => ({ value: workspace.id, label: workspace.name }))}
          scheduleControl={renderScheduleRow()}
          notificationControl={renderNotifyRow()}
          onNameChange={name => updateForm({ name: name.slice(0, TASK_NAME_MAX_LENGTH) })}
          onModelChange={modelId => updateForm({ modelId })}
          onWorkspaceChange={workspaceId => updateForm({ workspaceId })}
          onPayloadTextChange={payloadText => updateForm({ payloadText })}
        />
      </div>

      {submitError && (
        <Alert variant="destructive" className="mb-2">
          <CircleAlert />
          <AlertTitle>{i18nService.t('scheduledTasksFormSubmitError')}</AlertTitle>
          <AlertDescription>{submitError}</AlertDescription>
          <AlertAction>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={() => setSubmitError(null)}
              aria-label={i18nService.t('close')}
            >
              <X />
            </Button>
          </AlertAction>
        </Alert>
      )}

      <div className="shrink-0 flex items-center justify-end gap-2 py-2.5 border-t border-border">
        <Button type="button" variant="outline" onClick={onCancel}>
          {i18nService.t('cancel')}
        </Button>
        <Button type="button" onClick={() => void handleSubmit()} disabled={submitting}>
          {submitting
            ? i18nService.t('saving')
            : mode === 'create'
              ? i18nService.t('scheduledTasksFormCreate')
              : i18nService.t('scheduledTasksFormUpdate')}
        </Button>
      </div>
    </div>
  );
};

export default TaskForm;
