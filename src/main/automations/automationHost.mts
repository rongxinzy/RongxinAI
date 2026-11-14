import type { Conversation, Harness, Registry } from '@earendil-works/pi-durable';
import type {
  ScheduledTask,
  ScheduledTaskRunWithName,
  TaskState,
} from '../../scheduledTask/types.js';

export interface AutomationSession {
  getDurableHost(): { harness: Harness; registry: Registry; conversation: Conversation };
  close(): Promise<void>;
}

export interface DurableAutomationOptions {
  listSessionFiles(): readonly string[] | Promise<readonly string[]>;
  fileForSession(sessionId: string): string;
  /** Prepare the standard application kernel without submitting model input or resuming tasks. */
  openAutomationSession(task: ScheduledTask, file: string): Promise<AutomationSession>;
  onTaskState?(taskId: string, state: TaskState): void;
  onRun?(run: ScheduledTaskRunWithName): void;
  now?: () => number;
}
