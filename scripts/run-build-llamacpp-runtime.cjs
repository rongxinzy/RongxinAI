'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function commandExists(command) {
  const checker = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(checker, [command], { stdio: 'ignore' });
  return result.status === 0;
}

function resolveBashExecutable(rootDir) {
  if (process.platform !== 'win32') {
    return commandExists('bash') ? 'bash' : null;
  }

  try {
    const result = spawnSync('where', ['bash'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    if (result.status === 0 && result.stdout) {
      const paths = result.stdout.trim().split(/\r?\n/).map((p) => p.trim()).filter(Boolean);
      const gitBash = paths.find((p) => {
        const lower = p.toLowerCase();
        return !lower.includes('windowsapps') && !lower.includes('system32');
      });
      if (gitBash) return gitBash;
    }
  } catch {}

  const candidates = [
    path.join(rootDir, 'resources', 'mingit', 'bin', 'bash.exe'),
    path.join(rootDir, 'resources', 'mingit', 'usr', 'bin', 'bash.exe'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

const targetId = (process.argv[2] || '').trim();
if (!targetId) {
  console.error('[run-build-llamacpp-runtime] Missing target id.');
  process.exit(1);
}

const rootDir = path.resolve(__dirname, '..');
const bashExecutable = resolveBashExecutable(rootDir);
if (!bashExecutable) {
  console.error('[run-build-llamacpp-runtime] bash is required but not found.');
  process.exit(1);
}

const env = { ...process.env };
if (process.platform === 'win32') {
  const nodeDir = path.dirname(process.execPath);
  const pathEntries = Object.entries(env).filter(([k]) => k.toUpperCase() === 'PATH');
  const pathValue = pathEntries.map(([, v]) => v).join(path.delimiter);
  for (const [k] of pathEntries) delete env[k];
  env.PATH = `${nodeDir}${path.delimiter}${pathValue}`;
}

const result = spawnSync(bashExecutable, ['scripts/build-llamacpp-runtime.sh', targetId], {
  cwd: rootDir,
  env,
  stdio: 'inherit',
});

process.exit(typeof result.status === 'number' ? result.status : 1);
