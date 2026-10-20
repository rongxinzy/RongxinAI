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

test('all three accepted checkpoints gate Windows publication', () => {
  type Step = { run?: string; uses?: string };
  const workflow = load(readFileSync('.github/workflows/build-windows-release.yml', 'utf8')) as {
    jobs: Record<string, { needs?: string; strategy: { matrix: { edition: string[] } }; steps: Step[] }>;
  };
  expect(workflow.jobs.acceptance.needs).toBe('windows-release');
  expect(workflow.jobs.acceptance.strategy.matrix.edition).toEqual(['lite', 'cpu', 'cuda']);
  const steps = workflow.jobs.acceptance.steps;
  const upload = steps.findIndex(step => step.run === undefined && step.uses === 'actions/upload-artifact@v6');
  for (const script of ['verify-windows-authenticode.ps1', 'windows-installer-smoke.ps1', 'windows-shell-interactive.mjs', 'windows-shell-uninstall.ps1 -Action verify']) {
    const index = steps.findIndex(step => step.run?.includes(script));
    expect(index).toBeGreaterThan(-1);
    expect(index).toBeLessThan(upload);
  }
});
