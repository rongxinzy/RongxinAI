#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const config = path.join(root, 'scripts/ci/ruff-dead-code.toml');
const scriptsDir = path.join(root, 'scripts');

// Pinned tool versions; probes and installs must agree on these.
const pinned = { ruff: '0.9.6', vulture: '2.14' };

// Resolve a tool to a runnable [command, prefixArgs] pair when the pinned
// version is already available. Prefers `python3 -m <tool>` so a user-site
// install works even when ~/.local/bin is not on PATH.
function resolveTool(tool) {
  const expected = `${tool} ${pinned[tool]}`;
  const asModule = spawnSync('python3', ['-m', tool, '--version'], { encoding: 'utf8' });
  if (asModule.status === 0 && `${asModule.stdout}${asModule.stderr}`.includes(expected)) {
    return ['python3', ['-m', tool]];
  }
  const asBinary = spawnSync(tool, ['--version'], { encoding: 'utf8' });
  if (asBinary.status === 0 && `${asBinary.stdout}${asBinary.stderr}`.includes(expected)) {
    return [tool, []];
  }
  return null;
}

// Skip the pip install when the pinned tools are already present; installing
// anyway aborts on PEP 668 externally-managed environments before pip even
// notices the requirement is satisfied.
function ensureTools() {
  if (resolveTool('ruff') && resolveTool('vulture')) return;
  const install = spawnSync(
    'python3',
    [
      '-m',
      'pip',
      'install',
      '--disable-pip-version-check',
      '--quiet',
      `ruff==${pinned.ruff}`,
      `vulture==${pinned.vulture}`,
    ],
    { stdio: 'inherit' },
  );
  if (install.status !== 0) process.exit(install.status ?? 1);
  if (!resolveTool('ruff') || !resolveTool('vulture')) {
    console.error(
      `py-dead-code tools (ruff ${pinned.ruff}, vulture ${pinned.vulture}) unavailable`,
    );
    process.exit(1);
  }
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

ensureTools();

const ruff = resolveTool('ruff');
run(ruff[0], [...ruff[1], 'check', scriptsDir, '--config', config]);
const vulture = resolveTool('vulture');
run(vulture[0], [...vulture[1], scriptsDir, '--min-confidence', '80']);
