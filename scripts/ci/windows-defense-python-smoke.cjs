'use strict';

const assert = require('node:assert/strict');
const { fork } = require('node:child_process');
const { mkdir } = require('node:fs/promises');
const { join } = require('node:path');

const [app, resources, workspace] = process.argv.slice(2);
const runner = join(resources, 'app.asar', 'dist-electron', 'python-runtime-runner.js');
const storageRoot = join(workspace, 'state');
const timeoutMs = 180_000;

function run(operation, input) {
  return new Promise((resolve, reject) => {
    const child = fork(runner, [], {
      execPath: app,
      execArgv: [],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
    });
    const deadline = setTimeout(() => {
      child.kill();
      reject(new Error(`Packaged Python runner timed out during ${operation}`));
    }, timeoutMs + 10_000);
    let response;
    child.once('message', message => {
      response = message;
    });
    child.once('error', error => {
      clearTimeout(deadline);
      reject(error);
    });
    child.once('exit', (code, signal) => {
      clearTimeout(deadline);
      if (code === 0 && response?.success) resolve(response.result);
      else
        reject(new Error(response?.error || `Packaged Python runner exited (${code ?? signal})`));
    });
    child.send({
      operation,
      input: { ...input, workspace, timeoutMs },
      storageRoot,
      jobRunnerPath: join(resources, 'python-runtime', 'job-runner.exe'),
      preinstalledRuntime: {
        pythonPath: join(resources, 'python-win', 'python.exe'),
        uvPath: join(resources, 'uv-win', 'uv.exe'),
        runtimeId: 'defense-windows-package-smoke',
      },
      defensePackages: { wheelhouseRoot: join(resources, 'defense-python') },
    });
  });
}

async function main() {
  await mkdir(workspace, { recursive: true });
  const code =
    'import pandas, openpyxl, docx, pptx, httpx; print(int(pandas.Series([20, 22]).sum()))';
  const initial = await run('execute', { code });
  assert.equal(initial.exitCode, 0, initial.stderr);
  assert.equal(initial.stdout.trim(), '42');
  const failedInstall = await run('install', {
    packages: ['zhiyuan-offline-smoke-missing==0.0.1'],
  });
  assert.notEqual(failedInstall.exitCode, 0, 'An absent package must fail without a mirror');
  const reused = await run('execute', { code });
  assert.equal(reused.exitCode, 0, reused.stderr);
  assert.equal(reused.stdout.trim(), '42');
  assert.equal(reused.environmentId, initial.environmentId);
  console.log(
    'Packaged workspace Python seeded offline and kept its environment after a failed install.',
  );
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
