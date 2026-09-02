import { PlatformRegistry } from '@shared/platform';

import {
  ManagedSessionKeyPrefix,
  SessionBindingStrategy,
  SessionTarget,
  type SessionBindingStrategy as SessionBindingStrategyType,
} from '../../../scheduledTask/constants';
import type {
  ScheduledTask,
  ScheduledTaskChannelOption,
  ScheduledTaskInput,
  ScheduledTaskConversationOption,
} from '../../../scheduledTask/types';
import { i18nService } from '../../services/i18n';
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
  notifyChannel: string;
  notifyTo: string;
  cronExpr: string;
  cronTz: string;
  cronMode: CronMode;
  cronBuilder: CronBuilderValue;
  notifyAccountId: string | undefined;
  workspaceId: string;
  modelId: string;
  sessionBinding: SessionBindingStrategyType;
  boundSessionId: string;
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
  sessionBinding: SessionBindingStrategy.PerRun,
  boundSessionId: '',
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

export function isIMChannel(channel: string): boolean {
  return PlatformRegistry.isIMChannel(channel);
}

export function createFormState(task?: ScheduledTask, prefill?: TaskTemplateValues): FormState {
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
    sessionBinding:
      task.sessionTarget === SessionTarget.Task
        ? SessionBindingStrategy.Task
        : task.sessionTarget === SessionTarget.Main &&
            Boolean(task.sessionKey?.startsWith(ManagedSessionKeyPrefix.Zhiyuan))
          ? SessionBindingStrategy.Existing
          : SessionBindingStrategy.PerRun,
    boundSessionId:
      task.sessionTarget === SessionTarget.Main &&
      task.sessionKey?.startsWith(ManagedSessionKeyPrefix.Zhiyuan)
        ? task.sessionKey.slice(ManagedSessionKeyPrefix.Zhiyuan.length)
        : '',
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
    a.notifyChannel === b.notifyChannel &&
    a.notifyTo === b.notifyTo &&
    a.cronExpr === b.cronExpr &&
    a.cronTz === b.cronTz &&
    a.cronMode === b.cronMode &&
    cronBuildersEqual(a.cronBuilder, b.cronBuilder) &&
    a.notifyAccountId === b.notifyAccountId &&
    a.workspaceId === b.workspaceId &&
    a.modelId === b.modelId &&
    a.sessionBinding === b.sessionBinding &&
    a.boundSessionId === b.boundSessionId
  );
}

export function getNotifyChannelLabel(channel: ScheduledTaskChannelOption): string {
  const platform = PlatformRegistry.platformOfChannel(channel.value);
  const platformLabel = platform ? i18nService.t(platform) || channel.label : channel.label;
  // Singleton platforms use the platform name only. Multi-instance options
  // carry a distinct instance label (for example, "Bot 1") after the dot.
  const defaultLabel = platform ? PlatformRegistry.get(platform).label : channel.label;
  return channel.accountId && channel.label !== defaultLabel
    ? `${platformLabel} · ${channel.label}`
    : platformLabel;
}

export function getNotifyConversationLabel(conversation: Pick<ScheduledTaskConversationOption, 'conversationId'>): string {
  const conversationId = conversation.conversationId.trim();
  if (conversationId === 'dm') return i18nService.t('scheduledTasksFormNotifyDirectMessage');
  if (conversationId.startsWith('group:')) return `${i18nService.t('scheduledTasksFormNotifyGroup')} · ${conversationId.slice(6)}`;
  // Connectors may return opaque user/session IDs for direct chats. They are
  // routing keys, not human-facing names, so never expose them in the form.
  return conversationId
    ? i18nService.t('scheduledTasksFormNotifyDirectMessage')
    : i18nService.t('scheduledTasksFormNotifyConversationUnknown');
}
