import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';

const script = path.resolve(__dirname, 'audit-npm-projects.sh');

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'npm-audit-test-'));
  const reports = path.join(root, 'reports');
  const bin = path.join(root, 'bin');
  mkdirSync(bin);
  const tracked: string[] = [];
  for (const [directory, locked] of [
    ['SKILLs/locked skill', true],
    ['SKILLs/presets/nested', false],
    ['scripts/release', true],
    ['scripts/helper', false],
  ] as const) {
    mkdirSync(path.join(root, directory), { recursive: true });
    const manifest = `${directory}/package.json`;
    writeFileSync(path.join(root, manifest), JSON.stringify({ name: directory }));
    tracked.push(manifest);
    if (locked) {
      const lock = `${directory}/package-lock.json`;
      writeFileSync(path.join(root, lock), '{"lockfileVersion":3,"packages":{}}\n');
      tracked.push(lock);
    }
  }
  execFileSync('git', ['init', '-q', root]);
  execFileSync('git', ['add', ...tracked], { cwd: root });
  // A local fake npm verifies invocation boundaries; no registry access occurs.
  writeFileSync(
    path.join(bin, 'npm'),
    `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const name = JSON.parse(fs.readFileSync('package.json', 'utf8')).name;
if (!args.includes('--ignore-scripts') || !args.includes('--package-lock-only')) process.exit(90);
fs.appendFileSync(process.env.AUDIT_CALLS, JSON.stringify({name,args,cwd:process.cwd()})+'\\n');
if (args[0] === 'install') {
  if (process.env.FAIL_RESOLUTION === name) process.exit(2);
  fs.writeFileSync('package-lock.json', '{"lockfileVersion":3,"packages":{}}');
}
if (args[0] === 'audit') {
  console.log(JSON.stringify({project:name,vulnerabilities:process.env.FAIL_AUDIT === name}));
  if (process.env.FAIL_AUDIT === name) process.exit(1);
}
`,
    { mode: 0o755 },
  );
  return {
    root,
    reports,
    run: (env: Record<string, string> = {}) =>
      spawnSync('bash', [script, reports], {
        cwd: root,
        encoding: 'utf8',
        env: {
          ...process.env,
          ...env,
          PATH: `${bin}${path.delimiter}${process.env.PATH}`,
          AUDIT_CALLS: path.join(root, 'calls.jsonl'),
        },
      }),
    calls: () =>
      readFileSync(path.join(root, 'calls.jsonl'), 'utf8')
        .trim()
        .split('\n')
        .map(line => JSON.parse(line) as { name: string; args: string[]; cwd: string }),
    dispose: () => rmSync(root, { recursive: true, force: true }),
  };
}

test('audits locked graphs and nested unlocked Skills in isolated snapshots', () => {
  const f = fixture();
  try {
    expect(f.run().status).toBe(0);
    const calls = f.calls();
    expect(calls).toHaveLength(4);
    expect(calls.every(call => call.cwd.startsWith(realpathSync(f.reports)))).toBe(true);
    expect(calls.filter(call => call.args[0] === 'install').map(call => call.name)).toEqual([
      'SKILLs/presets/nested',
    ]);
    expect(calls.some(call => call.name === 'scripts/helper')).toBe(false);
    expect(existsSync(path.join(f.root, 'SKILLs/presets/nested/package-lock.json'))).toBe(false);
    expect(readFileSync(path.join(f.root, 'SKILLs/locked skill/package-lock.json'), 'utf8')).toBe(
      '{"lockfileVersion":3,"packages":{}}\n',
    );
    expect(readFileSync(path.join(f.reports, 'summary.tsv'), 'utf8')).toContain(
      'unlocked-resolution',
    );
  } finally {
    f.dispose();
  }
});

test('an audit failure stays nonzero while other projects still get reports', () => {
  const f = fixture();
  try {
    expect(f.run({ FAIL_AUDIT: 'SKILLs/locked skill' }).status).toBe(1);
    expect(f.calls().filter(call => call.args[0] === 'audit')).toHaveLength(3);
    expect(readFileSync(path.join(f.reports, 'summary.tsv'), 'utf8')).toContain(
      'SKILLs/locked skill\tlocked\tfailed',
    );
    expect(existsSync(path.join(f.reports, 'project-1/audit.json'))).toBe(true);
  } finally {
    f.dispose();
  }
});

test('resolution errors are retained and cannot be mistaken for a clean graph', () => {
  const f = fixture();
  try {
    expect(f.run({ FAIL_RESOLUTION: 'SKILLs/presets/nested' }).status).toBe(1);
    expect(f.calls().filter(call => call.args[0] === 'audit')).toHaveLength(2);
    expect(readFileSync(path.join(f.reports, 'summary.tsv'), 'utf8')).toContain(
      'resolution-failed',
    );
  } finally {
    f.dispose();
  }
});

test('a missing Git inventory fails rather than silently auditing zero projects', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'npm-audit-no-git-'));
  try {
    expect(spawnSync('bash', [script, path.join(root, 'reports')], { cwd: root }).status).not.toBe(
      0,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
