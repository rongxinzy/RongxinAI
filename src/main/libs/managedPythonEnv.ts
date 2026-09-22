import { delimiter, dirname } from 'path';

import { appendPythonRuntimeToEnv } from './pythonRuntime';
import { findSharedSkillPythonExecutable } from './skillPythonRuntime';
import { appendUvRuntimeToEnv, configureUvForManagedPython } from './uvRuntime';

/** Shared by development and packaged launches; dependency Python must win. */
export function applyManagedPythonEnv(env: Record<string, string | undefined>): void {
  appendPythonRuntimeToEnv(env);
  appendUvRuntimeToEnv(env);
  configureUvForManagedPython(env);
  const executable = findSharedSkillPythonExecutable();
  const binDir = executable ? dirname(executable) : undefined;
  const normalize = (entry: string): string =>
    process.platform === 'win32' ? entry.toLowerCase() : entry;
  const entries = [binDir, ...(env.PATH || '').split(delimiter)].filter((entry): entry is string =>
    Boolean(entry),
  );
  const seen = new Set<string>();
  env.PATH = entries
    .filter(entry => {
      const key = normalize(entry);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join(delimiter);
}
