import { Button } from '@shared/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@shared/components/ui/popover';
import { ScrollArea } from '@shared/components/ui/scroll-area';
import { cn } from '@shared/lib/utils';
import { Clock3 } from 'lucide-react';
import React, { useState } from 'react';

import { i18nService } from '../../services/i18n';

const HOURS = Array.from({ length: 24 }, (_, index) => index);
const MINUTES = Array.from({ length: 60 }, (_, index) => index);
const SECONDS = Array.from({ length: 60 }, (_, index) => index);

interface TaskTimePickerProps {
  hour: number;
  minute: number;
  second?: number;
  onChange: (value: { hour: number; minute: number; second?: number }) => void;
}

interface TimeColumnProps {
  label: string;
  values: number[];
  selectedValue: number;
  onSelect: (value: number) => void;
}

function padTimeUnit(value: number): string {
  return String(value).padStart(2, '0');
}

const TimeColumn: React.FC<TimeColumnProps> = React.memo(
  ({ label, values, selectedValue, onSelect }) => (
    <div className="min-w-0">
      <p className="mb-1 text-xs text-muted-foreground">{label}</p>
      <ScrollArea className="h-48">
        <div className="flex flex-col gap-1 pr-2">
          {values.map(value => (
            <Button
              key={value}
              type="button"
              variant={selectedValue === value ? 'secondary' : 'ghost'}
              size="xs"
              className="w-full justify-center"
              onClick={() => onSelect(value)}
            >
              {padTimeUnit(value)}
            </Button>
          ))}
        </div>
      </ScrollArea>
    </div>
  ),
);

const TaskTimePicker: React.FC<TaskTimePickerProps> = ({ hour, minute, second, onChange }) => {
  const [open, setOpen] = useState(false);
  const includesSeconds = second !== undefined;
  const timeLabel = includesSeconds
    ? `${padTimeUnit(hour)}:${padTimeUnit(minute)}:${padTimeUnit(second)}`
    : `${padTimeUnit(hour)}:${padTimeUnit(minute)}`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        nativeButton={true}
        render={
          <Button type="button" variant="outline" className="flex-1 min-w-0 justify-between">
            <span>{timeLabel}</span>
            <Clock3 data-icon="inline-end" />
          </Button>
        }
      />
      <PopoverContent className="w-72" align="start">
        <div className={cn('grid gap-2', includesSeconds ? 'grid-cols-3' : 'grid-cols-2')}>
          <TimeColumn
            label={i18nService.t('scheduledTasksFormCronField_hour')}
            values={HOURS}
            selectedValue={hour}
            onSelect={nextHour => onChange({ hour: nextHour, minute, second })}
          />
          <TimeColumn
            label={i18nService.t('scheduledTasksFormCronField_minute')}
            values={MINUTES}
            selectedValue={minute}
            onSelect={nextMinute => {
              onChange({ hour, minute: nextMinute, second });
              if (!includesSeconds) setOpen(false);
            }}
          />
          {includesSeconds && (
            <TimeColumn
              label={i18nService.t('scheduledTasksFormCronField_second')}
              values={SECONDS}
              selectedValue={second}
              onSelect={nextSecond => {
                onChange({ hour, minute, second: nextSecond });
                setOpen(false);
              }}
            />
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default React.memo(TaskTimePicker);
