import {
  DeliveryMode,
  PayloadKind,
  SessionBindingStrategy,
  SessionTarget,
  WakeMode,
  type SessionBindingStrategy as SessionBindingStrategyType,
} from '../../../scheduledTask/constants';
import type { ScheduledTask, ScheduledTaskInput } from '../../../scheduledTask/types';
import {
  DEFAULT_CRON_BUILDER,
  cronBuilderToExpr,
  exprToCronBuilder,
  type CronBuilderValue,
  type CronMode,
  type CronPreview,
} from './CronBuilder';
import type { TaskTemplateValues } from './TaskTemplateGallery';
import { formatScheduleLabel, type PlanType, scheduleToPlanInfo } from './utils';

export interface FormState {
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
  cronExpr: string;
  cronTz: string;
  cronMode: CronMode;
  cronBuilder: CronBuilderValue;
  workspaceId: string;
  modelId: string;
  sessionBinding: SessionBindingStrategyType;
}

export const TASK_NAME_MAX_LENGTH = 200;

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

// Default plan for a brand-new task form. Templates seed their own plan from
// their cron expr instead (see createFormState).
const DEFAULT_FORM_STATE: FormState = {
  name: '',
  description: '',
  planType: 'hourly',
  ...nowDefaults(),
  weekdays: [1, 2, 3, 4, 5],
  monthDay: 1,
  payloadText: '',
  cronExpr: '',
  cronTz: '',
  cronMode: 'builder',
  cronBuilder: { ...DEFAULT_CRON_BUILDER },
  workspaceId: '',
  modelId: '',
  sessionBinding: SessionBindingStrategy.PerRun,
};

export const PLAN_LABEL_KEY = {
  once: 'scheduledTasksFormScheduleModeOnce',
  hourly: 'scheduledTasksFormScheduleModeHourly',
  daily: 'scheduledTasksFormScheduleModeDaily',
  weekly: 'scheduledTasksFormScheduleModeWeekly',
  monthly: 'scheduledTasksFormScheduleModeMonthly',
  cron: 'scheduledTasksFormScheduleModeCronCustom',
  advanced: 'scheduledTasksFormScheduleModeCronCustom',
} as const;

// Locale-aware weekday order:
// zh: Mon(1)→Sun(0) — Chinese convention starts with Monday
// en: Sun(0)→Sat(6) — English convention starts with Sunday
export const WEEKDAY_SHORT_LABELS_ZH: ReadonlyArray<readonly [string, number]> = [
  ['scheduledTasksFormWeekShortMon', 1],
  ['scheduledTasksFormWeekShortTue', 2],
  ['scheduledTasksFormWeekShortWed', 3],
  ['scheduledTasksFormWeekShortThu', 4],
  ['scheduledTasksFormWeekShortFri', 5],
  ['scheduledTasksFormWeekShortSat', 6],
  ['scheduledTasksFormWeekShortSun', 0],
];
export const WEEKDAY_SHORT_LABELS_EN: ReadonlyArray<readonly [string, number]> = [
  ['scheduledTasksFormWeekShortSun', 0],
  ['scheduledTasksFormWeekShortMon', 1],
  ['scheduledTasksFormWeekShortTue', 2],
  ['scheduledTasksFormWeekShortWed', 3],
  ['scheduledTasksFormWeekShortThu', 4],
  ['scheduledTasksFormWeekShortFri', 5],
  ['scheduledTasksFormWeekShortSat', 6],
];

