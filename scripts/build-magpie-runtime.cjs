#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { parseArgs } = require('node:util');
const {
  TARGETS,
  upstream,
  targetFor,
  binaryName,
  sha256File,
  verifyRuntime,
} = require('./magpie-runtime.cjs');

const projectRoot = path.resolve(__dirname, '..');

function run(command, args, options = {}) {
  return execFileSync(command, args, { stdio: 'inherit', windowsHide: true, ...options });
}

function cleanGoEnvironment(cacheRoot, target) {
  const home = path.join(cacheRoot, 'home');
  fs.mkdirSync(home, { recursive: true });
  // Never import the developer's Magpie, provider, Go workspace, or account configuration.
  const env = {};
  for (const key of [
    'PATH',
    'Path',
    'SystemRoot',
    'WINDIR',
    'COMSPEC',
    'PATHEXT',
    'TMP',
    'TEMP',
    'TMPDIR',
    'HTTPS_PROXY',
    'HTTP_PROXY',
    'NO_PROXY',
  ]) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return {
    ...env,
    HOME: home,
    USERPROFILE: home,
    APPDATA: path.join(home, 'AppData', 'Roaming'),
    LOCALAPPDATA: path.join(home, 'AppData', 'Local'),
    XDG_CONFIG_HOME: path.join(home, 'config'),
    XDG_CACHE_HOME: path.join(home, 'cache'),
    XDG_DATA_HOME: path.join(home, 'data'),
    GOENV: 'off',
    GOTOOLCHAIN: 'local',
    GOWORK: 'off',
    GOPATH: path.join(cacheRoot, 'gopath'),
    GOMODCACHE: path.join(cacheRoot, 'modules'),
    GOCACHE: path.join(cacheRoot, 'go-build'),
    GOPROXY: 'https://proxy.golang.org',
    GOSUMDB: 'sum.golang.org',
    GOFLAGS: '',
    GOEXPERIMENT: '',
    GOAMD64: 'v1',
    GOARM64: 'v8.0',
    CGO_ENABLED: '0',
    GOOS: target.goos,
    GOARCH: target.goarch,
    MAGPIE_NO_ACCOUNTS: '1',
    MAGPIE_ADDR: '127.0.0.1:0',
  };
}

function treeDigest(root) {
  const hash = crypto.createHash('sha256');
  function visit(relative) {
    for (const entry of fs
      .readdirSync(path.join(root, relative), { withFileTypes: true })
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) visit(name);
      else if (entry.isFile()) {
        const bytes = fs.readFileSync(path.join(root, name));
        hash.update(`${name}\0${bytes.length}\0`).update(bytes);
      } else throw new Error(`Unsupported upstream source entry: ${name}`);
    }
  }
  visit('');
  return hash.digest('hex');
}

function buildArguments(output) {
  return [
    'build',
    '-mod=readonly',
    '-buildvcs=false',
    '-tags',
    'nogui',
    '-trimpath',
    '-ldflags',
    `-s -w -X main.version=${upstream.version}`,
    '-o',
    output,
    '.',
  ];
}

function archiveArguments(repository, output, emptyAttributes, commit = upstream.commit) {
  // git archive applies checkout conversions and host configuration to stored blobs.
  // Match the pinned LF tar bytes without changing repository or global settings.
  return [
    '-C',
    repository,
    '-c',
    'core.autocrlf=false',
    '-c',
    'core.eol=lf',
    '-c',
    'tar.umask=0002',
    '-c',
    `core.attributesFile=${emptyAttributes}`,
    'archive',
    '--format=tar',
    `--output=${output}`,
    commit,
  ];
}

