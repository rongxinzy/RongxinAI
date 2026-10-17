import { prependWorkbenchTaskBoundary } from '../libs/agentEngine/piWorkbenchTaskBoundary';
import type { WorkbenchTaskService } from '../workbenchTask/taskService';
import { MemoryInjectionDedup } from './memoryInjectionDedup';
import { captureMemoryPromptForE2e } from './memoryPromptE2eCapture';
import { buildProjectMemoryContextSafe, type ProjectMemoryService } from './projectMemoryService';

export async function resolveProjectMemoryContextForPiPrompt(input: {
  chatMode: boolean;
  memoryInjectionDedup: MemoryInjectionDedup;
  projectMemoryService: ProjectMemoryService;
  workspaceRoot: string;
  sessionId: string;
  userPrompt: string;
}): Promise<string | null> {
  if (input.chatMode) return null;
  return input.memoryInjectionDedup.take(
    input.sessionId,
    await buildProjectMemoryContextSafe(
      input.projectMemoryService,
      input.workspaceRoot,
      input.sessionId,
      input.userPrompt,
    ),
  );
}

export function finalizePiPromptWithProjectMemory(input: {
  chatMode: boolean;
  sessionId: string;
  userPrompt: string;
  prompt: string;
  projectMemoryContext: string | null;
  workbenchTaskService: WorkbenchTaskService;
}): string {
  let prompt = input.prompt;
  if (input.projectMemoryContext) {
    prompt = `${input.projectMemoryContext}\n\n${prompt}`;
  }
  if (!input.chatMode) {
    prompt = prependWorkbenchTaskBoundary(prompt, input.workbenchTaskService, input.sessionId);
  }
  captureMemoryPromptForE2e({
    sessionId: input.sessionId,
    userPrompt: input.userPrompt,
    memoryContext: input.projectMemoryContext,
    initialPrompt: prompt,
  });
  return prompt;
}
