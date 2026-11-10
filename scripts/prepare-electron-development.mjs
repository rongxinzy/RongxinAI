import { spawnSync } from 'node:child_process';

const defense = process.env.APP_EDITION === 'defense';
const steps = defense
  ? []
  : [
      ['bun', ['run', 'channel:runtime:download']],
      ['bun', ['run', 'engram:runtime:host']],
    ];

if (defense) {
  console.log('[ElectronDev] Skipping runtime downloads for the offline defense edition.');
}

for (const [command, args] of steps) {
  const result = spawnSync(command, args, { stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`Development runtime preparation failed: ${args.join(' ')}`);
}
