import { runTextWorkerOperation, TextWorkerKind } from '../../workbenchTask/textWorkerOperations';

/** Synchronous display text for Pi tool results (same rules as the text worker). */
export function syncPiToolResultDisplayText(result: unknown): string {
  try {
    return runTextWorkerOperation({ kind: TextWorkerKind.Tool, result }).content;
  } catch {
    if (result === undefined || result === null) return '';
    if (typeof result === 'string') return result;
    if (typeof result === 'object') {
      try {
        return JSON.stringify(result);
      } catch {
        return String(result);
      }
    }
    return String(result);
  }
}
