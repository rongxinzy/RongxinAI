const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { pythonVersion } = require('../../src/main/pythonRuntime/bundledRuntime.json');

const probeRoot = path.join(process.env.RUNNER_TEMP, 'uv-windows-path-probe');
const oldVersion = '0.11.32';
const newVersion = '0.13.9';
const tablibWheel = {
  url: 'https://files.pythonhosted.org/packages/fc/0f/3ae17545ff976687f679ed3a101df7017135ee04769e858a4ccea0cc3f3e/tablib-3.10.0-py3-none-any.whl',
  hash: '5721bf3a52d491f8f843628a3a3200db164f6ad9e92fb6eaa64dc3f945f30ad9',
};
const pillowWheel = {
  url: 'https://files.pythonhosted.org/packages/2e/cc/934e5820850ec5eb107e7b1a72dd278140731c669f396110ebc326f2a503/pillow-11.3.0-cp314-cp314-win_amd64.whl',
  hash: 'a418486160228f64dd9e9efcd132679b7a02a5f22c982c78b6fc7dab3fefb635',
};

const sha256 = data => createHash('sha256').update(data).digest('hex');
const wheelhouse = path.join(probeRoot, 'wheels');
const env = {
  ...process.env,
  UV_CACHE_DIR: path.join(probeRoot, 'uv-cache'),
  UV_NO_MODIFY_PATH: '1',
  UV_NO_PROGRESS: '1',
  PYTHONUTF8: '1',
};

function run(executable, args) {
  const child = spawnSync(executable, args, {
    env,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 120_000,
  });
  if (child.error) throw child.error;
  const result = {
    exitCode: child.status,
    stdout: child.stdout.trim(),
    stderr: child.stderr.trim(),
  };
  console.log(JSON.stringify({ executable, args, ...result }));
  return result;
}

function succeed(result, operation) {
  assert.equal(result.exitCode, 0, operation);
  return result.stdout;
}

function output(lines) {
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
}

async function downloadWheel({ url, hash }) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  assert.equal(response.ok, true, url);
  const file = Buffer.from(await response.arrayBuffer());
  assert.equal(sha256(file), hash, url);
  fs.writeFileSync(path.join(wheelhouse, path.basename(url)), file);
}

function uvFor(version) {
  const executable = findExecutable(path.join(probeRoot, version), 'uv.exe');
  assert.ok(succeed(run(executable, ['--version']), 'read uv version').startsWith('uv ' + version));
  return executable;
}

function findExecutable(root, executable) {
  const entry = fs.readdirSync(root, { recursive: true, withFileTypes: true })
    .find(item => item.isFile() && item.name === executable);
  assert.ok(entry, executable + ' was provisioned under ' + root);
  return path.join(entry.parentPath, entry.name);
}

function installPython(uv, version) {
  const installDir = path.join(probeRoot, 'python', version);
  succeed(
    run(uv, ['python', 'install', pythonVersion, '--install-dir', installDir, '--no-registry']),
    'provision pinned CPython',
  );
  return findExecutable(installDir, 'python.exe');
}

function pythonIn(environment) {
  return path.join(environment, 'Scripts', 'python.exe');
}

function createEnvironment(uv, python, environment) {
  succeed(
    run(uv, ['venv', '--no-config', '--no-python-downloads', '--python', python, environment]),
    'create environment',
  );
}

function installWheel(uv, environment, requirement) {
  return run(uv, [
    'pip',
    'install',
    '--no-config',
    '--no-python-downloads',
    '--python',
    pythonIn(environment),
    '--only-binary',
    ':all:',
    '--link-mode',
    'copy',
    '--no-index',
    '--find-links',
    wheelhouse,
    requirement,
  ]);
}

function testTablib(uv, python, version, depth) {
  const prefix = path.join(probeRoot, 'tablib', version, depth);
  const requested = path.join('Lib', 'site-packages', 'tablib-3.10.0.dist-info', 'REQUESTED');
  const markerLength = 268;
  const environment =
    depth === 'short'
      ? prefix
      : path.join(prefix, 'x'.repeat(markerLength - requested.length - prefix.length - 2));
  const marker = path.join(environment, requested);
  if (depth === 'deep') assert.equal(marker.length, markerLength);
  createEnvironment(uv, python, environment);
  const result = installWheel(uv, environment, 'tablib==3.10.0');
  const wasWritten = fs.existsSync(path.toNamespacedPath(marker));
  const resultLabel =
    result.exitCode === 0 && wasWritten
      ? 'installed'
      : /persist(ing)? temporary file|Failed to persist/i.test(result.stderr) &&
          /REQUESTED/.test(result.stderr)
        ? 'REQUESTED write failed'
        : 'other failure';
  return { version, depth, environment, marker: marker.length, resultLabel };
}

