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

type ReleaseStep = {
  name?: string;
  run?: string;
  uses?: string;
  if?: string;
  with?: Record<string, unknown>;
  'continue-on-error'?: boolean;
};
type ReleaseJob = {
  needs?: string;
  if?: string;
  env?: Record<string, string>;
  strategy?: { matrix: { edition: string[] } };
  steps: ReleaseStep[];
};
function releaseWorkflow() {
  return load(readFileSync('.github/workflows/build-windows-release.yml', 'utf8')) as {
    jobs: Record<string, ReleaseJob>;
  };
}

test('each edition restores exact inputs on a fresh runner before shared acceptance', () => {
  const acceptance = releaseWorkflow().jobs.acceptance;
  expect(acceptance.needs).toBe('windows-release');
  expect(acceptance.if).toBe('${{ !inputs.enterprise-extension }}');
  expect(acceptance.strategy?.matrix.edition).toEqual(['lite', 'cpu', 'cuda']);
  expect(acceptance.env?.ZHIYUAN_UPDATE_VARIANT).toBe('${{ matrix.edition }}');
  const steps = acceptance.steps;
  const restore = steps.findIndex(step => step.run?.includes('build-checkpoint.mjs restore'));
  const verify = steps.findIndex(step => step.uses === './.github/actions/verify-windows-package');
  const freeze = steps.findIndex(
    step => step.uses === './.github/actions/freeze-windows-candidate',
  );
  const upload = steps.findIndex(step =>
    String(step.with?.name).startsWith('release-candidate-'),
  );
  expect(restore).toBeGreaterThan(-1);
  expect(verify).toBeGreaterThan(restore);
  expect(freeze).toBeGreaterThan(verify);
  expect(upload).toBeGreaterThan(freeze);
  for (const step of steps.slice(restore, upload + 1)) {
    expect(step.if).toBeUndefined();
    expect(step['continue-on-error']).toBeUndefined();
  }
  expect(steps[verify].with?.['certificate-path']).toBe('release/signing-certificate.cer');
  expect(steps[verify].with?.['artifact-suffix']).toBe(
    '${{ matrix.edition }}-${{ github.run_attempt }}',
  );
  expect(JSON.stringify(acceptance)).not.toContain('secrets.');
});

test('producer checkpoints editions before repackaging without publishing candidates', () => {
  const steps = releaseWorkflow().jobs['windows-release'].steps;
  const checkpoints = steps.filter(
    step => step.uses === './.github/actions/checkpoint-windows-package',
  );
  expect(checkpoints.map(step => step.with?.edition)).toEqual(['lite', 'cpu', 'cuda']);
  for (const edition of ['lite', 'cpu', 'cuda']) {
    const checkpoint = steps.findIndex(
      step =>
        step.uses === './.github/actions/checkpoint-windows-package' &&
        step.with?.edition === edition,
    );
    const upload = steps.findIndex(step =>
      String(step.with?.name).endsWith(`-${edition}`) &&
      String(step.with?.name).startsWith('windows-acceptance-'),
    );
    expect(upload).toBeGreaterThan(checkpoint);
    const nextBuild = steps.findIndex(
      (step, index) =>
        index > checkpoint && Boolean(step.run?.includes('assemble-windows-edition.cjs')),
    );
    if (nextBuild !== -1) expect(nextBuild).toBeGreaterThan(upload);
  }
  expect(steps.some(step => String(step.with?.name).startsWith('release-candidate-'))).toBe(false);
  const enterprise = steps.find(step => step.name === 'Verify shared Windows installer');
  expect(enterprise?.if).toBe('${{ inputs.enterprise-extension }}');
});

test('checkpoint contains public acceptance inputs and identity uses the current attempt', () => {
  const action = readFileSync('.github/actions/checkpoint-windows-package/action.yml', 'utf8');
  expect(action).toContain('Export-Certificate');
  expect(action).toContain('-Type CERT');
  expect(action).not.toContain('Export-PfxCertificate');
  for (const input of [
    'package.json release build-tar/windows-components resources/skill-python',
    'scripts/installer-shell/out/ZhiYuanUninstall.exe.manifest.json',
  ]) expect(action).toContain(input);
  const workflow = readFileSync('.github/workflows/build-windows-release.yml', 'utf8');
  expect(workflow).toContain('windows-acceptance-${{ github.run_id }}-${{ github.run_attempt }}-');
  expect(workflow).toContain(
    'release-candidate-${{ inputs.app-build-version }}-win32-x64-${{ matrix.edition }}',
  );
});

test('candidate freezing validates evidence before candidate creation', () => {
  const action = readFileSync('.github/actions/freeze-windows-candidate/action.yml', 'utf8');
  expect(action).toContain('set -euo pipefail');
  expect(action).toContain('out_dir="bundle-win32-x64-${EDITION}"');
  expect(action).toContain('Blockmap must belong to the updater');
  expect(action.indexOf('archive-windows-acceptance.mjs')).toBeLessThan(
    action.indexOf('create-release-candidate.mjs'),
  );
  expect(action).not.toContain('continue-on-error');
});


test('signer identity comes from the verified public checkpoint, not a masked job output', () => {
  const workflow = readFileSync('.github/workflows/build-windows-release.yml', 'utf8');
  expect(workflow).not.toContain('needs.windows-release.outputs.thumbprint');
  expect(workflow).not.toContain('      thumbprint: ${{ steps.certum-signing.outputs.thumbprint }}');
  const steps = releaseWorkflow().jobs.acceptance.steps;
  const restore = steps.findIndex(step => step.run?.includes('build-checkpoint.mjs restore'));
  const certificate = steps.findIndex(step => step.run?.includes('X509Certificate2'));
  const verify = steps.findIndex(step => step.uses === './.github/actions/verify-windows-package');
  expect(certificate).toBeGreaterThan(restore);
  expect(verify).toBeGreaterThan(certificate);
  expect(steps[certificate].run).toContain('Resolve-Path -LiteralPath release/signing-certificate.cer');
  expect(steps[certificate].run).toContain('if ($certificate.HasPrivateKey) { throw');
  expect(steps[verify].with?.['certificate-thumbprint']).toBe(
    '${{ steps.public-signing-identity.outputs.thumbprint }}',
  );
  const checkpoint = readFileSync('.github/actions/checkpoint-windows-package/action.yml', 'utf8');
  expect(checkpoint).toContain('if ($certificate.Thumbprint -ne $thumbprint) { throw');
});
