import { buildProjectMemoryContextSafe, type ProjectMemoryService } from './projectMemoryService';

export async function resolveProjectMemoryContextForPiPrompt(input: {
  chatMode: boolean;
  projectMemoryService: ProjectMemoryService | null;
  workspaceRoot: string;
  sessionId: string;
  userPrompt: string;
  signal?: AbortSignal;
}): Promise<string | null> {
  if (input.chatMode) return null;
  const memory = await buildProjectMemoryContextSafe(
    input.projectMemoryService,
    input.workspaceRoot,
    input.sessionId,
    input.userPrompt,
    input.signal,
  );
  return memory || null;
}