export function createFormState(task?: ScheduledTask, prefill?: TaskTemplateValues): FormState {
  if (!task) {
    const defaults = { ...DEFAULT_FORM_STATE, ...nowDefaults() };
    if (prefill) {
      const parsedBuilder = exprToCronBuilder(prefill.schedule.expr) ?? { ...DEFAULT_CRON_BUILDER };
      // Templates ship a cron expr; map it back onto the matching structured plan
      // so the form shows the template's real schedule ("每天 9:00") instead of
      // always falling back to 自定义（Cron）.
      const planInfo = scheduleToPlanInfo(prefill.schedule);
      return {
        ...defaults,
        name: prefill.name,
        description: prefill.description,
        // 'advanced' has no structured representation: keep the cron plan so the
        // raw expression is preserved and submitted verbatim.
        planType: planInfo.planType === 'advanced' ? 'cron' : planInfo.planType,
        hour: planInfo.hour,
        minute: planInfo.minute,
        second: planInfo.second,
        weekdays: planInfo.weekdays,
        monthDay: planInfo.monthDay,
        cronExpr: prefill.schedule.expr,
        cronTz: planInfo.cronTz ?? '',
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
    cronExpr: rawCronExpr,
    cronTz: planInfo.cronTz ?? (task.schedule.kind === 'cron' ? (task.schedule.tz ?? '') : ''),
    cronMode: 'builder',
    cronBuilder: parsedBuilder,
    workspaceId: task.workspaceId || '',
    modelId: task.payload.kind === 'agentTurn' ? (task.payload.model ?? '') : '',
    sessionBinding:
      task.sessionTarget === SessionTarget.Task
        ? SessionBindingStrategy.Task
        : SessionBindingStrategy.PerRun,
  };
}

export function buildScheduleInput(form: FormState): ScheduledTaskInput['schedule'] {
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

/**
 * Builds the canonical task payload from the form.
 *
 * Edit mode must not rewrite fields the form does not own: `enabled` belongs to
 * the task-list switch and `description` belongs to templates and legacy
 * imports, so both are carried over instead of being reset.
 */
export function buildTaskInput(
  form: FormState,
  context: { mode: 'create' | 'edit'; task?: ScheduledTask; prefill?: TaskTemplateValues },
): ScheduledTaskInput {
  const { mode, task, prefill } = context;
  return {
    name: form.name.trim(),
    description: mode === 'create' ? (prefill?.description ?? '') : (task?.description ?? ''),
    enabled: mode === 'create' ? true : (task?.enabled ?? true),
    // An "advanced" schedule has no editable fields, so it is carried over as is.
    schedule: form.planType === 'advanced' && task ? task.schedule : buildScheduleInput(form),
    sessionTarget:
      form.sessionBinding === SessionBindingStrategy.Task
        ? SessionTarget.Task
        : SessionTarget.Isolated,
    sessionKey: null,
    wakeMode: WakeMode.Now,
    workspaceId: form.workspaceId,
    payload: {
      kind: PayloadKind.AgentTurn,
      message: form.payloadText.trim(),
      ...(form.modelId ? { model: form.modelId } : {}),
    },

    delivery: { mode: DeliveryMode.None },
  };
}

// Returns the human-readable cron description, or null if the expression is
// syntactically invalid (wrong number of fields, parse error).
// Distinguishes from an empty/blank expression which returns null without error.
export function previewCron(expr: string): CronPreview {
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

function cronBuildersEqual(a: CronBuilderValue, b: CronBuilderValue): boolean {
  return (
    a.minute === b.minute &&
    a.hour === b.hour &&
    a.dom === b.dom &&
    a.month === b.month &&
    a.dow === b.dow
  );
}

/**
 * Shallow field-by-field form comparison for the dirty check. Replaces the
 * former per-render JSON.stringify of the whole form.
 */
export function formsEqual(a: FormState, b: FormState): boolean {
  return (
    a.name === b.name &&
    a.description === b.description &&
    a.planType === b.planType &&
    a.year === b.year &&
    a.month === b.month &&
    a.day === b.day &&
    a.hour === b.hour &&
    a.minute === b.minute &&
    a.second === b.second &&
    a.weekdays.length === b.weekdays.length &&
    a.weekdays.every((day, index) => day === b.weekdays[index]) &&
    a.monthDay === b.monthDay &&
    a.payloadText === b.payloadText &&
    a.cronExpr === b.cronExpr &&
    a.cronTz === b.cronTz &&
    a.cronMode === b.cronMode &&
    cronBuildersEqual(a.cronBuilder, b.cronBuilder) &&
    a.workspaceId === b.workspaceId &&
    a.modelId === b.modelId &&
    a.sessionBinding === b.sessionBinding
  );
}
