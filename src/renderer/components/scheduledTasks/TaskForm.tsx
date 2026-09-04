import { Alert, AlertAction, AlertDescription, AlertTitle } from '@shared/components/ui/alert';
import { Button } from '@shared/components/ui/button';
import { Input } from '@shared/components/ui/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shared/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@shared/components/ui/toggle-group';
import { PlatformRegistry } from '@shared/platform';
import { CircleAlert, X } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';

import {
  ManagedSessionKeyPrefix,
  SessionBindingStrategy,
  SessionTarget,
  type SessionBindingStrategy as SessionBindingStrategyType,
} from '../../../scheduledTask/constants';
import type {
  ScheduledTask,
  ScheduledTaskChannelOption,
  ScheduledTaskConversationOption,
  ScheduledTaskInput,
} from '../../../scheduledTask/types';
import type { Workspace } from '../../../shared/workspace';
import { CoworkSessionSource } from '../../../shared/cowork/constants';
import { i18nService } from '../../services/i18n';
import { getLastPathSegment } from '../../utils/path';
import { coworkService } from '../../services/cowork';
import { scheduledTaskService } from '../../services/scheduledTask';
import { RootState } from '../../store';
import { toAgentModelRef } from '../../utils/agentModelRef';
import {
  buildAgentModelValidationTargets,
  resolveFirstUnsupportedAgentModel,
  resolveAgentModelSupportMessageKey,
} from '../../utils/agentModelSupport';
import CronBuilder, { cronBuilderToExpr, type CronPreview } from './CronBuilder';
import type { TaskTemplateValues } from './TaskTemplateGallery';
import TaskFormBody from './TaskFormBody';
import TaskTimePicker from './TaskTimePicker';
import { channelOptionValue, findChannelOption } from './channelOptionValue';
import {
  PLAN_LABEL_KEY,
  TASK_NAME_MAX_LENGTH,
  WEEKDAY_SHORT_LABELS_EN,
  WEEKDAY_SHORT_LABELS_ZH,
  buildScheduleInput,
  createFormState,
  formsEqual,
  getNotifyChannelLabel,
  getNotifyConversationLabel,
  isIMChannel,
  previewCron,
  type FormState,
} from './taskFormState';
import { formatScheduleLabel, type PlanType } from './utils';

