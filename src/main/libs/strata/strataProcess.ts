import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';

export function resolveStrataProcessCommand(
  python: string,
  args: string[],
): { executable: string; args: string[] } {
  if (process.platform !== 'win32') return { executable: python, args };
  const resources = app.isPackaged
    ? process.resourcesPath
    : path.join(app.getAppPath(), 'resources');
  const executable = path.join(resources, 'python-runtime', 'job-runner.exe');
  if (!fs.existsSync(executable)) throw new Error('Strata process supervisor is missing.');
  return { executable, args: [String(process.pid), python, ...args] };
}

export function watchStrataReady(
  stdout: Readable,
  port: number,
  onReady: (modelId: string) => void,
  onServing: () => void,
): void {
  const decoder = new StringDecoder('utf8');
  let pending = '';
  const onData = (chunk: Buffer): void => {
    pending += decoder.write(chunk);
    let newline = pending.indexOf('\n');
    while (newline >= 0) {
      const line = pending.slice(0, newline);
      pending = pending.slice(newline + 1);
      if (line.startsWith('{') && line.length <= 8192) {
        try {
          const record = JSON.parse(line) as Record<string, unknown>;
          if (record.schema_version === 1 && record.event === 'starting') onServing();
          if (
            record.schema_version === 1 &&
            record.event === 'ready' &&
            record.bound_port === port &&
            record.bound_host === '127.0.0.1' &&
            record.model_state === 'ready' &&
            typeof record.model_id === 'string' &&
            record.model_id.length > 0
          ) {
            stdout.off('data', onData);
            onReady(record.model_id);
            return;
          }
        } catch {
          // Plain launcher output may share stdout with lifecycle records.
        }
      }
      newline = pending.indexOf('\n');
    }
    if (pending.length > 8192) pending = '';
  };
  stdout.on('data', onData);
}
