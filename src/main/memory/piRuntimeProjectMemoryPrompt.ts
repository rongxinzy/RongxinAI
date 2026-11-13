import { MemoryInjectionDedup } from './memoryInjectionDedup';
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
