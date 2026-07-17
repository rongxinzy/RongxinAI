import { Button } from '@shared/components/ui/button';
import { Input } from '@shared/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shared/components/ui/select';
import { Textarea } from '@shared/components/ui/textarea';
import { PlatformRegistry } from '@shared/platform';
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
import { toOpenClawModelRef } from '../../utils/openclawModelRef';
import {
  buildOpenClawModelValidationTargets,
  resolveFirstUnsupportedOpenClawModel,
  resolveOpenClawModelSupportMessageKey,
} from '../../utils/openclawModelSupport';
import type { TaskTemplateValues } from './TaskTemplateGallery';
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
  agentId: string;
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
  agentId: 'main',
  modelId: '',
};

// Cron quick-pick examples: [label key, expr]
const CRON_QUICK_PICKS: Array<{ labelKey: string; expr: string }> = [
  { labelKey: 'scheduledTasksFormCronQuickEveryDay', expr: '0 9 * * *' },
  { labelKey: 'scheduledTasksFormCronQuickWeekday', expr: '0 9 * * 1-5' },
  { labelKey: 'scheduledTasksFormCronQuickEveryHour', expr: '0 * * * *' },
  { labelKey: 'scheduledTasksFormCronQuickEvery15min', expr: '*/15 * * * *' },
];

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
    agentId: task.agentId || '',
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
  const agents = useSelector((state: RootState) => state.agent.agents);

  const [channelOptions, setChannelOptions] = useState<ScheduledTaskChannelOption[]>(() => {
    const base: ScheduledTaskChannelOption[] = [];
    const savedChannel = task?.delivery.channel;
    if (savedChannel && isIMChannel(savedChannel) && !base.some(o => o.value === savedChannel)) {
      const platform = PlatformRegistry.platformOfChannel(savedChannel);
      const label = platform ? PlatformRegistry.get(platform).label : savedChannel;
      base.push({ value: savedChannel, label });
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
    let cancelled = false;
    void scheduledTaskService.listChannels().then(channels => {
      if (cancelled || channels.length === 0) return;
      setChannelOptions(current => {
        // Use the server-returned order (DEFINITIONS order) as the base,
        // then append any saved channel that is not in the list (e.g. disabled platform).
        const next = [...channels];
        for (const saved of current) {
          if (!next.some(item => item.value === saved.value)) {
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

    let agentRecord: Awaited<
      ReturnType<NonNullable<typeof window.electron>['agents']['get']>
    > | null = null;
    if (form.agentId) {
      try {
        agentRecord = await window.electron?.agents?.get(form.agentId);
      } catch {
        agentRecord = null;
      }
    }
    const defaultModelRef = defaultSelectedModel ? toOpenClawModelRef(defaultSelectedModel) : '';
    const unsupportedModel = resolveFirstUnsupportedOpenClawModel(
      buildOpenClawModelValidationTargets({
        primaryModelRef: form.modelId || agentRecord?.model || selectedAgent?.model || '',
        fallbackModelRef: defaultModelRef,
        triageOverride: form.modelId ? null : (agentRecord?.triageOverride ?? null),
      }),
      availableModels,
    );
    if (unsupportedModel) {
      setSubmitError(i18nService.t(resolveOpenClawModelSupportMessageKey(unsupportedModel.reason)));
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
        agentId: form.agentId,
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

  const labelClass = 'block text-[14px] font-normal leading-5 text-muted-foreground mb-1';
  const errorClass = 'text-xs text-red-500 mt-1';
  const hintClass = 'text-xs text-muted-foreground mt-0.5';

  // Resolve the selected agent's configured model for display
  const selectedAgent = agents.find(a => a.id === form.agentId) ?? null;

  const timeValue = `${String(form.hour).padStart(2, '0')}:${String(form.minute).padStart(2, '0')}`;
  const handleTimeChange = (value: string) => {
    const [h, m] = value.split(':').map(Number);
    if (!Number.isNaN(h) && !Number.isNaN(m)) {
      updateForm({ hour: h, minute: m });
    }
  };

  const renderPlanSelect = () => (
    <Select
      value={form.planType}
      onValueChange={value => value && updateForm({ planType: value as PlanType })}
    >
      <SelectTrigger className="flex-1 min-w-0">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="once">{i18nService.t('scheduledTasksFormScheduleModeOnce')}</SelectItem>
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

    const fieldSelectClass = 'flex-1 min-w-0 text-xs h-8 px-1.5';

    return (
      <div className="space-y-2">
        <div className="flex items-center gap-3">{renderPlanSelect()}</div>

        {/* Mode tabs */}
        <div className="flex items-center gap-0 border border-border rounded-lg overflow-hidden w-fit">
          <Button
            type="button"
            variant={form.cronMode === 'builder' ? 'default' : 'ghost'}
            size="xs"
            onClick={handleSwitchToBuilder}
            className="px-2.5 py-1 text-xs font-medium rounded-none transition-colors"
          >
            {i18nService.t(
              'scheduledTasksFormCronModeBuilder' as Parameters<typeof i18nService.t>[0],
            )}
          </Button>
          <Button
            type="button"
            variant={form.cronMode === 'raw' ? 'default' : 'ghost'}
            size="xs"
            onClick={handleSwitchToRaw}
            className="px-2.5 py-1 text-xs font-medium rounded-none transition-colors"
          >
            {i18nService.t('scheduledTasksFormCronModeRaw' as Parameters<typeof i18nService.t>[0])}
          </Button>
        </div>

        {form.cronMode === 'builder' ? (
          <div className="rounded-lg border border-border bg-surface-raised/20 p-2.5 space-y-2">
            {/* Field labels */}
            <div className="grid grid-cols-5 gap-1.5">
              {(['minute', 'hour', 'dom', 'month', 'dow'] as const).map(field => (
                <div key={field} className="text-center text-xs text-muted-foreground font-medium">
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
                  <SelectItem value="*">*</SelectItem>
                  {Array.from({ length: 31 }, (_, i) => i + 1).map(d => (
                    <SelectItem key={d} value={String(d)}>
                      {d}
                    </SelectItem>
                  ))}
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
                  <SelectItem value="*">*</SelectItem>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                    <SelectItem key={m} value={String(m)}>
                      {m}
                    </SelectItem>
                  ))}
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
                  <SelectItem value="*">*</SelectItem>
                  {WEEKDAY_KEYS.map((key, idx) => (
                    <SelectItem key={idx} value={String(idx)}>
                      {i18nService.t(key)}
                    </SelectItem>
                  ))}
                  <SelectItem value="1-5">{i18nService.t('scheduledTasksCronWeekdays')}</SelectItem>
                  <SelectItem value="0,6">{i18nService.t('scheduledTasksCronWeekends')}</SelectItem>
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
                  className={`text-xs shrink-0 ${cronPreview.ok ? 'text-muted-foreground' : 'text-red-500'}`}
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
          <div>
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
            <p className={hintClass}>
              {i18nService.t(
                'scheduledTasksFormCronInputHint' as Parameters<typeof i18nService.t>[0],
              )}
            </p>
            {/* Live preview */}
            {form.cronExpr.trim() && cronPreview !== null && (
              <div
                className={`mt-2 flex items-center gap-1.5 text-xs ${cronPreview.ok ? 'text-muted-foreground' : 'text-red-500'}`}
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
        <div>
          <p className="text-xs text-muted-foreground mb-1">
            {i18nService.t(
              'scheduledTasksFormCronQuickTitle' as Parameters<typeof i18nService.t>[0],
            )}
          </p>
          <div className="flex flex-wrap gap-1">
            {CRON_QUICK_PICKS.map(({ labelKey, expr }) => {
              const active = currentExpr === expr;
              return (
                <Button
                  key={expr}
                  type="button"
                  variant={active ? 'outline' : 'ghost'}
                  size="xs"
                  onClick={() => {
                    const parsed = exprToCronBuilder(expr);
                    updateForm({
                      cronExpr: expr,
                      cronBuilder: parsed ?? form.cronBuilder,
                    });
                  }}
                  className={`px-2 py-0.5 rounded-md text-xs border transition-colors ${
                    active
                      ? 'bg-primary/10 border-primary/40 text-primary font-medium'
                      : 'bg-surface border-border text-muted-foreground hover:bg-surface-raised hover:text-foreground'
                  }`}
                >
                  {i18nService.t(labelKey as Parameters<typeof i18nService.t>[0])}
                  <span className="ml-1.5 opacity-50 font-mono">{expr}</span>
                </Button>
              );
            })}
          </div>
        </div>

        {/* Optional timezone */}
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1">
            {i18nService.t('scheduledTasksFormCronTimezone' as Parameters<typeof i18nService.t>[0])}
            <span className="ml-1 text-muted-foreground font-normal">
              {i18nService.t('scheduledTasksFormOptional')}
            </span>
          </label>
          <Input
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
        <div>
          <label className={labelClass}>{i18nService.t('scheduledTasksFormScheduleType')}</label>
          <div className="rounded-lg bg-surface-raised/30 p-3 border border-border/50">
            <p className="text-sm text-muted-foreground">{formatScheduleLabel(task!.schedule)}</p>
            {existingExpr && (
              <div className="flex items-center justify-end mt-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={() =>
                    updateForm({ planType: 'cron', cronExpr: existingExpr, cronTz: existingTz })
                  }
                  className="text-xs text-primary hover:text-primary/80 font-medium transition-colors shrink-0"
                >
                  {i18nService.t(
                    'scheduledTasksFormAdvancedEditAsCron' as Parameters<typeof i18nService.t>[0],
                  )}
                </Button>
              </div>
            )}
          </div>
        </div>
      );
    }

    if (isCron) {
      return (
        <div>
          <label className={labelClass}>{i18nService.t('scheduledTasksFormScheduleType')}</label>
          {renderCronSection()}
        </div>
      );
    }

    if (form.planType === 'once') {
      const dateValue = `${form.year}-${String(form.month).padStart(2, '0')}-${String(form.day).padStart(2, '0')}`;
      const fullTimeValue = `${timeValue}:${String(form.second).padStart(2, '0')}`;
      return (
        <div>
          <label className={labelClass}>{i18nService.t('scheduledTasksFormScheduleType')}</label>
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
            <Input
              type="time"
              step="1"
              value={fullTimeValue}
              onChange={e => {
                const parts = e.target.value.split(':').map(Number);
                const patch: Partial<FormState> = {};
                if (!Number.isNaN(parts[0])) patch.hour = parts[0];
                if (!Number.isNaN(parts[1])) patch.minute = parts[1];
                if (parts.length > 2 && !Number.isNaN(parts[2])) patch.second = parts[2];
                updateForm(patch);
              }}
              className="flex-1 min-w-0"
            />
          </div>
        </div>
      );
    }

    if (form.planType === 'daily') {
      return (
        <div>
          <label className={labelClass}>{i18nService.t('scheduledTasksFormScheduleType')}</label>
          <div className="flex items-center gap-3">
            {renderPlanSelect()}
            <Input
              type="time"
              value={timeValue}
              onChange={e => handleTimeChange(e.target.value)}
              className="flex-1 min-w-0"
            />
          </div>
        </div>
      );
    }

    if (form.planType === 'hourly') {
      return (
        <div>
          <label className={labelClass}>{i18nService.t('scheduledTasksFormScheduleType')}</label>
          <div className="flex items-center gap-3">
            {renderPlanSelect()}
            <Select
              value={String(form.minute)}
              onValueChange={value => value !== null && updateForm({ minute: Number(value) })}
            >
              <SelectTrigger className="w-20 shrink-0 text-center">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: 60 }, (_, i) => (
                  <SelectItem key={i} value={String(i)}>
                    {String(i).padStart(2, '0')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="shrink-0 text-sm text-muted-foreground">
              {i18nService.t('scheduledTasksFormHourlyMinuteSuffix')}
            </span>
          </div>
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

      const toggleWeekday = (day: number) => {
        const current = form.weekdays;
        const next = current.includes(day) ? current.filter(d => d !== day) : [...current, day];
        updateForm({ weekdays: next });
      };

      return (
        <div>
          <label className={labelClass}>{i18nService.t('scheduledTasksFormScheduleType')}</label>
          <div className="flex items-center gap-3">
            {renderPlanSelect()}
            <Input
              type="time"
              value={timeValue}
              onChange={e => handleTimeChange(e.target.value)}
              className="flex-1 min-w-0"
            />
          </div>
          <div className="flex items-center gap-1.5 mt-2">
            {WEEKDAY_SHORT_LABELS.map(([key, dayValue]) => {
              const selected = form.weekdays.includes(dayValue);
              return (
                <Button
                  key={dayValue}
                  type="button"
                  variant={selected ? 'default' : 'ghost'}
                  size="icon-xs"
                  onClick={() => toggleWeekday(dayValue)}
                  className={`w-8 h-8 rounded-full text-xs font-medium transition-colors ${
                    selected
                      ? 'bg-primary text-white'
                      : 'border border-border text-muted-foreground hover:bg-surface-raised'
                  }`}
                >
                  {i18nService.t(key)}
                </Button>
              );
            })}
          </div>
        </div>
      );
    }

    return (
      <div>
        <label className={labelClass}>{i18nService.t('scheduledTasksFormScheduleType')}</label>
        <div className="flex items-center gap-3">
          {renderPlanSelect()}
          <Select
            value={String(form.monthDay)}
            onValueChange={value => value !== null && updateForm({ monthDay: Number(value) })}
          >
            <SelectTrigger className="flex-1 min-w-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: 31 }, (_, i) => i + 1).map(d => (
                <SelectItem key={d} value={String(d)}>
                  {d}
                  {i18nService.t('scheduledTasksFormMonthDaySuffix')}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            type="time"
            value={timeValue}
            onChange={e => handleTimeChange(e.target.value)}
            className="flex-1 min-w-0"
          />
        </div>
      </div>
    );
  };

  const renderNotifyRow = () => (
    <div>
      <label className={labelClass}>{i18nService.t('scheduledTasksFormNotifyChannel')}</label>
      <div className="flex items-center gap-3">
        <Select
          value={form.notifyChannel}
          onValueChange={value => {
            updateForm({
              notifyChannel: value ?? 'none',
              notifyTo: '',
              notifyAccountId: undefined,
            });
          }}
        >
          <SelectTrigger className={showConversationSelector ? 'flex-1 min-w-0' : 'w-full'}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">
              {i18nService.t('scheduledTasksFormNotifyChannelNone')}
            </SelectItem>
            {channelOptions.map(channel => {
              const platform = PlatformRegistry.platformOfChannel(channel.value);
              const platformLabel = platform
                ? i18nService.t(platform) || channel.label
                : channel.label;
              const displayName = channel.accountId
                ? `${platformLabel} · ${channel.label}`
                : platformLabel;
              const unsupported = channel.value === 'openclaw-weixin';
              return (
                <SelectItem
                  key={`${channel.value}:${channel.accountId ?? ''}`}
                  value={channel.value}
                  disabled={unsupported}
                >
                  {unsupported
                    ? `${displayName} (${i18nService.t('scheduledTasksChannelUnsupported')})`
                    : displayName}
                </SelectItem>
              );
            })}
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
              {conversations.length === 0 ? (
                <div className="px-2 py-1.5 text-sm text-muted-foreground">
                  {i18nService.t('scheduledTasksFormNotifyConversationNone')}
                </div>
              ) : (
                conversations.map(conv => (
                  <SelectItem key={conv.conversationId} value={conv.conversationId}>
                    {conv.conversationId}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex flex-col min-h-0 h-full">
      {/* Scrollable form body */}
      <div className="flex-1 overflow-y-auto py-3 min-h-0">
        <div className="max-w-2xl mx-auto flex flex-col gap-4 w-full">
          <h2 className="text-[14px] font-normal leading-5 text-muted-foreground">
            {mode === 'create'
              ? i18nService.t('scheduledTasksFormCreate')
              : i18nService.t('scheduledTasksFormUpdate')}
          </h2>

          {/* Task name */}
          <div>
            <label className={labelClass}>
              {i18nService.t('scheduledTasksFormName')}
              <span className="text-red-500 dark:text-red-400 ml-0.5">*</span>
            </label>
            <Input
              type="text"
              value={form.name}
              onChange={event =>
                updateForm({ name: event.target.value.slice(0, TASK_NAME_MAX_LENGTH) })
              }
              maxLength={TASK_NAME_MAX_LENGTH}
              className="w-full"
              placeholder={i18nService.t('scheduledTasksFormNamePlaceholder')}
            />
            {errors.name && <p className={errorClass}>{errors.name}</p>}
          </div>

          {/* Model binding */}
          <div>
            <label className={labelClass}>
              {i18nService.t('scheduledTasksFormModel')}
              <span className="text-red-500 dark:text-red-400 ml-0.5">*</span>
            </label>
            <Select
              value={form.modelId}
              onValueChange={value => {
                updateForm({ modelId: value ?? '' });
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder={i18nService.t('scheduledTasksFormModelPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="" disabled>
                  {i18nService.t('scheduledTasksFormModelPlaceholder')}
                </SelectItem>
                {availableModels.map(m => (
                  <SelectItem key={m.id} value={toOpenClawModelRef(m)}>
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.modelId && <p className={errorClass}>{errors.modelId}</p>}
          </div>

          {/* Schedule */}
          <div>
            {renderScheduleRow()}
            {errors.schedule && <p className={errorClass}>{errors.schedule}</p>}
          </div>

          {/* Prompt / payload */}
          <div>
            <div className="flex items-end justify-between mb-1">
              <label className={labelClass} style={{ marginBottom: 0 }}>
                {i18nService.t('scheduledTasksFormPayloadTextAgent')}
                <span className="text-red-500 dark:text-red-400 ml-0.5">*</span>
              </label>
            </div>
            <div className="rounded-lg border border-border bg-(--zy-surface)">
              <Textarea
                value={form.payloadText}
                onChange={event => updateForm({ payloadText: event.target.value })}
                className="resize-y"
                style={{ minHeight: '80px', height: '120px' }}
                placeholder={i18nService.t('scheduledTasksFormPromptPlaceholder')}
              />
            </div>
            <p className={hintClass}>
              {i18nService.t(
                'scheduledTasksFormPayloadTextAgentHint' as Parameters<typeof i18nService.t>[0],
              )}
            </p>

            {errors.payloadText && <p className={errorClass}>{errors.payloadText}</p>}
          </div>

          {/* Notification */}
          {renderNotifyRow()}
        </div>
      </div>

      {/* Submit error */}
      {submitError && (
        <div className="mb-2 flex items-start gap-2 px-3 py-2 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/40">
          <span className="text-xs text-red-600 dark:text-red-400 wrap-break-word min-w-0">
            {i18nService.t('scheduledTasksFormSubmitError')}
            {submitError}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={() => setSubmitError(null)}
            className="shrink-0 ml-auto text-red-400 hover:text-red-600 dark:hover:text-red-300 transition-colors"
            aria-label="dismiss"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
          </Button>
        </div>
      )}

      {/* Footer */}
      <div className="shrink-0 flex items-center justify-end gap-2 py-2.5 border-t border-border">
        <Button
          type="button"
          variant="ghost"
          onClick={onCancel}
          className="px-3 py-1.5 text-sm rounded-lg text-muted-foreground hover:bg-surface-raised transition-colors"
        >
          {i18nService.t('cancel')}
        </Button>
        <Button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={submitting}
          className="px-4 py-1.5 text-[14px] font-normal leading-5 bg-primary text-white rounded-lg hover:bg-primary-hover transition-colors disabled:opacity-50"
        >
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
