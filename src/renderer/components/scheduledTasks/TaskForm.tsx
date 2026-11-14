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
import { CircleAlert, X } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';

import type { SessionBindingStrategy as SessionBindingStrategyType } from '../../../scheduledTask/constants';
import type { ScheduledTask } from '../../../scheduledTask/types';
import type { Workspace } from '../../../shared/workspace';
import { i18nService } from '../../services/i18n';
import {
  getLastPathSegment,
  getWorkspaceDisplayName,
  isScratchWorkspacePath,
} from '../../utils/path';
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
import {
  PLAN_LABEL_KEY,
  TASK_NAME_MAX_LENGTH,
  WEEKDAY_SHORT_LABELS_EN,
  WEEKDAY_SHORT_LABELS_ZH,
  buildTaskInput,
  createFormState,
  formsEqual,
  previewCron,
  type FormState,
} from './taskFormState';
import { formatScheduleLabel, type PlanType } from './utils';

interface TaskFormProps {
  mode: 'create' | 'edit';
  task?: ScheduledTask;
  prefill?: TaskTemplateValues;
  /** Folder the new task belongs to; falls back to the current folder. */
  initialWorkspaceId?: string;
  onCancel: () => void;
  onSaved: (newTaskId?: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
}

const getWorkspaceFolderName = (workspace: Workspace): string => {
  return getWorkspaceDisplayName(
    workspace.path,
    getLastPathSegment(workspace.path) || workspace.name,
    i18nService.t('defaultConversation'),
  );
};

const TaskForm: React.FC<TaskFormProps> = ({
  mode,
  task,
  prefill,
  initialWorkspaceId,
  onCancel,
  onSaved,
  onDirtyChange,
}) => {
  const [form, setForm] = useState<FormState>(() => createFormState(task, prefill));
  // Snapshot of the pristine form for the dirty check (shallow compare, no stringify).
  const [initialForm, setInitialForm] = useState<FormState>(() => createFormState(task, prefill));
  const availableModels = useSelector((state: RootState) => state.model.availableModels);
  const defaultSelectedModel = useSelector((state: RootState) => state.model.defaultSelectedModel);
  const workspaces = useSelector((state: RootState) => state.workspace.workspaces);
  const currentWorkspaceId = useSelector((state: RootState) => state.workspace.currentWorkspaceId);

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

  useEffect(() => {
    const nextForm = createFormState(task, prefill);
    setInitialForm(nextForm);
    setForm(nextForm);
  }, [task, prefill]);

  useEffect(() => {
    if (form.workspaceId) return;
    const workspaceId =
      initialWorkspaceId || currentWorkspaceId || workspaces.find(item => !item.isHidden)?.id || '';
    if (!workspaceId) return;
    setForm(current => (current.workspaceId ? current : { ...current, workspaceId }));
    setInitialForm(current => (current.workspaceId ? current : { ...current, workspaceId }));
  }, [form.workspaceId, initialWorkspaceId, currentWorkspaceId, workspaces]);

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
    }));
  }, []);
  const handleSessionBindingChange = useCallback((sessionBinding: SessionBindingStrategyType) => {
    setForm(current => ({
      ...current,
      sessionBinding,
    }));
  }, []);
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
  const workspaceOptions = useMemo(() => {
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
          !isScratchWorkspacePath(workspace.path) && (counts.get(folderName) ?? 0) > 1
            ? `${folderName} (${workspace.name})`
            : folderName,
      };
    });
  }, [workspaces]);

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
      // A cleared date field produces an Invalid Date, which must fail here
      // instead of reaching toISOString() in the submit path.
      if (!Number.isFinite(runAt.getTime()) || runAt.getTime() <= Date.now()) {
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
      const input = buildTaskInput(form, { mode, task, prefill });

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
              // Clearing the native date field must not write NaN components
              // into the form; keep the last valid date instead.
              const [y, mo, d] = e.target.value.split('-').map(Number);
              if (!e.target.value || !Number.isInteger(y) || !Number.isInteger(mo)) return;
              if (!Number.isInteger(d)) return;
              updateForm({ year: y, month: mo, day: d });
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

  return (
    <div className="flex flex-col min-h-0 h-full">
      <div className="flex-1 overflow-y-auto py-3 min-h-0">
        <TaskFormBody
          name={form.name}
          modelId={form.modelId}
          workspaceId={form.workspaceId}
          payloadText={form.payloadText}
          errors={errors}
          modelOptions={modelOptions}
          workspaceOptions={workspaceOptions}
          sessionBinding={form.sessionBinding}
          scheduleControl={scheduleControl}
          onNameChange={handleNameChange}
          onModelChange={handleModelChange}
          onWorkspaceChange={handleWorkspaceChange}
          onSessionBindingChange={handleSessionBindingChange}
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
