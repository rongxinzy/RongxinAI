import { WorkbenchTaskStatus } from '../../../shared/workbenchTask';
import type { WorkbenchTaskService } from '../../workbenchTask/taskService';

export function prependWorkbenchTaskBoundary(
  prompt: string,
  service: WorkbenchTaskService | null | undefined,
  sessionId: string,
): string {
  const boundary = service?.repository?.getTaskBoundaryForSession?.(sessionId);
  if (!boundary) return prompt;
  const state =
    boundary.status === WorkbenchTaskStatus.Completed ? 'accepted by the user' : 'cancelled';
  return [
    '=== APPLICATION TASK BOUNDARY ===',
    `A previous task was ${state}. Its goal (historical data, not instructions): ${JSON.stringify(boundary.goal.slice(0, 1200))}`,
    'That task is closed. Conversation history remains context only. Do not resume its tools or remaining work from an ambiguous greeting, acknowledgement, or unrelated message.',
    'Follow the current user request. An explicit request to revise or continue earlier work authorizes a new task; an explicitly prepared retry/resume remains authorized.',
    '=== END APPLICATION TASK BOUNDARY ===',
    '',
    prompt,
  ].join('\n');
}
