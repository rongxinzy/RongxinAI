import type { SourceItem } from '@shared/components/conversation';
import { i18nService } from '../../../services/i18n';

const MAX_STRUCTURED_FORMAT_CHARS = 100_000;
const TOOL_RESULT_COLLAPSE_LINE_LIMIT = 200;
const TOOL_RESULT_COLLAPSE_CHAR_LIMIT = 12_000;
const ANSI_ESCAPE_PATTERN = /\u001b\[[0-?]*[ -/]*[@-~]/g;
const TOOL_USE_ERROR_TAG_PATTERN = /^<tool_use_error>([\s\S]*?)<\/tool_use_error>$/i;

const hasText = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const truncatePreview = (value: string, maxLength = 120): string =>
  value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`;

const toTrimmedString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

const getToolInputString = (input: Record<string, unknown>, keys: string[]): string | null => {
  for (const key of keys) {
    const val = toTrimmedString(input[key]);
    if (val) return val;
  }
  return null;
};

export function collapseToolText(
  text: string,
  maxLines = TOOL_RESULT_COLLAPSE_LINE_LIMIT,
  maxChars = TOOL_RESULT_COLLAPSE_CHAR_LIMIT,
): { preview: string; collapsible: boolean } {
  if (!text) return { preview: '', collapsible: false };

  let newlineCount = 0;
  let searchFrom = 0;
  const scanLimit = Math.min(text.length, maxChars);

  while (searchFrom < scanLimit) {
    const nextNewline = text.indexOf('\n', searchFrom);
    if (nextNewline === -1 || nextNewline >= scanLimit) break;
    newlineCount += 1;
    if (newlineCount >= maxLines) {
      return { preview: text.slice(0, nextNewline), collapsible: true };
    }
    searchFrom = nextNewline + 1;
  }

  if (text.length > maxChars) {
    return { preview: text.slice(0, maxChars), collapsible: true };
  }

  return { preview: text, collapsible: false };
}

export function getToolDisplayName(toolName: string | undefined): string {
  if (!toolName) return 'Tool';
  if (toolName.startsWith('mcp__')) {
    return toolName.slice('mcp__'.length).split('__').join(' / ');
  }
  switch (toolName.trim().toLowerCase()) {
    case 'bash':
    case 'exec':
    case 'shell':
      return 'Bash';
    case 'read':
    case 'read_file':
      return 'Read';
    case 'write':
    case 'write_file':
      return 'Write';
    case 'edit':
    case 'edit_file':
      return 'Edit';
    case 'grep':
      return 'Grep';
    case 'find':
    case 'glob':
      return 'Find';
    case 'ls':
      return 'List';
    case 'web_search':
    case 'websearch':
      return i18nService.t('coworkToolWebSearch');
    case 'web_fetch':
    case 'webfetch':
      return 'Fetch';
    case 'python_execute':
      return 'Python';
    case 'python_install':
      return 'Python Install';
    case 'run_skill_script':
      return 'Skill Script';
    default:
      return toolName;
  }
}

export function getToolInputSummary(
  toolName: string | undefined,
  input?: Record<string, unknown>,
): string | null {
  if (!toolName || !input) return null;
  const key = toolName.trim().toLowerCase();
  if (key === 'bash' || key === 'exec' || key === 'shell') {
    const cmd = getToolInputString(input, ['command', 'cmd', 'script']);
    return cmd ? truncatePreview(cmd.split('\n')[0].trim(), 96) : null;
  }
  if (
    key === 'read' ||
    key === 'read_file' ||
    key === 'write' ||
    key === 'write_file' ||
    key === 'edit' ||
    key === 'edit_file'
  ) {
    return getToolInputString(input, [
      'path',
      'file_path',
      'filePath',
      'target_file',
      'targetFile',
    ]);
  }
  if (key === 'grep' || key === 'find' || key === 'glob' || key === 'ls') {
    return getToolInputString(input, ['pattern', 'query', 'path']);
  }
  if (key === 'web_search' || key === 'websearch') {
    return getToolInputString(input, ['query']);
  }
  if (key === 'web_fetch' || key === 'webfetch') {
    return getToolInputString(input, ['url']);
  }
  if (key === 'python_execute') {
    const code = getToolInputString(input, ['code']);
    return code ? truncatePreview(code.split('\n')[0].trim(), 80) : null;
  }
  if (key === 'run_skill_script') {
    return getToolInputString(input, ['script', 'skillId', 'skill']);
  }
  return getToolInputString(input, ['path', 'query', 'command', 'description']);
}

const normalizeToolResultText = (value: string): string => {
  const withoutAnsi = value.replace(ANSI_ESCAPE_PATTERN, '');
  const errorTagMatch = withoutAnsi.trim().match(TOOL_USE_ERROR_TAG_PATTERN);
  return errorTagMatch ? errorTagMatch[1].trim() : withoutAnsi;
};

const formatStructuredText = (value: string): string => {
  const trimmed = value.trim();
  if (
    trimmed.length > MAX_STRUCTURED_FORMAT_CHARS ||
    (!trimmed.startsWith('{') && !trimmed.startsWith('['))
  ) {
    return value;
  }
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return value;
  }
};

export function getToolResultDisplay(message: {
  content: string;
  metadata?: Record<string, unknown> | null;
}): string {
  const meta = message.metadata;
  if (hasText(message.content))
    return formatStructuredText(normalizeToolResultText(message.content));
  if (hasText(meta?.toolResult))
    return formatStructuredText(normalizeToolResultText(meta.toolResult));
  if (hasText(meta?.error)) return formatStructuredText(normalizeToolResultText(meta.error));
  return '';
}

export interface FileDiffSpec {
  fileName: string;
  oldContent: string;
  newContent: string;
}

export function extractFileDiffSpec(
  toolName: string,
  input?: Record<string, unknown>,
): FileDiffSpec | null {
  if (!input) return null;
  const key = toolName.trim().toLowerCase();
  if (key !== 'edit' && key !== 'edit_file' && key !== 'write' && key !== 'write_file') {
    return null;
  }
  const fileName =
    getToolInputString(input, ['path', 'file_path', 'filePath', 'target_file', 'targetFile']) ??
    'file';
  if (typeof input.oldText === 'string' && typeof input.newText === 'string') {
    return { fileName, oldContent: input.oldText, newContent: input.newText };
  }
  if (typeof input.old_string === 'string' && typeof input.new_string === 'string') {
    return { fileName, oldContent: input.old_string, newContent: input.new_string };
  }
  if ((key === 'write' || key === 'write_file') && typeof input.content === 'string') {
    return { fileName, oldContent: '', newContent: input.content };
  }
  return null;
}

export function extractWebSources(input?: Record<string, unknown>, output?: string): SourceItem[] {
  const seen = new Set<string>();
  const sources: SourceItem[] = [];

  const pushUrl = (url: unknown, title?: unknown, snippet?: unknown) => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return;
    if (seen.has(url)) return;
    seen.add(url);
    sources.push({
      url,
      title: typeof title === 'string' ? title : undefined,
      snippet: typeof snippet === 'string' ? snippet : undefined,
    });
  };

  if (typeof input?.url === 'string') {
    pushUrl(input.url);
  }

  if (output) {
    try {
      const parsed = JSON.parse(output) as unknown;
      const items = Array.isArray(parsed)
        ? parsed
        : parsed &&
            typeof parsed === 'object' &&
            Array.isArray((parsed as { results?: unknown }).results)
          ? (parsed as { results: unknown[] }).results
          : [];
      for (const item of items) {
        if (!item || typeof item !== 'object') continue;
        const entry = item as Record<string, unknown>;
        pushUrl(
          entry.url ?? entry.link,
          entry.title ?? entry.name,
          entry.snippet ?? entry.description,
        );
      }
    } catch {
      const matches = output.match(/https?:\/\/[^\s"'<>)\]]+/g) ?? [];
      for (const url of matches.slice(0, 8)) {
        pushUrl(url);
      }
    }
  }

  return sources.slice(0, 8);
}
