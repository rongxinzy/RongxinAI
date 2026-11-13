import { MemoryInjectionDedup } from './memoryInjectionDedup';
import { captureMemoryPromptForE2e } from './memoryPromptE2eCapture';
import { buildProjectMemoryContextSafe, type ProjectMemoryService } from './projectMemoryService';

export async function resolveProjectMemoryContextForPiPrompt(input: {
  chatMode: boolean;
  memoryInjectionDedup: MemoryInjectionDedup;
  projectMemoryService: ProjectMemoryService | null;
  workspaceRoot: string;
  sessionId: string;
  userPrompt: string;
  signal?: AbortSignal;
}): Promise<string | null> {
  if (input.chatMode) return null;
  return input.memoryInjectionDedup.take(
    input.sessionId,
    await buildProjectMemoryContextSafe(
      input.projectMemoryService,
      input.workspaceRoot,
      input.sessionId,
      input.userPrompt,
      input.signal,
    ),
  );
}

export function finalizePiPromptWithProjectMemory(input: {
  sessionId: string;
  userPrompt: string;
  prompt: string;
  projectMemoryContext: string | null;
}): string {
  const prompt = input.projectMemoryContext
    ? `${input.projectMemoryContext}\n\n${input.prompt}`
    : input.prompt;
  captureMemoryPromptForE2e({
    sessionId: input.sessionId,
    userPrompt: input.userPrompt,
    memoryContext: input.projectMemoryContext,
    initialPrompt: prompt,
  });
  return prompt;
}
