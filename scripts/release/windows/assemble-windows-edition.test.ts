import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { load } from 'js-yaml';
import { expect, test } from 'vitest';

const source = readFileSync(path.join(__dirname, 'assemble-windows-edition.cjs'), 'utf8');

function assemble(edition: string, failPackaging = false) {
  const calls: Array<{ command: string; args: string[]; options: { env: Record<string, string> } }> = [];
  const removed: string[] = [];
  const fs = {
    existsSync: () => true,
    readdirSync: () => ['old.exe', 'old.exe.blockmap', 'latest.yml', 'signing-certificate.cer', 'win-unpacked']
      .map(name => ({ name, isFile: () => name !== 'win-unpacked' })),
    rmSync: (file: string) => removed.push(path.basename(file)),
  };
  const modules = {
    'node:fs': fs,
    'node:path': path,
    'node:child_process': {
      spawnSync: (command: string, args: string[], options: { env: Record<string, string> }) => {
        calls.push({ command, args, options });
        return { status: failPackaging && args.includes('electron-builder') ? 1 : 0 };
      },
    },
  };
  const execute = () => vm.runInNewContext(source, {
    __dirname,
    require: (name: keyof typeof modules) => modules[name],
    process: { env: {}, argv: ['node', 'assemble', edition], execPath: process.execPath },
    console: { log: () => undefined },
  });
  return { execute, calls, removed };
}

test.each(['cpu', 'cuda'])('%s reuses compilation but regenerates edition metadata and packaging hooks', edition => {
  const f = assemble(edition);
  f.execute();
  const patch = f.calls.findIndex(call => call.args[0].endsWith('ensure-build-version.js'));
  const packageIndex = f.calls.findIndex(call => call.args.includes('electron-builder'));
  expect(patch).toBeGreaterThan(-1);
  expect(packageIndex).toBeGreaterThan(patch);
  expect(f.calls[packageIndex].args).not.toContain('--prepackaged');
  expect(f.calls.every(call => call.options.env.ZHIYUAN_UPDATE_VARIANT === edition)).toBe(true);
  expect(f.calls.some(call => call.args.includes('build') || call.args.includes('compile:electron'))).toBe(false);
  expect(f.removed).toEqual(['old.exe', 'old.exe.blockmap', 'latest.yml']);
});

test('a failed edition package cannot continue to assemble an installer from stale output', () => {
  const f = assemble('cuda', true);
  expect(f.execute).toThrow('failed: 1');
  expect(f.calls.some(call => call.args[0].endsWith('build-distribution.cjs'))).toBe(false);
});

test('windows-release assembles and directly uploads all three edition release candidates', () => {
  type Step = { name?: string; run?: string; uses?: string; if?: string; with?: Record<string, unknown> };
  const workflow = load(readFileSync('.github/workflows/build-windows-release.yml', 'utf8')) as {
    jobs: Record<string, { needs?: string; steps: Step[] }>;
  };
  expect(workflow.jobs['windows-release'].needs).toBeUndefined();
  expect(workflow.jobs.acceptance).toBeUndefined();
  const steps = workflow.jobs['windows-release'].steps;
  const uploads = steps.filter(step => step.uses === 'actions/upload-artifact@v6');
  const candidates = uploads.filter(step => String(step.with?.name).startsWith('release-candidate-'));
  expect(candidates.map(step => step.with?.name)).toEqual([
    'release-candidate-${{ inputs.app-build-version }}-win32-x64-lite',
    'release-candidate-${{ inputs.app-build-version }}-win32-x64-cpu',
    'release-candidate-${{ inputs.app-build-version }}-win32-x64-cuda',
  ]);
  expect(candidates.every(step => step.if === '${{ !inputs.enterprise-extension }}')).toBe(true);
  const enterprise = uploads.find(step => String(step.with?.name).startsWith('zhiyuan-enterprise-windows-'));
  expect(enterprise?.if).toBe('${{ inputs.enterprise-extension }}');
  const diagnostics = uploads.find(step => String(step.with?.name).startsWith('windows-package-diagnostics-'));
  expect(diagnostics?.if).toBe('${{ failure() }}');
  expect(uploads).toHaveLength(candidates.length + 2);
});
