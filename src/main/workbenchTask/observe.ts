/** Audit persistence must never decide whether an agent operation can proceed. */
export function observeWorkbench<T>(sessionId: string, record: () => T): T | undefined {
  try {
    return record();
  } catch (error) {
    console.warn(
      `[WorkbenchTask] failed to record an observation for session ${sessionId}:`,
      error,
    );
    return undefined;
  }
}
