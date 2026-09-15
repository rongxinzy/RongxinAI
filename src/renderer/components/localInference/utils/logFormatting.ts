const MODEL_LAUNCH_LOG_PREFIX_PATTERN =
  /^(?:\d{4})-(?<monthDay>\d{2}-\d{2}) (?<time>\d{2}:\d{2}:\d{2})(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?\s+-\s+.+?\s+-\s+[A-Z]+\s+-\s+(?<message>.*)$/;

export function formatModelLaunchLogLine(line: string): string {
  const match = MODEL_LAUNCH_LOG_PREFIX_PATTERN.exec(line);
  if (!match?.groups) return line;

  return `${match.groups.monthDay} ${match.groups.time}: ${match.groups.message}`;
}

export function formatModelLaunchLogText(text: string): string {
  if (!text) return '';

  return text
    .split(/\r\n|\n|\r/)
    .map(formatModelLaunchLogLine)
    .join('\n');
}