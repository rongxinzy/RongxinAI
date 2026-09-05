import { Button } from '@shared/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@shared/components/ui/popover';
import { cn } from '@shared/lib/utils';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import React, { useCallback, useEffect, useState } from 'react';

import { i18nService } from '../../services/i18n';

interface DateInputProps {
  value: string; // YYYY-MM-DD or ''
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  placeholder?: string;
}

const WEEKDAY_KEYS = [
  'scheduledTasksFormWeekShortSun',
  'scheduledTasksFormWeekShortMon',
  'scheduledTasksFormWeekShortTue',
  'scheduledTasksFormWeekShortWed',
  'scheduledTasksFormWeekShortThu',
  'scheduledTasksFormWeekShortFri',
  'scheduledTasksFormWeekShortSat',
] as const;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function toYMD(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`;
}

function parseYMD(s: string): { y: number; m: number; d: number } | null {
  const [y, m, d] = s.split('-').map(Number);
  if (Number.isNaN(y) || Number.isNaN(m) || Number.isNaN(d)) return null;
  return { y, m, d };
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function firstDayOfWeek(year: number, month: number): number {
  return new Date(year, month - 1, 1).getDay();
}

const DateInput: React.FC<DateInputProps> = ({ value, onChange, min, max, placeholder }) => {
  const [open, setOpen] = useState(false);

  // Calendar view state: the month currently displayed
  const today = new Date();
  const parsed = value ? parseYMD(value) : null;
  const [viewYear, setViewYear] = useState(parsed?.y ?? today.getFullYear());
  const [viewMonth, setViewMonth] = useState(parsed?.m ?? today.getMonth() + 1);

  // Sync view to value when it changes externally
  useEffect(() => {
    if (value) {
      const p = parseYMD(value);
      if (p) {
        setViewYear(p.y);
        setViewMonth(p.m);
      }
    }
  }, [value]);

  const goPrev = useCallback(() => {
    setViewMonth(m => {
      if (m === 1) {
        setViewYear(y => y - 1);
        return 12;
      }
      return m - 1;
    });
  }, []);

  const goNext = useCallback(() => {
    setViewMonth(m => {
      if (m === 12) {
        setViewYear(y => y + 1);
        return 1;
      }
      return m + 1;
    });
  }, []);

  const handleSelect = (day: number) => {
    onChange(toYMD(viewYear, viewMonth, day));
    setOpen(false);
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange('');
  };

  const isDisabled = (day: number): boolean => {
    const dateStr = toYMD(viewYear, viewMonth, day);
    if (min && dateStr < min) return true;
    if (max && dateStr > max) return true;
    return false;
  };

  // Build the calendar grid
  const totalDays = daysInMonth(viewYear, viewMonth);
  const startDay = firstDayOfWeek(viewYear, viewMonth);
  const todayStr = toYMD(today.getFullYear(), today.getMonth() + 1, today.getDate());

  // Display text
  const displayText = parsed ? `${parsed.y}/${pad(parsed.m)}/${pad(parsed.d)}` : '';

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className="relative inline-flex">
        <PopoverTrigger
          nativeButton={true}
          render={
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={cn(
                'theme-page-date-input-button-variant-1 flex items-center',
                value && 'theme-page-date-input-button-variant-2',
                open
                  ? 'theme-page-date-input-button-variant-3'
                  : cn(
                      'theme-page-date-input-button-variant-4',
                      value
                        ? 'theme-page-date-input-button-variant-5'
                        : 'theme-page-date-input-button-variant-6',
                    ),
              )}
            >
              <Calendar className="h-3 w-3 shrink-0 opacity-60" />
              <span className={value ? '' : 'opacity-50'}>
                {displayText || placeholder || '----/--/--'}
              </span>
            </Button>
          }
        />
        {value && (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={i18nService.t('clear')}
            onClick={handleClear}
            className="absolute top-1/2 right-0.5 -translate-y-1/2"
          >
            ×
          </Button>
        )}
      </div>
      <PopoverContent align="start" className="theme-control-sizing-10 w-auto min-w-60 select-none">
        {/* Month/Year nav */}
        <div className="flex items-center justify-between mb-2">
          <Button type="button" variant="ghost" size="icon-xs" onClick={goPrev}>
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          <span className="text-xs font-medium text-foreground">
            {viewYear} / {pad(viewMonth)}
          </span>
          <Button type="button" variant="ghost" size="icon-xs" onClick={goNext}>
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* Weekday headers */}
        <div className="grid grid-cols-7 gap-0.5 mb-1">
          {WEEKDAY_KEYS.map(key => (
            <div key={key} className="text-center text-xs text-muted-foreground py-0.5">
              {i18nService.t(key)}
            </div>
          ))}
        </div>

        {/* Day grid */}
        <div className="grid grid-cols-7 gap-0.5">
          {/* Empty cells before the first day */}
          {Array.from({ length: startDay }, (_, i) => (
            <div key={`e-${i}`} />
          ))}
          {/* Day cells */}
          {Array.from({ length: totalDays }, (_, i) => {
            const day = i + 1;
            const dateStr = toYMD(viewYear, viewMonth, day);
            const isSelected = dateStr === value;
            const isToday = dateStr === todayStr;
            const disabled = isDisabled(day);
            return (
              <Button
                key={day}
                type="button"
                variant="ghost"
                size="icon-xs"
                disabled={disabled}
                onClick={() => handleSelect(day)}
                className={cn(
                  'theme-page-date-input-button-variant-7',
                  isSelected
                    ? 'theme-page-date-input-button-variant-8'
                    : disabled
                      ? 'theme-page-date-input-button-variant-9 cursor-not-allowed'
                      : isToday
                        ? 'theme-page-date-input-button-variant-10'
                        : 'theme-page-date-input-button-variant-11',
                )}
              >
                {day}
              </Button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default DateInput;
