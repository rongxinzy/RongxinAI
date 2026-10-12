import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageDirectory = process.env.ZHIYUAN_ELECTRON_PACKAGE_DIR;
const requirePackage = process.env.ZHIYUAN_REQUIRE_ELECTRON_PACKAGE === '1';
const checks = [];

await assertBuildOutputs();
await run('npm', ['exec', 'vitest', '--', 'run', 'src/release/electron-rc.test.ts'], root);
checks.push(
  'enterprise extension host registration and disposal',
  'enterprise session login projection',
  'exclusive managed model projection',
  'OpenAI-compatible gateway fail-closed behavior',
  'provider credential and password redaction in projected state',
);

if (packageDirectory) {
  await run('node', ['scripts/verify-electron-package.mjs'], root, {
    ZHIYUAN_ELECTRON_PACKAGE_DIR: packageDirectory,
  });
  checks.push('packaged Electron enterprise assets match the build output');
} else if (requirePackage) {
  throw new Error(
    'ZHIYUAN_REQUIRE_ELECTRON_PACKAGE=1 requires ZHIYUAN_ELECTRON_PACKAGE_DIR to be set.',
  );
} else {
  checks.push('packaged Electron asset check deferred (no package directory supplied)');
}

const evidence = {
  status: 'passed',
  stage: 'release-candidate',
  generatedAt: new Date().toISOString(),
  packageDirectory: packageDirectory ?? null,
  checks,
};
const evidenceFile = process.env.ZHIYUAN_ELECTRON_RC_EVIDENCE_FILE;
if (evidenceFile) {
  await fs.mkdir(path.dirname(path.resolve(evidenceFile)), { recursive: true });
  await fs.writeFile(evidenceFile, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
}
console.log(JSON.stringify(evidence, null, 2));

async function assertBuildOutputs() {
  for (const [relativePath, kind] of [
    ['dist/extension.cjs', 'extension bundle'],
    ['dist/ui/index.html', 'enterprise renderer'],
    ['dist/admin/index.html', 'admin console'],
  ]) {
    const stat = await fs.stat(path.join(root, relativePath));
    assert.ok(stat.isFile(), `${kind} is missing: ${relativePath}`);
  }
}

function run(command, args, cwd, extraEnv = {}) {
  const executable = process.platform === 'win32' && command === 'npm' ? 'npm.cmd' : command;
  const spawnCommand =
    process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : executable;
  const spawnArgs =
    process.platform === 'win32' ? ['/d', '/s', '/c', [executable, ...args].join(' ')] : args;
  return new Promise((resolve, reject) => {
    const child = spawn(spawnCommand, spawnArgs, {
      cwd,
      env: { ...process.env, ...extraEnv },
      stdio: 'inherit',
      shell: false,
    });
    child.once('error', reject);
    child.once('exit', code => {
      if (code === 0) resolve();
      else reject(new Error(`${executable} ${args.join(' ')} exited with ${code ?? 'unknown'}.`));
    });
  });
}