function testPillow(uv, python, row) {
  const { environment, version, depth } = row;
  const installation = installWheel(uv, environment, 'Pillow==11.3.0');
  let importLabel = 'not attempted';
  let extensionLength = '';
  if (installation.exitCode === 0) {
    const site = path.join(environment, 'Lib', 'site-packages');
    const nativePath = path.join(site, 'PIL', '_imaging.cp314-win_amd64.pyd');
    assert.ok(fs.existsSync(path.toNamespacedPath(nativePath)), 'Pillow native extension is on disk');
    extensionLength = nativePath.length;
    const imported = run(pythonIn(environment), [
      '-c',
      'from PIL import Image; print(Image.new("RGB", (1, 1)).size)',
    ]);
    importLabel =
      imported.exitCode === 0
        ? 'import/image OK'
        : /DLL load failed/.test(imported.stderr)
          ? 'DLL load failed'
          : 'other import failure';
    if (imported.exitCode !== 0) {
      run(python, [
        '-c',
        'import importlib.util,sys; p=sys.argv[1]; s=importlib.util.spec_from_file_location("_imaging",p); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); print(m.__file__)',
        nativePath,
      ]);
    }
  }
  return { version, depth, installation: installation.exitCode, importLabel, extensionLength };
}

async function main() {
  fs.mkdirSync(wheelhouse, { recursive: true });
  await Promise.all([downloadWheel(tablibWheel), downloadWheel(pillowWheel)]);
  const oldUv = uvFor(oldVersion);
  const newUv = uvFor(newVersion);
  const python = installPython(oldUv, oldVersion);
  const build = succeed(run(python, ['-VV']), 'inspect original CPython build');

  const rows = [
    testTablib(oldUv, python, oldVersion, 'short'),
    testTablib(oldUv, python, oldVersion, 'deep'),
    testTablib(newUv, python, newVersion, 'short'),
    testTablib(newUv, python, newVersion, 'deep'),
  ];
  const nativeRows = rows
    .filter(row => row.resultLabel === 'installed')
    .map(row => testPillow(row.version === oldVersion ? oldUv : newUv, python, row));

  output([
    '# Windows uv path experiment',
    '',
    'LongPathsEnabled=0. Both uv versions used the same CPython and SHA-256-verified PyPI wheels.',
    '',
    '## tablib package metadata write',
    '',
    '| uv | venv | REQUESTED path length | Result |',
    '| --- | --- | ---: | --- |',
    ...rows.map(row => ['|', row.version, '|', row.depth, '|', row.marker, '|', row.resultLabel, '|'].join(' ')),
    '',
    '## Pillow native extension',
    '',
    '| uv | venv | Install exit | Native path length | Python result |',
    '| --- | --- | ---: | ---: | --- |',
    ...nativeRows.map(row =>
      ['|', row.version, '|', row.depth, '|', row.installation, '|', row.extensionLength, '|', row.importLabel, '|'].join(' '),
    ),
    '',
    '## Managed Python toolchain',
    '',
    '- Original uv would provision ' + build + '.',
  ]);

  const newPython = installPython(newUv, newVersion);
  const newBuild = succeed(run(newPython, ['-VV']), 'inspect candidate CPython build');
  let sameArtifacts = true;
  for (const artifact of ['python.exe', 'python314.dll']) {
    const original = sha256(fs.readFileSync(path.join(path.dirname(python), artifact)));
    const replacement = sha256(fs.readFileSync(path.join(path.dirname(newPython), artifact)));
    sameArtifacts &&= original === replacement;
    console.log({ artifact, original, candidate: replacement });
  }
  output([
    '- Candidate uv would provision ' + newBuild + '.',
    '- python.exe and python314.dll both byte-identical: ' + sameArtifacts + '.',
  ]);
  assert.ok(rows.filter(row => row.depth === 'short').every(row => row.resultLabel === 'installed'));
  assert.ok(nativeRows.filter(row => row.depth === 'short').every(row => row.importLabel === 'import/image OK'));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
