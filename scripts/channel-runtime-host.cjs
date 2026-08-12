'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SIDECAR_ENTRY = path.join('cmd', 'zhiyuan-sidecar', 'main.go');

function hasSidecarSource(sourceRoot, fileSystem = fs) {
  return Boolean(sourceRoot) && fileSystem.existsSync(path.join(sourceRoot, SIDECAR_ENTRY));
}

function parseGitWorktreeList(output) {
  return String(output || '')
    .split(/\r?\n/)
    .filter(line => line.startsWith('worktree '))
    .map(line => line.slice('worktree '.length).trim())
    .filter(Boolean);
}

function runGit(sourceRoot, args, runCommand = spawnSync) {
  const result = runCommand('git', ['-C', sourceRoot, ...args], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `Git ${args.join(' ')} failed for ${sourceRoot}: ${result.error?.message || result.stderr || `exit ${result.status}`}`,
    );
  }
  return String(result.stdout || '').trim();
}

function resolveSourceRoot(rootDir, options = {}) {
  const environment = options.environment ?? process.env;
  const fileSystem = options.fileSystem ?? fs;
  const runCommand = options.runCommand ?? spawnSync;
  const explicitSource = environment.ZHIYUAN_CC_CONNECT_SOURCE?.trim();
  if (explicitSource) {
    const resolved = path.resolve(explicitSource);
    if (!hasSidecarSource(resolved, fileSystem)) {
      throw new Error(`ZHIYUAN_CC_CONNECT_SOURCE does not contain ${SIDECAR_ENTRY}: ${resolved}`);
    }
    return resolved;
  }

  const repositoryCandidates = [
    environment.PI_CONNECT_SRC?.trim(),
    path.resolve(rootDir, '..', 'pi-connect'),
    path.resolve(rootDir, '..', '..', '..', 'pi-connect'),
  ].filter(Boolean);

  for (const candidate of [...new Set(repositoryCandidates.map(item => path.resolve(item)))]) {
    if (hasSidecarSource(candidate, fileSystem)) return candidate;
    if (!fileSystem.existsSync(path.join(candidate, '.git'))) continue;
    let worktrees = [];
    try {
      worktrees = parseGitWorktreeList(
        runGit(candidate, ['worktree', 'list', '--porcelain'], runCommand),
      );
    } catch {
      continue;
    }
    const sidecarWorktree = worktrees.find(worktree => hasSidecarSource(worktree, fileSystem));
    if (sidecarWorktree) return sidecarWorktree;
  }

  throw new Error(
    `Cannot find pi-connect source containing ${SIDECAR_ENTRY}. Set ZHIYUAN_CC_CONNECT_SOURCE to the reviewed PR worktree.`,
  );
}

function resolveHostTarget() {
  const goos = { win32: 'windows', darwin: 'darwin', linux: 'linux' }[process.platform];
  const goarch = { x64: 'amd64', arm64: 'arm64', ia32: '386' }[process.arch];
  if (!goos || !goarch) {
    throw new Error(`Unsupported channel runtime host: ${process.platform}/${process.arch}`);
  }
  return { goos, goarch, target: `${process.platform}-${process.arch}` };
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function publishRuntimeBinary(fileSystem, stagedBinary, binaryPath, revision) {
  try {
    fileSystem.rmSync(binaryPath, { force: true });
    fileSystem.renameSync(stagedBinary, binaryPath);
    return binaryPath;
  } catch (error) {
    if (!['EPERM', 'EBUSY'].includes(error?.code)) throw error;
    const extension = path.extname(binaryPath);
    const stem = binaryPath.slice(0, -extension.length);
    const revisionPath = `${stem}-${revision.slice(0, 12)}${extension}`;
    fileSystem.rmSync(revisionPath, { force: true });
    fileSystem.renameSync(stagedBinary, revisionPath);
    return revisionPath;
  }
}

function ensureCleanCommittedSource(sourceRoot, runCommand = spawnSync) {
  const revision = runGit(sourceRoot, ['rev-parse', 'HEAD'], runCommand);
  const status = runGit(sourceRoot, ['status', '--porcelain', '--untracked-files=no'], runCommand);
  if (status) {
    throw new Error(`pi-connect source has uncommitted tracked changes: ${sourceRoot}`);
  }
  return revision;
}

function buildHostChannelRuntime(rootDir, options = {}) {
  const runCommand = options.runCommand ?? spawnSync;
  const sourceRoot = options.sourceRoot ?? resolveSourceRoot(rootDir, options);
  const revision = ensureCleanCommittedSource(sourceRoot, runCommand);
  const { goos, goarch, target } = options.target ?? resolveHostTarget();
  const binaryName = goos === 'windows' ? 'cc-connect-sidecar.exe' : 'cc-connect-sidecar';
  const runtimeRoot = path.join(rootDir, 'vendor', 'channel-runtime', 'current');
  const binaryPath = path.join(runtimeRoot, binaryName);
  const stagedBinary = `${binaryPath}.staging`;
  fs.mkdirSync(runtimeRoot, { recursive: true });
  fs.rmSync(stagedBinary, { force: true });

  const result = runCommand(
    'go',
    ['build', '-trimpath', '-ldflags=-s -w', '-o', stagedBinary, './cmd/zhiyuan-sidecar'],
    {
      cwd: sourceRoot,
      env: { ...process.env, GOOS: goos, GOARCH: goarch, CGO_ENABLED: '0' },
      stdio: 'inherit',
      windowsHide: true,
    },
  );
  if (result.error || result.status !== 0 || !fs.existsSync(stagedBinary)) {
    fs.rmSync(stagedBinary, { force: true });
    throw new Error(
      `Failed to build channel runtime from ${sourceRoot}: ${result.error?.message || `exit ${result.status}`}`,
    );
  }

  const publishedBinaryPath = publishRuntimeBinary(fs, stagedBinary, binaryPath, revision);
  if (goos !== 'windows') fs.chmodSync(publishedBinaryPath, 0o755);
  const buildInfo = {
    schemaVersion: 1,
    sourceRepository: 'https://github.com/rongxinzy/pi-connect',
    sourceRevision: revision,
    sourcePath: sourceRoot,
    target,
    binary: path.basename(publishedBinaryPath),
    sha256: sha256(publishedBinaryPath),
  };
  fs.writeFileSync(
    path.join(runtimeRoot, 'runtime-build-info.json'),
    `${JSON.stringify(buildInfo, null, 2)}\n`,
    'utf8',
  );
  return { binaryPath: publishedBinaryPath, buildInfo };
}

function main() {
  const rootDir = path.resolve(__dirname, '..');
  const { binaryPath, buildInfo } = buildHostChannelRuntime(rootDir);
  console.log(
    `[ChannelRuntime] Built ${path.relative(rootDir, binaryPath)} from pi-connect ${buildInfo.sourceRevision}.`,
  );
  console.log(`[ChannelRuntime] SHA-256 ${buildInfo.sha256}`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`[ChannelRuntime] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

module.exports = {
  buildHostChannelRuntime,
  parseGitWorktreeList,
  publishRuntimeBinary,
  resolveSourceRoot,
};
