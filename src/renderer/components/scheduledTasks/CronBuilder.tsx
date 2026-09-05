import { FieldDescription, FieldLabel } from '@shared/components/ui/field';
import { FluidTabs } from '@shared/components/ui/fluid-tabs';
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
import React from 'react';

import { i18nService } from '../../services/i18n';

export interface CronBuilderValue {
  minute: string; // e.g. '0', '*/5', '*/15', '*/30', '*'
  hour: string; // e.g. '9', '*/2', '*'
  dom: string; // e.g. '*', '1', '15'
  month: string; // e.g. '*'
  dow: string; // e.g. '*', '1-5', '1', '0'
}

export type CronMode = 'builder' | 'raw';

export type CronPreview = { ok: true; label: string } | { ok: false } | null;

export const DEFAULT_CRON_BUILDER: CronBuilderValue = {
  minute: '0',
  hour: '9',
  dom: '*',
  month: '*',
  dow: '*',
};

export function cronBuilderToExpr(b: CronBuilderValue): string {
  return `${b.minute} ${b.hour} ${b.dom} ${b.month} ${b.dow}`;
}

/** Best-effort parse of a 5-field cron expr into builder fields. */
export function exprToCronBuilder(expr: string): CronBuilderValue | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [minute, hour, dom, month, dow] = parts;
  return { minute, hour, dom, month, dow };
}

/** Subset of the task form fields this component is allowed to patch. */
export interface CronFormPatch {
  cronMode?: CronMode;
  cronExpr?: string;
  cronTz?: string;
  cronBuilder?: CronBuilderValue;
}

// Cron quick-pick examples: [label key, expr]
const CRON_QUICK_PICKS: Array<{ labelKey: string; expr: string }> = [
  { labelKey: 'scheduledTasksFormCronQuickEveryDay', expr: '0 9 * * *' },
  { labelKey: 'scheduledTasksFormCronQuickWeekday', expr: '0 9 * * 1-5' },
  { labelKey: 'scheduledTasksFormCronQuickEveryHour', expr: '0 * * * *' },
  { labelKey: 'scheduledTasksFormCronQuickEvery15min', expr: '*/15 * * * *' },
];

const WEEKDAY_KEYS = [
  'scheduledTasksFormWeekSun',
  'scheduledTasksFormWeekMon',
  'scheduledTasksFormWeekTue',
  'scheduledTasksFormWeekWed',
  'scheduledTasksFormWeekThu',
  'scheduledTasksFormWeekFri',
  'scheduledTasksFormWeekSat',
] as const;

const MINUTE_OPTIONS = Array.from({ length: 60 }, (_, i) => i);
const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => i);
const DOM_OPTIONS = Array.from({ length: 31 }, (_, i) => i + 1);
const MONTH_OPTIONS = Array.from({ length: 12 }, (_, i) => i + 1);

interface CronBuilderProps {
  cronMode: CronMode;
  builder: CronBuilderValue;
  expr: string;
  timezone: string;
  preview: CronPreview;
  /** The shared schedule-type select rendered above the cron controls. */
  planSelect: React.ReactNode;
  onPatch: (patch: CronFormPatch) => void;
}

