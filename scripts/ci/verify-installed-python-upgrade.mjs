import assert from 'node:assert/strict';
import { execFileSync, fork } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LegacyPackage = 'w==0';
const TablibPackage = 'tablib==3.10.0';
const OperationTimeout = 300_000;
const ProfileRuntimePathLength = 66;
const LegacyPackageCode = [
  'import json, w',
  'from importlib.metadata import version',
  'print(json.dumps([version("w"), w.TOKEN]))',
].join('\n');
const OfficeCode = [
  'import json',
  'from io import BytesIO',
  'from importlib.metadata import version',
  'from openpyxl import load_workbook',
  'from openpyxl.compat.numbers import NUMERIC_TYPES',
  'from PIL import Image, _imaging',
  'from tablib import Dataset',
  'workbook = load_workbook(BytesIO(Dataset([42]).export("xlsx")))',
  'assert isinstance(workbook.active["A1"].value, NUMERIC_TYPES)',
  'assert Image.new("RGB", (2, 2), "red").getpixel((0, 0)) == (255, 0, 0)',
  'print(json.dumps([version("tablib"), workbook.active["A1"].value, _imaging.__file__]))',
].join('\n');

function assertLongPathsDisabled() {
  const output = execFileSync(
    path.join(process.env.SystemRoot, 'System32', 'reg.exe'),
    ['query', 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\FileSystem', '/v', 'LongPathsEnabled'],
    { encoding: 'utf8', windowsHide: true },
  );
  assert.match(output, /^\s*LongPathsEnabled\s+REG_DWORD\s+0x0\s*$/m);
}

function version(executable, product) {
  const output = execFileSync(executable, ['--version'], {
    encoding: 'utf8',
    timeout: 10_000,
    windowsHide: true,
  });
  const match = output.match(new RegExp(`^${product} (\\d+\\.\\d+\\.\\d+)\\b`));
  assert.ok(match, `Invalid ${product} version: ${output}`);
  return match[1];
}

async function digestFile(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

export async function deriveProfile(fixtureRoot) {
  await mkdir(fixtureRoot, { recursive: true });
  const root = await realpath(fixtureRoot);
  const profileNameLength = ProfileRuntimePathLength - path.join(root, 'python-runtime').length - 1;
  assert.ok(profileNameLength > 0, 'The fixture root is too long for the path-boundary probe');
  return path.join(root, 'p'.repeat(profileNameLength));
}

async function verifyConsole(scripts, token) {
  const stdout = execFileSync(path.join(scripts, 'q.exe'), [], {
    cwd: scripts,
    encoding: 'utf8',
    timeout: 15_000,
    windowsHide: true,
  });
  const [printedToken, interpreter] = JSON.parse(stdout);
  assert.equal(printedToken, token);
  assert.equal(
    (await realpath(interpreter)).toLowerCase(),
    (await realpath(path.join(scripts, 'python.exe'))).toLowerCase(),
  );
}

function operate(executable, runnerPath, request, indexEnv) {
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
  delete env.NODE_OPTIONS;
  delete env.UV_INDEX;
  delete env.UV_DEFAULT_INDEX;
  return new Promise((resolve, reject) => {
    const child = fork(runnerPath, [], {
      execPath: executable,
      execArgv: [],
      env: { ...env, ...indexEnv },
      signal: AbortSignal.timeout(OperationTimeout + 15_000),
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      windowsHide: true,
    });
    let response;
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => {
      stderr = (stderr + chunk).slice(-4_000);
    });
    child.once('message', message => {
      response = message;
    });
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (code !== 0 || !response) {
        reject(new Error(`Installed Python Runner did not answer (${code ?? signal}): ${stderr}`));
      } else if (!response.success) {
        reject(new Error(response.error));
      } else if (response.result.exitCode !== 0) {
        reject(new Error(`${request.operation} failed: ${response.result.stderr}`));
      } else {
        resolve(response.result);
      }
    });
    child.send(request, error => {
      if (!error) return;
      child.kill();
      reject(error);
    });
  });
}

