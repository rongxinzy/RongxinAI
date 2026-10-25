import type { ProjectMemoryService } from './projectMemoryService';

export async function buildProjectMemoryContextSafe(
  service: ProjectMemoryService | null,
  workingDirectory: string,
  sessionId: string,
  query: string,
): Promise<string> {
  if (!service) return '';
  try {
    return await service.buildProjectContext({ workingDirectory, sessionId, query });
  } catch (error) {
    console.warn('[ProjectMemory] Failed to recall project context:', error);
    return '';
  }
}