interface TaskFormProps {
  mode: 'create' | 'edit';
  task?: ScheduledTask;
  prefill?: TaskTemplateValues;
  onCancel: () => void;
  onSaved: (newTaskId?: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
}

const createInitialFormState = (
  mode: TaskFormProps['mode'],
  task: ScheduledTask | undefined,
  prefill: TaskTemplateValues | undefined,
): FormState => {
  if (mode === 'create' && !prefill) {
    return { ...createFormState(), planType: 'daily' };
  }
  return createFormState(task, prefill);
};

const getWorkspaceFolderName = (workspace: Workspace): string => {
  return getLastPathSegment(workspace.path) || workspace.name;
};

const TaskForm: React.FC<TaskFormProps> = ({
  mode,
  task,
  prefill,
  onCancel,
  onSaved,
  onDirtyChange,
}) => {
  const [form, setForm] = useState<FormState>(() => createInitialFormState(mode, task, prefill));
  // Snapshot of the pristine form for the dirty check (shallow compare, no stringify).
  const [initialForm, setInitialForm] = useState<FormState>(() =>
    createInitialFormState(mode, task, prefill),
  );
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
  const [sessionOptions, setSessionOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [sessionOptionsLoading, setSessionOptionsLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [cronPreview, setCronPreview] = useState<CronPreview>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const isDirty = !formsEqual(form, initialForm);

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  const isAdvanced = form.planType === 'advanced';
  const isCron = form.planType === 'cron';
  const showConversationSelector = isIMChannel(form.notifyChannel);
  const selectedConversation = conversations.find(
    conversation => conversation.conversationId === form.notifyTo,
  );

  useEffect(() => {
    const nextForm = createInitialFormState(mode, task, prefill);
    setInitialForm(nextForm);
    setForm(nextForm);
  }, [mode, task, prefill]);

  useEffect(() => {
    if (form.workspaceId) return;
    const workspaceId = currentWorkspaceId ?? workspaces.find(item => !item.isHidden)?.id ?? '';
    if (!workspaceId) return;
    setForm(current => (current.workspaceId ? current : { ...current, workspaceId }));
    setInitialForm(current => (current.workspaceId ? current : { ...current, workspaceId }));
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
          const sameValue = next.some(item => channelOptionValue(item) === channelOptionValue(saved));
          const samePlatformHasAccount = next.some(
            item => item.value === saved.value && Boolean(item.accountId),
          );
          if (!sameValue && !(samePlatformHasAccount && !saved.accountId)) {
            next.push(saved);
          }
        }
        const deduplicated = next.filter(
          (option, index, all) =>
            all.findIndex(item => channelOptionValue(item) === channelOptionValue(option)) === index,
        );
        // A singleton channel can arrive both with and without an account ID
        // (for example after upgrading an existing task). Prefer the routable
        // account-backed option so the UI cannot show two identical labels.
        return deduplicated.filter(
          option =>
            Boolean(option.accountId) ||
            !deduplicated.some(item => item.value === option.value && Boolean(item.accountId)),
        );
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
        // Some connectors expose the same native private-chat target more than
        // once (for example, `dm`). Keep one option per routable target so the
        // selector does not present indistinguishable duplicate entries.
        const uniqueConversations = result.filter(
          (conversation, index, all) =>
            all.findIndex(item => item.conversationId === conversation.conversationId) === index,
        );
        setConversations(uniqueConversations);
        setConversationsLoading(false);

        if (uniqueConversations.length > 0 && !form.notifyTo) {
          setForm(current => ({ ...current, notifyTo: uniqueConversations[0].conversationId }));
        }
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.notifyChannel, form.notifyAccountId, channelOptions]);

  useEffect(() => {
    if (form.sessionBinding !== SessionBindingStrategy.Existing || !form.workspaceId) {
      setSessionOptions([]);
      return;
    }
    let cancelled = false;
    setSessionOptionsLoading(true);
    void coworkService
      .listSessionsForWorkspacePreview(form.workspaceId, 100, 0, [
        CoworkSessionSource.Manual,
        CoworkSessionSource.Im,
      ])
      .then(result => {
        if (cancelled) return;
        setSessionOptions(
          (result.sessions ?? []).map(session => ({ value: session.id, label: session.title })),
        );
        setSessionOptionsLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setSessionOptions([]);
          setSessionOptionsLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [form.sessionBinding, form.workspaceId]);

  // Live cron preview
  useEffect(() => {
    if (!isCron) {
      setCronPreview(null);
      return;
    }
    const expr = form.cronMode === 'builder' ? cronBuilderToExpr(form.cronBuilder) : form.cronExpr;
    setCronPreview(previewCron(expr));
  }, [isCron, form.cronMode, form.cronExpr, form.cronBuilder]);

  const updateForm = useCallback((patch: Partial<FormState>) => {
    setForm(current => ({ ...current, ...patch }));
  }, []);

  // Stable callbacks for the memoized form body.
  const handleNameChange = useCallback(
    (name: string) => updateForm({ name: name.slice(0, TASK_NAME_MAX_LENGTH) }),
    [updateForm],
  );
  const handleModelChange = useCallback((modelId: string) => updateForm({ modelId }), [updateForm]);
  const handleWorkspaceChange = useCallback((workspaceId: string) => {
    setForm(current => ({
      ...current,
      workspaceId,
      boundSessionId:
        current.sessionBinding === SessionBindingStrategy.Existing ? '' : current.boundSessionId,
    }));
  }, []);
  const handleSessionBindingChange = useCallback((sessionBinding: SessionBindingStrategyType) => {
    setForm(current => ({
      ...current,
      sessionBinding,
      boundSessionId:
        sessionBinding === SessionBindingStrategy.Existing ? current.boundSessionId : '',
    }));
  }, []);
  const handleBoundSessionChange = useCallback(
    (boundSessionId: string) => updateForm({ boundSessionId }),
    [updateForm],
  );
  const handlePayloadTextChange = useCallback(
    (payloadText: string) => updateForm({ payloadText }),
    [updateForm],
  );

  const modelOptions = useMemo(
    () =>
      availableModels.map(model => ({
        value: toAgentModelRef(model),
        label: model.name,
      })),
    [availableModels],
  );
  const workspaceOptions = useMemo(
    () => {
      const visible = workspaces.filter(workspace => !workspace.isHidden);
      const counts = new Map<string, number>();
      for (const workspace of visible) {
        const folderName = getWorkspaceFolderName(workspace);
        counts.set(folderName, (counts.get(folderName) ?? 0) + 1);
      }
      return visible.map(workspace => {
        const folderName = getWorkspaceFolderName(workspace);
        return {
          value: workspace.id,
          label:
            (counts.get(folderName) ?? 0) > 1
              ? `${folderName} (${workspace.name})`
              : folderName,
        };
      });
    },
    [workspaces],
  );

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
    if (form.sessionBinding === SessionBindingStrategy.Existing && !form.boundSessionId) {
      nextErrors.boundSessionId = i18nService.t('scheduledTasksFormValidationSessionRequired');
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
        sessionTarget:
          form.sessionBinding === SessionBindingStrategy.Task
            ? SessionTarget.Task
            : form.sessionBinding === SessionBindingStrategy.Existing
              ? SessionTarget.Main
              : SessionTarget.Isolated,
        sessionKey:
          form.sessionBinding === SessionBindingStrategy.Existing && form.boundSessionId
            ? `${ManagedSessionKeyPrefix.Zhiyuan}${form.boundSessionId}`
            : null,
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
      setInitialForm(form);
      onDirtyChange?.(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setSubmitError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const planSelect = useMemo(
    () => (
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
    ),
    [form.planType, updateForm],
  );

  const scheduleControl = useMemo(() => {
    if (form.planType === 'advanced') {
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

    if (form.planType === 'cron') {
      return (
        <CronBuilder
          cronMode={form.cronMode}
          builder={form.cronBuilder}
          expr={form.cronExpr}
          timezone={form.cronTz}
          preview={cronPreview}
          planSelect={planSelect}
          onPatch={updateForm}
        />
      );
    }

    if (form.planType === 'once') {
      const dateValue = `${form.year}-${String(form.month).padStart(2, '0')}-${String(form.day).padStart(2, '0')}`;
      return (
        <div className="flex items-center gap-3">
          {planSelect}
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
          {planSelect}
          <TaskTimePicker hour={form.hour} minute={form.minute} onChange={updateForm} />
        </div>
      );
    }

    if (form.planType === 'hourly') {
      return (
        <div className="flex items-center gap-3">
          {planSelect}
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
      const weekdayShortLabels =
        i18nService.getLanguage() === 'zh' ? WEEKDAY_SHORT_LABELS_ZH : WEEKDAY_SHORT_LABELS_EN;

      return (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
            {planSelect}
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
            {weekdayShortLabels.map(([key, dayValue]) => (
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
        {planSelect}
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
  }, [form, cronPreview, task, planSelect, updateForm]);

  const notificationControl = useMemo(
    () => (
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
                const baseDisplayName = getNotifyChannelLabel(channel);
                const duplicateLabels = channelOptions.filter(
                  option => getNotifyChannelLabel(option) === baseDisplayName,
                );
                const displayName =
                  duplicateLabels.length > 1 && channel.accountId
                    ? `${baseDisplayName} · ${channel.accountId.slice(-4)}`
                    : baseDisplayName;
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
              >
                {selectedConversation ? getNotifyConversationLabel(selectedConversation) : undefined}
              </SelectValue>
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
                      {getNotifyConversationLabel(conv)}
                    </SelectItem>
                  ))
                )}
              </SelectGroup>
            </SelectContent>
          </Select>
        )}
      </div>
    ),
    [
      form.notifyChannel,
      form.notifyAccountId,
      form.notifyTo,
      channelOptions,
      conversations,
      conversationsLoading,
      selectedConversation,
      showConversationSelector,
      updateForm,
    ],
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
          modelOptions={modelOptions}
          workspaceOptions={workspaceOptions}
          sessionBinding={form.sessionBinding}
          boundSessionId={form.boundSessionId}
          sessionOptions={sessionOptions}
          sessionOptionsLoading={sessionOptionsLoading}
          scheduleControl={scheduleControl}
          notificationControl={notificationControl}
          onNameChange={handleNameChange}
          onModelChange={handleModelChange}
          onWorkspaceChange={handleWorkspaceChange}
          onSessionBindingChange={handleSessionBindingChange}
          onBoundSessionChange={handleBoundSessionChange}
          onPayloadTextChange={handlePayloadTextChange}
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

      <div className="shrink-0 flex items-center justify-end gap-2 py-2.5">
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