async function seedWheel(pythonPath, jobRunnerPath, root, token, install) {
  // A short wheel name leaves room to install on the legacy path. The wheel is
  // generated locally so only this test can provide its unique payload.
  const wheelName = 'w-0-py3-none-any.whl';
  const wheelPath = path.join(root, wheelName);
  const buildWheel = [
    'import sys, zipfile',
    'from pathlib import Path',
    'module = f"import json, sys\\nTOKEN = {sys.argv[2]!r}\\ndef main():\\n    print(json.dumps([TOKEN, sys.executable]))\\n"',
    'files = {',
    '    "w.py": module,',
    '    "w-0.dist-info/METADATA": "Metadata-Version: 2.1\\nName: w\\nVersion: 0\\n",',
    '    "w-0.dist-info/WHEEL": "Wheel-Version: 1.0\\nRoot-Is-Purelib: true\\nTag: py3-none-any\\n",',
    '    "w-0.dist-info/entry_points.txt": "[console_scripts]\\nq = w:main\\n",',
    '    "w-0.data/scripts/f.exe": Path(sys.argv[3]).read_bytes(),',
    '}',
    'files["w-0.dist-info/RECORD"] = "".join(f"{name},,\\n" for name in [*files, "w-0.dist-info/RECORD"])',
    'with zipfile.ZipFile(sys.argv[1], "w") as wheel:',
    '    for name, contents in files.items():',
    '        wheel.writestr(name, contents)',
  ].join('\n');
  execFileSync(pythonPath, ['-I', '-c', buildWheel, wheelPath, token, jobRunnerPath], {
    timeout: 10_000,
    windowsHide: true,
  });
  const wheel = await readFile(wheelPath);
  const server = createServer((request, response) => {
    if (request.url === '/simple/w/') {
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end(`<a href="/${wheelName}">${wheelName}</a>`);
    } else if (request.url === `/${wheelName}`) {
      response.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      response.end(wheel);
    } else {
      response.writeHead(404).end();
    }
  });
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const index = `http://127.0.0.1:${server.address().port}/simple`;
    return await install({ UV_INDEX: index, UV_DEFAULT_INDEX: index, NO_PROXY: '127.0.0.1' });
  } finally {
    server.close();
  }
}

