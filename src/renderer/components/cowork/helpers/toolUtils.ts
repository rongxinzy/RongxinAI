import { i18nService } from '../../../services/i18n';

// ── General text ──

export const hasText = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

export const toTrimmedString = (value: unknown): string | null => (
  typeof value === 'string' && value.trim() ? value.trim() : null
);

export const formatUnknown = (value: unknown): string => {
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
};

export const getStringArray = (value: unknown): string | null => {
  if (!Array.isArray(value)) return null;
  const lines = value.filter((item) => typeof item === 'string') as string[];
  return lines.length > 0 ? lines.join('\n') : null;
};

export const truncatePreview = (value: string, maxLength = 120): string =>
  value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`;

export const formatStructuredText = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return value;
  try { return JSON.stringify(JSON.parse(trimmed), null, 2); } catch { return value; }
};

// ── ANSI / error tags ──

const TOOL_USE_ERROR_TAG_PATTERN = /^<tool_use_error>([\s\S]*?)<\/tool_use_error>$/i;
const ANSI_ESCAPE_PATTERN = /\[[0-?]*[ -/]*[@-~]/g;

export const normalizeToolResultText = (value: string): string => {
  const withoutAnsi = value.replace(ANSI_ESCAPE_PATTERN, '');
  const errorTagMatch = withoutAnsi.trim().match(TOOL_USE_ERROR_TAG_PATTERN);
  return errorTagMatch ? errorTagMatch[1].trim() : withoutAnsi;
};

// ── Tool name normalization ──

export const normalizeToolName = (value: string): string => value.toLowerCase().replace(/[\s_]+/g, '');

export const getToolDisplayName = (toolName: string | undefined): string => {
  if (!toolName) return 'Tool';
  switch (normalizeToolName(toolName)) {
    case 'cron': return 'Cron';
    case 'exec': case 'bash': case 'shell': return 'Bash';
    case 'read': case 'readfile': return 'Read';
    case 'write': case 'writefile': return 'Write';
    case 'edit': case 'editfile': return 'Edit';
    case 'multiedit': return 'MultiEdit';
    case 'process': return 'Process';
    default: return toolName;
  }
};

export const isBashLikeToolName = (toolName: string | undefined): boolean => {
  if (!toolName) return false;
  const n = normalizeToolName(toolName);
  return n === 'bash' || n === 'exec' || n === 'shell';
};

export const isTodoWriteToolName = (toolName: string | undefined): boolean => {
  if (!toolName) return false;
  return normalizeToolName(toolName) === 'todowrite';
};

export const isCronToolName = (toolName: string | undefined): boolean => {
  if (!toolName) return false;
  return normalizeToolName(toolName) === 'cron';
};

// ── Tool input extraction ──

export const getToolInputString = (
  input: Record<string, unknown>,
  keys: string[],
): string | null => {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return null;
};

// ── Cron tool summary ──

export const getCronToolSummary = (input: Record<string, unknown>): string | null => {
  const action = getToolInputString(input, ['action']);
  if (!action) return null;
  const job = input.job && typeof input.job === 'object'
    ? input.job as Record<string, unknown>
    : null;
  const jobName = job ? getToolInputString(job, ['name', 'id']) : null;
  const jobId = getToolInputString(input, ['jobId', 'id']) ?? (job ? getToolInputString(job, ['id']) : null);
  const wakeText = getToolInputString(input, ['text']);
  switch (action) {
    case 'add': return [action, jobName ?? jobId].filter(Boolean).join(' · ');
    case 'update': case 'remove': case 'run': case 'runs':
      return [action, jobId ?? jobName].filter(Boolean).join(' · ');
    case 'wake': return [action, wakeText].filter(Boolean).join(' · ');
    default: return action;
  }
};

// ── TodoWrite ──

export type TodoStatus = 'completed' | 'in_progress' | 'pending' | 'unknown';

export type ParsedTodoItem = {
  primaryText: string;
  secondaryText: string | null;
  status: TodoStatus;
};

const normalizeTodoStatus = (value: unknown): TodoStatus => {
  const normalized = typeof value === 'string'
    ? value.trim().toLowerCase().replace(/-/g, '_') : '';
  if (normalized === 'completed') return 'completed';
  if (normalized === 'in_progress' || normalized === 'running') return 'in_progress';
  if (normalized === 'pending' || normalized === 'todo') return 'pending';
  return 'unknown';
};

export const parseTodoWriteItems = (input: unknown): ParsedTodoItem[] | null => {
  if (!input || typeof input !== 'object') return null;
  const record = input as Record<string, unknown>;
  if (!Array.isArray(record.todos)) return null;
  const parsedItems = record.todos
    .map((rawTodo) => {
      if (!rawTodo || typeof rawTodo !== 'object') return null;
      const todo = rawTodo as Record<string, unknown>;
      const activeForm = toTrimmedString(todo.activeForm);
      const content = toTrimmedString(todo.content);
      const primaryText = activeForm ?? content ?? i18nService.t('coworkTodoUntitled');
      const secondaryText = content && content !== primaryText ? content : null;
      return { primaryText, secondaryText, status: normalizeTodoStatus(todo.status) } satisfies ParsedTodoItem;
    })
    .filter((item): item is ParsedTodoItem => item !== null);
  return parsedItems.length > 0 ? parsedItems : null;
};

export const getTodoWriteSummary = (items: ParsedTodoItem[]): string => {
  const completedCount = items.filter((item) => item.status === 'completed').length;
  const inProgressCount = items.filter((item) => item.status === 'in_progress').length;
  const pendingCount = items.length - completedCount - inProgressCount;
  const summary = [
    `${items.length} ${i18nService.t('coworkTodoItems')}`,
    `${completedCount} ${i18nService.t('coworkTodoCompleted')}`,
    `${inProgressCount} ${i18nService.t('coworkTodoInProgress')}`,
    `${pendingCount} ${i18nService.t('coworkTodoPending')}`,
  ];
  const activeItem = items.find((item) => item.status === 'in_progress');
  if (activeItem) summary.push(activeItem.primaryText);
  return summary.join(' · ');
};

// ── Tool input summary ──

export const getToolInputSummary = (
  toolName: string | undefined,
  toolInput?: Record<string, unknown>
): string | null => {
  if (!toolName || !toolInput) return null;
  const input = toolInput as Record<string, unknown>;
  if (isTodoWriteToolName(toolName)) {
    const items = parseTodoWriteItems(input);
    return items ? getTodoWriteSummary(items) : null;
  }
  switch (normalizeToolName(toolName)) {
    case 'cron': return getCronToolSummary(input);
    case 'bash': case 'exec': case 'shell':
      return getToolInputString(input, ['command', 'cmd', 'script'])
        ?? getStringArray(input.commands);
    case 'read': case 'readfile':
    case 'write': case 'writefile':
    case 'edit': case 'editfile':
    case 'multiedit':
      return getToolInputString(input, ['file_path', 'path', 'filePath', 'target_file', 'targetFile'])
        ?? (typeof input.content === 'string' && input.content.trim()
          ? truncatePreview(input.content.split('\n')[0].trim()) : null);
    case 'glob': case 'grep':
      return getToolInputString(input, ['pattern', 'query']);
    case 'task':
      return getToolInputString(input, ['description', 'task']);
    case 'webfetch':
      return getToolInputString(input, ['url']);
    case 'process': {
      const action = getToolInputString(input, ['action']);
      const sessionId = getToolInputString(input, ['sessionId', 'session_id']);
      if (action && sessionId) return `${action} · ${sessionId}`;
      return action ?? sessionId;
    }
    default: return null;
  }
};

// ── Tool input / result display ──

export const formatToolInput = (
  toolName: string | undefined,
  toolInput?: Record<string, unknown>
): string | null => {
  if (!toolInput) return null;
  const summary = getToolInputSummary(toolName, toolInput);
  if (summary?.trim()) return summary;
  return formatUnknown(toolInput);
};

export const getToolResultDisplay = (
  message: { content: string; metadata?: Record<string, unknown> | null }
): string => {
  const meta = message.metadata;
  if (hasText(message.content))
    return formatStructuredText(normalizeToolResultText(message.content));
  if (hasText(meta?.toolResult))
    return formatStructuredText(normalizeToolResultText(meta?.toolResult ?? ''));
  if (hasText(meta?.error))
    return formatStructuredText(normalizeToolResultText(meta?.error ?? ''));
  return '';
};
