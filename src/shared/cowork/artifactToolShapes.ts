/**
 * Shared tool-shape helpers for file-backed artifact discovery.
 *
 * Used by both the renderer's message heuristics (artifactParser) and the
 * main-process artifact recorder, so the write-tool rule cannot drift between
 * the two detection paths while they coexist.
 */

/** Tools whose file target is the artifact itself. Members are stored
 * pre-normalized (see normalizeToolName). */
export const WRITE_TOOL_NAMES = new Set(['write', 'writefile']);

export function normalizeToolName(name: string): string {
  return name.toLowerCase().replace(/[_\s]/g, '');
}

export function extractFilePath(toolInput: Record<string, unknown>): string | null {
  for (const key of ['file_path', 'path', 'filePath', 'target_file', 'targetFile']) {
    const val = toolInput[key];
    if (typeof val === 'string' && val.length > 0) {
      return val;
    }
  }
  return null;
}
