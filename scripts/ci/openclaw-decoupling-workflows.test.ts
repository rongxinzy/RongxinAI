import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, test } from 'vitest';

import {
  isStaticallyDisabledStep,
  runExecutesMagpieBuild,
  stripWorkflowGateReferences,
  validateAllWorkflowFiles,
  validateWorkflowFile,
  validateWorkflowPiConnectFileFallback,
} from './openclaw-decoupling-workflows.mjs';

const FILE = 'fixture.yml';
const repoRoot = path.resolve(import.meta.dirname, '../..');

describe('openclaw decoupling workflow guard', () => {
  test('allows setup-go when the same job run executes bun run magpie:build', () => {
    const yaml = `
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/setup-go@v6
      - run: bun run magpie:build -- --target linux-x64
`;
    expect(validateWorkflowFile(FILE, yaml)).toEqual([]);
  });

  test('rejects setup-go without magpie build run in the same job', () => {
    const yaml = `
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/setup-go@v6
      - run: bun run build
`;
    expect(validateWorkflowFile(FILE, yaml)).toEqual([
      `${FILE} job build: actions/setup-go is only allowed when a step run executes bun run magpie:build in the same job`,
    ]);
  });

  test('rejects setup-go when magpie:build appears only in step name or comments', () => {
    const yaml = `
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/setup-go@v6
      - name: magpie:build helper
        run: |
          # bun run magpie:build would go here
          echo ok
`;
    expect(validateWorkflowFile(FILE, yaml)).toEqual([
      `${FILE} job build: actions/setup-go is only allowed when a step run executes bun run magpie:build in the same job`,
    ]);
  });

  test('rejects setup-go in another job even if magpie:build runs elsewhere', () => {
    const yaml = `
jobs:
  prepare:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/setup-go@v6
  build:
    runs-on: ubuntu-latest
    steps:
      - run: bun run magpie:build -- --target linux-x64
`;
    expect(validateWorkflowFile(FILE, yaml)).toContain(
      `${FILE} job prepare: actions/setup-go is only allowed when a step run executes bun run magpie:build in the same job`,
    );
  });

  test('rejects pi-connect checkout or run references', () => {
    const yaml = `
jobs:
  sidecar:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
        with:
          repository: rongxinzy/pi-connect
`;
    expect(validateWorkflowFile(FILE, yaml)).toEqual([
      `${FILE}: must not build pi-connect from source (file-level reference to pi-connect or ZHIYUAN_CC_CONNECT_SOURCE)`,
      `${FILE} job sidecar: must not build pi-connect from source (use published channel runtime assets)`,
    ]);
  });

  test('rejects top-level workflow env pi-connect source flags', () => {
    const yaml = `
env:
  ZHIYUAN_CC_CONNECT_SOURCE: '1'
jobs:
  noop:
    runs-on: ubuntu-latest
    steps:
      - run: echo ok
`;
    expect(validateWorkflowFile(FILE, yaml)).toEqual([
      `${FILE} workflow env: must not build pi-connect from source (use published channel runtime assets)`,
      `${FILE}: must not build pi-connect from source (file-level reference to pi-connect or ZHIYUAN_CC_CONNECT_SOURCE)`,
    ]);
  });

  test('file fallback catches pi-connect on the same line as the gate command', () => {
    const content = 'run: bun run check:openclaw-decoupling # clone rongxinzy/pi-connect\n';
    expect(stripWorkflowGateReferences(content)).toContain('rongxinzy/pi-connect');
    expect(validateWorkflowPiConnectFileFallback(FILE, content)).toEqual([
      `${FILE}: must not build pi-connect from source (file-level reference to pi-connect or ZHIYUAN_CC_CONNECT_SOURCE)`,
    ]);
  });

  test('ignores magpie build steps disabled with static if false', () => {
    const yaml = `
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/setup-go@v6
      - if: false
        run: bun run magpie:build -- --target linux-x64
`;
    expect(validateWorkflowFile(FILE, yaml)).toEqual([
      `${FILE} job build: actions/setup-go is only allowed when a step run executes bun run magpie:build in the same job`,
    ]);
    expect(isStaticallyDisabledStep({ if: false, run: 'x' })).toBe(true);
    expect(isStaticallyDisabledStep({ if: '${{ false }}', run: 'x' })).toBe(true);
  });

  test('runExecutesMagpieBuild ignores shell comments', () => {
    expect(runExecutesMagpieBuild('echo hi\n# bun run magpie:build\n')).toBe(false);
    expect(runExecutesMagpieBuild('bun run magpie:build -- --target linux-x64')).toBe(true);
  });

  test('validates every checked-in GitHub workflow without failures', () => {
    const failures = validateAllWorkflowFiles(repoRoot);
    expect(failures, failures.join('\n')).toEqual([]);
    const workflowCount = fs.readdirSync(path.join(repoRoot, '.github/workflows')).filter(name =>
      name.endsWith('.yml'),
    ).length;
    expect(workflowCount).toBeGreaterThan(0);
  });
});
