#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const config = path.join(root, 'scripts/ci/ruff-dead-code.toml');
const scriptsDir = path.join(root, 'scripts');

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run('python3', [
  '-m',
  'pip',
  'install',
  '--disable-pip-version-check',
  '--quiet',
  'ruff==0.9.6',
  'vulture==2.14',
]);
run('ruff', ['check', scriptsDir, '--config', config]);
run('vulture', [scriptsDir, '--min-confidence', '80']);