function build(options = {}) {
  const keys =
    options.target === 'all'
      ? Object.keys(TARGETS)
      : [options.target || `${process.platform}-${process.arch}`];
  keys.forEach(targetFor);
  const cache = path.join(projectRoot, '.cache', 'magpie');
  const outputRoot = path.join(projectRoot, 'resources', 'magpie');
  fs.mkdirSync(cache, { recursive: true });
  const work = fs.mkdtempSync(path.join(cache, 'build-'));
  const source = path.join(work, 'source');
  const archive = path.join(work, 'upstream.tar');
  const go = options.go || 'go';
  const env = cleanGoEnvironment(cache, TARGETS[keys[0]]);
  try {
    const version = run(go, ['version'], { env, encoding: 'utf8', stdio: 'pipe' }).trim();
    if (!version.startsWith(`go version ${upstream.goVersion} `)) {
      throw new Error(
        `Expected ${upstream.goVersion}, got ${version}. Install the official SDK using the pinned checksums in resources/magpie/upstream.json.`,
      );
    }
    let repository = options.source ? path.resolve(options.source) : path.join(work, 'checkout');
    if (!options.source) {
      fs.mkdirSync(repository);
      run('git', ['init', repository]);
      run('git', ['-C', repository, 'remote', 'add', 'origin', upstream.repository]);
      run('git', ['-C', repository, 'fetch', '--depth=1', 'origin', upstream.commit]);
    }
    const git = args =>
      run('git', ['-C', repository, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();
    if (git(['rev-parse', `${upstream.commit}^{tree}`]) !== upstream.tree)
      throw new Error('Upstream tree does not match the pin');
    if (options.source && git(['status', '--porcelain', '--untracked-files=all'])) {
      throw new Error('The provided source checkout must be clean; no local patches are accepted');
    }
    // A real empty file also works with Git for Windows, which rejects Node's \\.\nul path.
    const emptyAttributes = path.join(work, 'empty.attributes');
    fs.writeFileSync(emptyAttributes, '');
    run('git', archiveArguments(repository, archive, emptyAttributes));
    const archiveSha256 = sha256File(archive);
    if (archiveSha256 !== upstream.archiveSha256)
      throw new Error(
        `Pinned upstream archive SHA-256 mismatch: expected ${upstream.archiveSha256}, got ${archiveSha256}`,
      );
    fs.mkdirSync(source);
    run('tar', ['-xf', archive, '-C', source]);
    for (const [filename, expected] of [
      ['go.mod', upstream.goModSha256],
      ['go.sum', upstream.goSumSha256],
      ['LICENSE', upstream.licenseSha256],
    ]) {
      if (sha256File(path.join(source, filename)) !== expected)
        throw new Error(`Pinned ${filename} SHA-256 mismatch`);
    }
    const sourceTreeSha256 = treeDigest(source);
    for (const key of keys) {
      const target = targetFor(key);
      const staging = path.join(work, key);
      fs.mkdirSync(staging);
      const executable = path.join(staging, binaryName(key));
      console.log(`[magpie-build] Building unchanged ${upstream.commit} for ${key}`);
      run(go, buildArguments(executable), { cwd: source, env: cleanGoEnvironment(cache, target) });
      if (treeDigest(source) !== sourceTreeSha256)
        throw new Error('The build modified upstream source files');
      fs.chmodSync(executable, 0o755);
      const sha256 = sha256File(executable);
      const manifest = {
        schemaVersion: 1,
        platform: target.platform,
        arch: target.arch,
        binary: binaryName(key),
        version: upstream.version,
        sha256,
        buildSha256: sha256,
        sizeBytes: fs.statSync(executable).size,
        source: {
          repository: upstream.repository,
          commit: upstream.commit,
          tree: upstream.tree,
          archiveSha256: upstream.archiveSha256,
          treeSha256: sourceTreeSha256,
          goModSha256: upstream.goModSha256,
          goSumSha256: upstream.goSumSha256,
        },
        toolchain: { version: upstream.goVersion },
        build: {
          version: upstream.version,
          goos: target.goos,
          goarch: target.goarch,
          cgoEnabled: false,
          tags: 'nogui',
          trimpath: true,
          buildvcs: false,
          mod: 'readonly',
          ldflags: `-s -w -X main.version=${upstream.version}`,
        },
        license: { name: 'MIT', file: 'LICENSE', sha256: upstream.licenseSha256 },
      };
      fs.copyFileSync(path.join(source, 'LICENSE'), path.join(staging, 'LICENSE'));
      fs.writeFileSync(
        path.join(staging, 'manifest.json'),
        `${JSON.stringify(manifest, null, 2)}\n`,
      );
      verifyRuntime(work, key);
      const destination = path.join(outputRoot, key);
      fs.mkdirSync(destination, { recursive: true });
      // Publish the validated staging payload only after compilation has succeeded.
      for (const filename of [binaryName(key), 'LICENSE', 'manifest.json']) {
        fs.copyFileSync(path.join(staging, filename), path.join(destination, filename));
      }
      fs.chmodSync(path.join(destination, binaryName(key)), 0o755);
      console.log(`[magpie-build] ${key} ${sha256}`);
    }
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

if (require.main === module) {
  try {
    const { values } = parseArgs({
      args: process.argv[2] === '--' ? process.argv.slice(3) : process.argv.slice(2),
      options: {
        target: { type: 'string' },
        source: { type: 'string' },
        go: { type: 'string' },
        help: { type: 'boolean' },
      },
    });
    if (values.help) {
      console.log(
        'Build unchanged, pinned Magpie CLI source.\nUsage: bun run magpie:build -- --target all|linux-x64|linux-arm64|darwin-x64|darwin-arm64|win32-x64|win32-arm64 [--source clean-checkout] [--go /path/to/go]\nRequires Git, tar, and the exact official Go SDK pinned in resources/magpie/upstream.json.',
      );
    } else build(values);
  } catch (error) {
    console.error(`[magpie-build] ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { build, buildArguments, archiveArguments, cleanGoEnvironment, treeDigest };
