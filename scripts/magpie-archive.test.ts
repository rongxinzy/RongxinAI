import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { afterEach, expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const { archiveArguments } = require('./build-magpie-runtime.cjs');
const { sha256File } = require('./magpie-runtime.cjs');
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    fs.rmSync(directory, { recursive: true, force: true });
});

test.each(['core.autocrlf', 'core.eol', 'tar.umask', 'core.attributesFile'])(
  'archives identical upstream bytes despite host %s settings',
  setting => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyuan-magpie-archive-test-'));
    temporaryDirectories.push(root);
    const repository = path.join(root, 'repository');
    const baseline = path.join(root, 'baseline.tar');
    const changed = path.join(root, 'changed.tar');
    const actual = path.join(root, 'actual.tar');
    const attributes = path.join(root, 'host.attributes');
    // Git for Windows cannot open Node's device-namespace os.devNull path.
    const emptyConfig = path.join(root, 'empty.config');
    const emptyAttributes = path.join(root, 'empty.attributes');
    fs.writeFileSync(emptyConfig, '');
    fs.writeFileSync(emptyAttributes, '');
    const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: emptyConfig };
    const git = (args: string[]) => execFileSync('git', args, { env, stdio: 'pipe' });
    git(['init', repository]);
    git(['-C', repository, 'config', 'core.autocrlf', 'false']);
    git(['-C', repository, 'config', 'core.eol', 'lf']);
    git(['-C', repository, 'config', 'tar.umask', '0002']);
    fs.writeFileSync(path.join(repository, 'main.go'), 'package main\n\nfunc main() {}\n');
    fs.writeFileSync(path.join(repository, '.gitattributes'), '*.go text\n');
    fs.writeFileSync(attributes, '*.go export-ignore\n');
    git(['-C', repository, 'add', 'main.go', '.gitattributes']);
    git([
      '-C',
      repository,
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-m',
      'fixture',
    ]);
    const commit = git(['-C', repository, 'rev-parse', 'HEAD']).toString().trim();
    const plainArchive = (output: string) => [
      '-C',
      repository,
      'archive',
      '--format=tar',
      `--output=${output}`,
      commit,
    ];
    git(plainArchive(baseline));
    const values: Record<string, string> = {
      'core.autocrlf': 'true',
      'core.eol': 'crlf',
      'tar.umask': '0077',
      'core.attributesFile': attributes,
    };
    git(['-C', repository, 'config', setting, values[setting]]);
    git(plainArchive(changed));
    expect(sha256File(changed)).not.toBe(sha256File(baseline));
    git(archiveArguments(repository, actual, emptyAttributes, commit));
    expect(fs.readFileSync(actual)).toEqual(fs.readFileSync(baseline));
    expect(git(['-C', repository, 'config', setting]).toString().trim()).toBe(values[setting]);
    expect(fs.readFileSync(emptyAttributes, 'utf8')).toBe('');
  },
);