async function main() {
  const [phase, appExecutable, fixtureRoot] = process.argv.slice(2);
  assert.ok(
    ['seed', 'verify'].includes(phase) && appExecutable && fixtureRoot,
    'Usage: node verify-installed-python-upgrade.mjs seed|verify <installed-app-exe> <fixture-root>',
  );
  assert.equal(process.platform, 'win32', 'This probe requires Windows');
  assertLongPathsDisabled();

  const executable = await realpath(appExecutable);
  const resources = path.join(path.dirname(executable), 'resources');
  const archive = path.join(resources, 'app.asar');
  const runnerPath = path.join(archive, 'dist-electron', 'python-runtime-runner.js');
  const jobRunnerPath = path.join(resources, 'python-runtime', 'job-runner.exe');
  const pythonPath = path.join(resources, 'python-win', 'python.exe');
  const uvPath = path.join(resources, 'uv-win', 'uv.exe');
  const sharedPythonPath = path.join(
    resources,
    'skill-python',
    'layers',
    'shared',
    'Scripts',
    'python.exe',
  );
  await Promise.all(
    [archive, jobRunnerPath, pythonPath, uvPath, sharedPythonPath].map(file => access(file)),
  );
  const runtimeId = `bundled-cpython-${version(pythonPath, 'Python')}-uv-${version(uvPath, 'uv')}`;
  const archiveSha256 = await digestFile(archive);
  const profile = await deriveProfile(fixtureRoot);
  const root = path.dirname(profile);
  const storageRoot = path.join(profile, 'python-runtime');
  assert.equal(storageRoot.length, ProfileRuntimePathLength);
  const workspacePath = path.join(root, 'workspace 雪');
  await mkdir(workspacePath, { recursive: true });
  const workspace = await realpath(workspacePath);
  const workspaceKey = createHash('sha256').update(workspace.toLowerCase()).digest('hex');
  const stateRoot = path.join(storageRoot, 'workspaces-v2', workspaceKey);
  const currentFile = path.join(stateRoot, 'current.json');
  const readPointer = async () => JSON.parse(await readFile(currentFile, 'utf8'));
  const fixture = path.join(root, 'legacy-environment.json');
  const run = (operation, input, indexEnv) =>
    operate(
      executable,
      runnerPath,
      {
        operation,
        input: { workspace, timeoutMs: OperationTimeout, ...input },
        preinstalledRuntime: { runtimeId, pythonPath, sharedPythonPath, uvPath },
        jobRunnerPath,
        storageRoot,
        uvCacheDir: path.join(profile, 'runtimes', 'uv-cache'),
      },
      indexEnv,
    );

  if (phase === 'seed') {
    await assert.rejects(access(currentFile), { code: 'ENOENT' });
    const token = randomUUID();
    const installed = await seedWheel(pythonPath, jobRunnerPath, root, token, env =>
      run('install', { packages: [LegacyPackage] }, env),
    );
    const legacyRoot = path.join(stateRoot, installed.environmentId);
    assert.ok(installed.environmentId.startsWith(`${runtimeId}-`));
    assert.equal(installed.pythonPath, path.join(legacyRoot, 'Scripts', 'python.exe'));
    const legacyPackages = path.join(legacyRoot, 'Lib', 'site-packages');
    const legacyTablibLength = path.join(
      legacyPackages,
      'tablib-3.10.0.dist-info',
      'REQUESTED',
    ).length;
    const legacyOpenpyxlLength = path.join(
      legacyPackages,
      'openpyxl',
      'compat',
      'numbers.py',
    ).length;
    const legacyFixtureRequested = path.join(legacyPackages, 'w-0.dist-info', 'REQUESTED');
    assert.equal(legacyTablibLength, 268);
    assert.equal(legacyOpenpyxlLength, 261);
    assert.equal(legacyFixtureRequested.length, 258);
    await access(legacyFixtureRequested);
    const legacy = await run('execute', { code: LegacyPackageCode });
    assert.deepEqual(JSON.parse(legacy.stdout), ['0', token]);
    const legacyScripts = path.join(legacyRoot, 'Scripts');
    const binarySha256 = await digestFile(jobRunnerPath);
    assert.equal(await digestFile(path.join(legacyScripts, 'f.exe')), binarySha256);
    await verifyConsole(legacyScripts, token);
    const pointer = await readPointer();
    assert.equal(pointer.environmentId, installed.environmentId);
    assert.ok(pointer.requirements.includes(LegacyPackage));
    await writeFile(
      fixture,
      JSON.stringify({
        executable,
        archiveSha256,
        runtimeId,
        token,
        pointer,
        legacyRoot,
        binarySha256,
      }),
      { flag: 'wx' },
    );
    console.log(`[installed-python] Seeded the installed legacy workspace with ${LegacyPackage}`);
    console.log(
      `[installed-python] Legacy tablib and openpyxl paths are ${legacyTablibLength} and ${legacyOpenpyxlLength} characters`,
    );
    return;
  }

  const legacy = JSON.parse(await readFile(fixture, 'utf8'));
  assert.equal(executable, legacy.executable, 'The upgrade must use the same installed app path');
  assert.notEqual(
    archiveSha256,
    legacy.archiveSha256,
    'The installer did not replace the app archive',
  );
  assert.equal(runtimeId, legacy.runtimeId, 'This upgrade probe requires the same bundled runtime');
  assert.deepEqual(
    await readPointer(),
    legacy.pointer,
    'The upgrade must preserve the old workspace pointer',
  );
  const relocated = await run('execute', { code: LegacyPackageCode });
  assert.deepEqual(JSON.parse(relocated.stdout), ['0', legacy.token]);
  const pointer = await readPointer();
  assert.equal(pointer.environmentId, relocated.environmentId);
  assert.ok(pointer.requirements.includes(LegacyPackage));
  const newRoot = path.join(storageRoot, 'venvs', relocated.environmentId);
  const newScripts = path.join(newRoot, 'Scripts');
  assert.equal(relocated.pythonPath, path.join(newScripts, 'python.exe'));
  assert.equal(legacy.legacyRoot.length - newRoot.length, 107);
  await access(path.join(legacy.legacyRoot, 'Scripts', 'python.exe'));
  assert.equal(await digestFile(path.join(newScripts, 'f.exe')), legacy.binarySha256);
  await verifyConsole(newScripts, legacy.token);
  console.log(
    '[installed-python] Preserved the old wheel and shortened its active venv by 107 characters',
  );

  const installed = await run('install', { packages: [TablibPackage] });
  const finalPointer = await readPointer();
  assert.equal(finalPointer.environmentId, installed.environmentId);
  for (const dependency of [LegacyPackage, TablibPackage]) {
    assert.ok(finalPointer.requirements.includes(dependency), `Missing installed ${dependency}`);
  }
  const result = await run('execute', { code: OfficeCode });
  assert.equal(result.environmentId, installed.environmentId);
  const [tablibVersion, cell, nativeExtension] = JSON.parse(result.stdout);
  assert.equal(tablibVersion, '3.10.0');
  assert.equal(cell, 42);
  assert.match(nativeExtension, /\.pyd$/i);
  const nativeRelativePath = path.relative(
    path.join(storageRoot, 'venvs', result.environmentId),
    nativeExtension,
  );
  assert.match(nativeRelativePath, /^Lib\\site-packages\\PIL\\[^\\]+\.pyd$/i);
  assert.ok(nativeExtension.length < 260);
  const finalLegacy = await run('execute', { code: LegacyPackageCode });
  assert.deepEqual(JSON.parse(finalLegacy.stdout), ['0', legacy.token]);
  const finalScripts = path.dirname(installed.pythonPath);
  assert.equal(await digestFile(path.join(finalScripts, 'f.exe')), legacy.binarySha256);
  await verifyConsole(finalScripts, legacy.token);
  console.log(
    '[installed-python] Installed tablib, read back XLSX with openpyxl and loaded Pillow native extension',
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
