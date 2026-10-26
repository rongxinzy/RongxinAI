import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { load } from 'js-yaml';
import { expect, test } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
interface Workflow {
  on: Record<string, { inputs: Record<string, unknown> }>;
  jobs: Record<
    string,
    { uses?: string; with?: Record<string, string>; steps?: Array<{ uses?: string; run?: string }> }
  >;
}

function workflow(name: string): Workflow {
  return load(fs.readFileSync(path.join(root, '.github/workflows', name), 'utf8')) as Workflow;
}

test('both enterprise release entry points use a generic installer with runtime server selection', () => {
  const build = workflow('enterprise-windows.yml');
  const signing = workflow('sign-zhiyuan-enterprise-windows.yml');
  for (const entry of [build, signing]) {
    expect(entry.on.workflow_dispatch?.inputs).not.toHaveProperty('aep_base_url');
    expect(JSON.stringify(entry)).not.toContain('inputs.aep_base_url');
  }
  expect(build.on.workflow_call?.inputs).toHaveProperty('version');
  expect(signing.jobs.sign?.uses).toBe('./.github/workflows/enterprise-windows.yml');
  expect(signing.jobs.sign?.with?.source_ref).toBe('${{ github.sha }}');
  const config = JSON.parse(
    fs.readFileSync(path.join(root, 'resources/zhiyuan-enterprise/config.json'), 'utf8'),
  ) as { aepBaseUrl: string };
  expect(config.aepBaseUrl).toBe('');
});

test('enterprise packaging prepares the required pinned gateway and document toolchains first', () => {
  const steps = workflow('enterprise-windows.yml').jobs.package?.steps ?? [];
  const packageIndex = steps.findIndex(step => step.run?.includes("'dist:win:enterprise'"));
  const beforePackage = steps.slice(0, packageIndex);
  expect(packageIndex).toBeGreaterThan(0);
  expect(beforePackage.some(step => step.uses === 'actions/setup-go@v6')).toBe(true);
  expect(beforePackage.some(step => step.uses === 'actions/setup-dotnet@v5')).toBe(true);
  expect(
    beforePackage.some(
      step =>
        step.run?.includes('bun run magpie:build -- --target win32-x64') &&
        step.run.includes('bun run magpie:verify -- --target win32-x64'),
    ),
  ).toBe(true);
});
