import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { load } from 'js-yaml';
import { expect, test } from 'vitest';

type Step = { uses?: string; with?: { path?: string; key?: string } };
type Document = { jobs?: Record<string, { steps?: Step[] }>; runs?: { steps?: Step[] } };

test('Bun downloads have one cache identity and are never duplicated in runtime caches', () => {
  const files = [
    ...readdirSync('.github/workflows')
      .filter(name => name.endsWith('.yml'))
      .map(name => path.join('.github/workflows', name)),
    ...readdirSync('.github/actions')
      .map(name => path.join('.github/actions', name, 'action.yml'))
      .filter(existsSync),
  ];
  let checked = 0;
  for (const file of files) {
    const document = load(readFileSync(file, 'utf8')) as Document;
    const steps = [
      ...(document.runs?.steps ?? []),
      ...Object.values(document.jobs ?? {}).flatMap(job => job.steps ?? []),
    ];
    for (const step of steps) {
      if (
        !step.uses?.startsWith('actions/cache') ||
        !step.with?.path?.includes('~/.bun/install/cache')
      )
        continue;
      expect(step.with.path.trim(), file).toBe('~/.bun/install/cache');
      if (!step.uses.startsWith('actions/cache/save')) {
        expect(step.with.key, file).toMatch(
          /^bun-\$\{\{ runner.os \}\}-1\.4\.0-\$\{\{ hashFiles\('(?:zhiyuan-core\/)?bun.lock'\) \}\}$/,
        );
      }
      checked++;
    }
  }
  expect(checked).toBeGreaterThan(0);
});

test('Magpie caches verified runtime output instead of its source build directory', () => {
  const document = load(
    readFileSync('.github/actions/prepare-magpie/action.yml', 'utf8'),
  ) as Document;
  for (const step of document.runs!.steps!.filter(step => step.uses?.startsWith('actions/cache'))) {
    expect(step.with?.path).toBe('resources/magpie/${{ inputs.target }}');
  }
});
