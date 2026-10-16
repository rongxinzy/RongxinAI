import { describe, expect, test } from 'vitest';

import {
  runExecutesMagpieBuild,
  validateWorkflowFile,
} from './openclaw-decoupling-workflows.mjs';

const FILE = 'fixture.yml';

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
      `${FILE} job sidecar: must not build pi-connect from source (use published channel runtime assets)`,
    ]);
  });

  test('runExecutesMagpieBuild ignores shell comments', () => {
    expect(runExecutesMagpieBuild('echo hi\n# bun run magpie:build\n')).toBe(false);
    expect(runExecutesMagpieBuild('bun run magpie:build -- --target linux-x64')).toBe(true);
  });
});
