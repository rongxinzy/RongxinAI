#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, renameSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const config = path.join(root, 'scripts/ci/ruff-dead-code.toml');
const scriptsDir = path.join(root, 'scripts');

// Pinned so linter output is reproducible across environments.
const PINS = { ruff: '0.9.6', vulture: '2.14' };
const BIN_DIR = process.platform === 'win32' ? 'Scripts' : 'bin';

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function versionOf(command) {
  const res = spawnSync(command, ['--version'], { encoding: 'utf8' });
  if (res.error || res.status !== 0) return null;
  return (res.stdout || '').trim();
}

// Resolve a tool binary: reuse an existing install of the exact pinned
// version, otherwise provision once into a private venv. Never pip-install
// into the system interpreter — PEP 668 externally-managed environments
// reject that, and a venv keeps the CI self-contained.
function resolveTool(name) {
  if (versionOf(name) === `${name} ${PINS[name]}`) return { command: name, args: [] };
  const dir = path.join(os.tmpdir(), `zhiyuan-dead-code-venv-${PINS.ruff}-${PINS.vulture}`);
  const python = path.join(dir, BIN_DIR, 'python');
  const bin = path.join(dir, BIN_DIR, name);
  if (!existsSync(bin)) {
    const staging = `${dir}.${process.pid}.tmp`;
    run('python3', ['-m', 'venv', staging]);
    run(path.join(staging, BIN_DIR, 'pip'), [
      'install',
      '--disable-pip-version-check',
      '--quiet',
      `ruff==${PINS.ruff}`,
      `vulture==${PINS.vulture}`,
    ]);
    if (!existsSync(dir)) renameSync(staging, dir);
  }
  // Entry-point scripts embed the creation-time venv path in their shebang,
  // which breaks after the rename above; invoke the module instead.
  return name === 'vulture'
    ? { command: python, args: ['-m', 'vulture'] }
    : { command: bin, args: [] };
}

const ruff = resolveTool('ruff');
const vulture = resolveTool('vulture');
run(ruff.command, [...ruff.args, 'check', scriptsDir, '--config', config]);
run(vulture.command, [...vulture.args, scriptsDir, '--min-confidence', '80']);