const CronBuilder: React.FC<CronBuilderProps> = ({
  cronMode,
  builder,
  expr,
  timezone,
  preview,
  planSelect,
  onPatch,
}) => {
  // Derive current cron expression from builder or raw input
  const currentExpr = cronMode === 'builder' ? cronBuilderToExpr(builder) : expr;

  const handleSwitchToRaw = () => {
    onPatch({ cronMode: 'raw', cronExpr: cronBuilderToExpr(builder) });
  };

  const handleSwitchToBuilder = () => {
    const parsed = exprToCronBuilder(expr);
    if (parsed) {
      onPatch({ cronMode: 'builder', cronBuilder: parsed });
    } else {
      onPatch({ cronMode: 'builder' });
    }
  };

  const patchBuilder = (field: keyof CronBuilderValue, value: string) => {
    onPatch({ cronBuilder: { ...builder, [field]: value } });
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">{planSelect}</div>

      <FluidTabs<CronMode>
        aria-label={i18nService.t('scheduledTasksFormCronExpression')}
        value={cronMode}
        onValueChange={value => {
          if (value === 'builder') handleSwitchToBuilder();
          if (value === 'raw') handleSwitchToRaw();
        }}
        items={[
          {
            value: 'builder',
            label: i18nService.t(
              'scheduledTasksFormCronModeBuilder' as Parameters<typeof i18nService.t>[0],
            ),
          },
          {
            value: 'raw',
            label: i18nService.t(
              'scheduledTasksFormCronModeRaw' as Parameters<typeof i18nService.t>[0],
            ),
          },
        ]}
      />

      {cronMode === 'builder' ? (
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
              value={builder.minute}
              onValueChange={value => value && patchBuilder('minute', value)}
            >
              <SelectTrigger className="theme-control-small-text w-full min-w-20">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="*">*</SelectItem>
                  {MINUTE_OPTIONS.map(i => (
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
              value={builder.hour}
              onValueChange={value => value && patchBuilder('hour', value)}
            >
              <SelectTrigger className="theme-control-small-text w-full min-w-20">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="*">*</SelectItem>
                  {HOUR_OPTIONS.map(i => (
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
              value={builder.dom}
              onValueChange={value => value && patchBuilder('dom', value)}
            >
              <SelectTrigger className="theme-control-small-text w-full min-w-20">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="*">*</SelectItem>
                  {DOM_OPTIONS.map(d => (
                    <SelectItem key={d} value={String(d)}>
                      {d}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            {/* Month */}
            <Select
              value={builder.month}
              onValueChange={value => value && patchBuilder('month', value)}
            >
              <SelectTrigger className="theme-control-small-text w-full min-w-20">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="*">*</SelectItem>
                  {MONTH_OPTIONS.map(m => (
                    <SelectItem key={m} value={String(m)}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            {/* DOW (day of week) */}
            <Select
              value={builder.dow}
              onValueChange={value => value && patchBuilder('dow', value)}
            >
              <SelectTrigger className="theme-control-small-text w-full min-w-20">
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
                  <SelectItem value="1-5">{i18nService.t('scheduledTasksCronWeekdays')}</SelectItem>
                  <SelectItem value="0,6">{i18nService.t('scheduledTasksCronWeekends')}</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          {/* Generated expression preview */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground font-mono bg-surface px-2 py-1 rounded border border-border flex-1 truncate">
              {currentExpr}
            </span>
            {preview !== null && (
              <span
                className={
                  preview.ok
                    ? 'text-xs shrink-0 text-muted-foreground'
                    : 'text-xs shrink-0 text-destructive'
                }
              >
                {preview.ok
                  ? preview.label
                  : i18nService.t(
                      'scheduledTasksFormCronPreviewInvalid' as Parameters<typeof i18nService.t>[0],
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
            value={expr}
            onChange={e => onPatch({ cronExpr: e.target.value })}
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
          {expr.trim() && preview !== null && (
            <div
              className={
                preview.ok
                  ? 'mt-1 flex items-center gap-1.5 text-xs text-muted-foreground'
                  : 'mt-1 flex items-center gap-1.5 text-xs text-destructive'
              }
            >
              {preview.ok ? (
                <>
                  <span className="opacity-60">
                    {i18nService.t(
                      'scheduledTasksFormCronPreview' as Parameters<typeof i18nService.t>[0],
                    )}
                  </span>
                  <span className="font-medium">{preview.label}</span>
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
          {i18nService.t('scheduledTasksFormCronQuickTitle' as Parameters<typeof i18nService.t>[0])}
        </p>
        <ToggleGroup
          value={[currentExpr]}
          onValueChange={value => {
            const expr = value[0];
            if (!expr) return;
            const parsed = exprToCronBuilder(expr);
            onPatch({
              cronExpr: expr,
              cronBuilder: parsed ?? builder,
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
          value={timezone}
          onChange={e => onPatch({ cronTz: e.target.value })}
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

export default React.memo(CronBuilder);
