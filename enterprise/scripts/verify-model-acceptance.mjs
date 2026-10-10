import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const enterpriseRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const protocolRoot = path.resolve(
  process.env.AEP_PROTOCOL_ROOT ?? path.join(enterpriseRoot, '..', 'Agent-Enterprise-Protocol'),
);
const manifestPath = path.join(enterpriseRoot, 'build', 'build-manifest.json');

await assertPinnedInputs();
await run('npm', ['run', 'check'], enterpriseRoot);
await run('npm', ['run', 'verify:electron-rc'], enterpriseRoot);
await run('npm', ['run', 'test:e2e:m1-client'], protocolRoot);

console.log(
  JSON.stringify(
    {
      status: 'passed',
      checks: [
        'AaaS typecheck, unit tests, extension and renderer build',
        'Electron enterprise host contract and managed model release-candidate checks',
        'immutable Zhiyuan core, AEP protocol, and SDK release inputs',
        'OpenAI-compatible model gateway with streaming and telemetry redaction',
      ],
      note: 'Packaged Electron UI click-through remains a manual release-candidate check.',
    },
    null,
    2,
  ),
);

async function assertPinnedInputs() {
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  for (const [name, value] of Object.entries({
    'Zhiyuan core': manifest.zhiyuanCore?.commit,
    'AEP protocol': manifest.aepProtocol?.commit,
  })) {
    if (!/^[0-9a-f]{40}$/.test(value ?? '')) {
      throw new Error(`${name} input is not pinned to an immutable commit.`);
    }
  }
  if (!/^[0-9a-f]{64}$/.test(manifest.aepSdk?.sha256 ?? '')) {
    throw new Error('AEP SDK input is not pinned with a SHA-256 digest.');
  }
}

function run(command, args, cwd) {
  const executable = process.platform === 'win32' && command === 'npm' ? 'npm.cmd' : command;
  const spawnCommand =
    process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : executable;
  const spawnArgs =
    process.platform === 'win32' ? ['/d', '/s', '/c', [executable, ...args].join(' ')] : args;
  return new Promise((resolve, reject) => {
    const child = spawn(spawnCommand, spawnArgs, {
      cwd,
      env: process.env,
      stdio: 'inherit',
      shell: false,
    });
    child.once('error', reject);
    child.once('exit', code => {
      if (code === 0) resolve();
      else reject(new Error(`${executable} ${args.join(' ')} exited with ${code ?? 'unknown'}.`));
    });
  });
}
