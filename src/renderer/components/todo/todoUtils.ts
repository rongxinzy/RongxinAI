import { TodoStatus, type Todo } from '../../../shared/todo';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const startOfDay = (date: Date): Date => {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
};

const endOfDay = (date: Date): number => {
  const result = new Date(date);
  result.setHours(23, 59, 59, 999);
  return result.getTime();
};

export const formatDateKey = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const todayDateKey = (): string => formatDateKey(new Date());

export const toDateInputValue = (timestamp: number | null): string => {
  if (timestamp === null) return '';
  return formatDateKey(new Date(timestamp));
};

export const toDateTimeInputValue = (timestamp: number | null): string => {
  if (timestamp === null) return '';
  const date = new Date(timestamp);
  const dateKey = formatDateKey(date);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${dateKey}T${hours}:${minutes}`;
};

export const fromDateInputValue = (value: string): number | null => {
  if (!value) return null;
  const [year, month, day] = value.split('-').map(Number);
  if (![year, month, day].every(Number.isInteger)) return null;
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return endOfDay(date);
};

export const fromDateTimeInputValue = (value: string): number | null => {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
};

export const formatTodoDate = (timestamp: number, language: 'zh' | 'en'): string =>
  new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN' : 'en-US', {
    month: 'short',
    day: 'numeric',
  }).format(new Date(timestamp));

export const formatTodoDateTime = (timestamp: number, language: 'zh' | 'en'): string =>
  new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN' : 'en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(timestamp));

export const isTodoOverdue = (todo: Todo, now = Date.now()): boolean =>
  todo.status === TodoStatus.Active && todo.dueAt !== null && todo.dueAt < now;

export interface ParsedTodoInput {
  dueAt: number | null;
  important: boolean;
}

const dateForWeekday = (now: Date, weekday: number): Date => {
  const date = startOfDay(now);
  const offset = (weekday - date.getDay() + 7) % 7;
  date.setTime(date.getTime() + offset * MS_PER_DAY);
  return date;
};

export const parseTodoInput = (value: string, now = new Date()): ParsedTodoInput => {
  const normalized = value.toLocaleLowerCase();
  let dueAt: number | null = null;
  if (/今天/.test(normalized) || /\btoday\b/.test(normalized)) {
    dueAt = endOfDay(now);
  } else if (/后天/.test(normalized) || /\bday after tomorrow\b/.test(normalized)) {
    dueAt = endOfDay(new Date(now.getTime() + 2 * MS_PER_DAY));
  } else if (/明天/.test(normalized) || /\btomorrow\b/.test(normalized)) {
    dueAt = endOfDay(new Date(now.getTime() + MS_PER_DAY));
  } else {
    const weekdayMatch = normalized.match(
      /(?:周|星期)(日|天|一|二|三|四|五|六)|\b(mon|tue|wed|thu|fri|sat|sun)\b/,
    );
    if (weekdayMatch) {
      const weekdayName = weekdayMatch[1] ?? weekdayMatch[2];
      const weekday = weekdayName
        ? (
            {
              日: 0,
              天: 0,
              一: 1,
              二: 2,
              三: 3,
              四: 4,
              五: 5,
              六: 6,
              mon: 1,
              tue: 2,
              wed: 3,
              thu: 4,
              fri: 5,
              sat: 6,
              sun: 0,
            } as Record<string, number>
          )[weekdayName]
        : undefined;
      if (weekday !== undefined) dueAt = endOfDay(dateForWeekday(now, weekday));
    }
  }

  return {
    dueAt,
    important: /重要|很重要|\bimportant\b/.test(normalized),
  };
};
