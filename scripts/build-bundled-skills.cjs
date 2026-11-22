'use strict';

const { execFileSync } = require('node:child_process');
const { cpSync, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync } = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const npmLockfile = 'package-lock.json';

function install(cwd, args = []) {
  // Bun imports the audited npm lockfiles in staging. Keep one lockfile per Skill.
  execFileSync(
    'bun',
    ['install', '--frozen-lockfile', '--ignore-scripts', '--linker', 'hoisted', ...args],
    {
      cwd,
      stdio: 'inherit',
    },
  );
}

function replaceOutput(source, destination) {
  const backup = `${source}.previous`;
  if (existsSync(destination)) renameSync(destination, backup);
  try {
    renameSync(source, destination);
  } catch (error) {
    if (existsSync(backup)) renameSync(backup, destination);
    throw error;
  }
}

function buildBundledSkills(root = projectRoot) {
  const buildRoot = path.join(root, 'build-tar');
  mkdirSync(buildRoot, { recursive: true });
  const stagingRoot = mkdtempSync(path.join(buildRoot, 'bundled-skills-'));
  try {
    const skills = [
      ['web-search', npmLockfile, ['node_modules', 'dist']],
      ['presentation-studio', npmLockfile, ['node_modules']],
      ['imap-smtp-email', 'bun.lock', ['node_modules']],
    ];
    for (const [name, lockfile] of skills) {
      const source = path.join(root, 'SKILLs', name);
      const stage = path.join(stagingRoot, name);
      mkdirSync(stage);
      for (const file of ['package.json', lockfile]) {
        cpSync(path.join(source, file), path.join(stage, file));
      }
      if (name === 'web-search') {
        for (const file of ['server', 'tsconfig.json']) {
          cpSync(path.join(source, file), path.join(stage, file), { recursive: true });
        }
        install(stage);
        execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json'], {
          cwd: stage,
          stdio: 'inherit',
        });
        rmSync(path.join(stage, 'node_modules'), { recursive: true, force: true });
      }
      install(stage, ['--production']);
      rmSync(path.join(stage, 'node_modules', '.bin'), { recursive: true, force: true });
    }

    for (const [name, , outputs] of skills) {
      for (const output of outputs) {
        replaceOutput(
          path.join(stagingRoot, name, output),
          path.join(root, 'SKILLs', name, output),
        );
      }
    }
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true });
  }
}

if (require.main === module) buildBundledSkills();

module.exports = { buildBundledSkills };
