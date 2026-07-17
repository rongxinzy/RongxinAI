'use strict';

const fs = require('fs');
const crypto = require('crypto');
const extractZip = require('extract-zip');
const { DownloaderHelper } = require('node-downloader-helper');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { pathToFileURL } = require('url');

const CliFlag = {
  Help: '--help',
  Manifest: '--manifest',
  ResourcesDir: '--resources-dir',
  AppDataDir: '--app-data-dir',
  LogPath: '--log-path',
  Platform: '--platform',
  Arch: '--arch',
  HasNvidiaGpu: '--has-nvidia-gpu',
  LocalSigningConfirmed: '--local-signing-confirmed',
  DryRun: '--dry-run',
};

const ExitCode = {
  Success: 0,
  InvalidArguments: 2,
  ManifestReadFailed: 10,
  UnsupportedRuntime: 11,
  NoCompatibleBackend: 12,
  LocalArchiveRequired: 13,
  Sha256Mismatch: 14,
  ArchiveInstallFailed: 15,
  DownloadFailed: 16,
  LocalSigningConfirmationRequired: 30,
  LocalSigningFailed: 31,
  UnexpectedFailure: 70,
};

const RuntimePlatform = {
  Windows: 'win32',
  LegacyWindows: 'windows',
};

const RuntimeArch = {
  X64: 'x64',
  Arm64: 'arm64',
};

const BackendAccelerator = {
  Cpu: 'cpu',
  Cuda: 'cuda',
};

const BackendId = {
  WinArm64: 'win-arm64',
  WinX64: 'win-x64',
  WinX64Cuda12: 'win-x64-cuda-12',
};

const ArchiveSource = {
  Local: 'local',
  Remote: 'remote',
};

const RuntimeBuildInfoSource = {
  NsisWinFull: 'nsis-win-full',
  NsisWinLite: 'nsis-win-lite',
};

const RuntimePathName = {
  Backends: 'backends',
  Build: 'build',
  Bin: 'bin',
  Current: 'current',
  Downloads: 'downloads',
};

const SelectionReason = {
  WindowsArm64Cpu: 'windows-arm64-cpu',
  WindowsX64Cuda: 'windows-x64-nvidia-cuda',
  WindowsX64Cpu: 'windows-x64-cpu',
  UnsupportedRuntime: 'unsupported-runtime',
  NoCompatibleBackend: 'no-compatible-backend',
};

const LLAMACPP_BACKEND_RESOURCES_DIR = 'llamacpp-backends';
const ZHIYUAN_APP_DATA_DIR = 'ZhiYuanAgent';
const LLAMACPP_RUNTIME_DIR = 'llamacpp-runtime';
const INSTALL_LOG_FILE = 'install-llamacpp.log';
const MANIFEST_FILE = 'manifest.json';
const BUILD_INFO_FILE = 'runtime-build-info.json';
const LLAMA_SERVER_EXE = 'llama-server.exe';
const LLAMA_SERVER_POSIX = 'llama-server';
const PREFERRED_CUDA_MAJOR = '12';
const NETWORK_FAILURE_HINT = 'Please check network, proxy, or firewall settings.';

const DownloadConfig = {
  UserAgent: 'ZhiYuanAgent/llamacpp-nsis-helper',
  ResumeOnIncompleteMaxRetry: 3,
  MaxRetries: 3,
  TotalRetryEvents: 6,
  RetryDelayMs: 1000,
};

const WindowsSignatureStatus = {
  Valid: 'Valid',
  NotSigned: 'NotSigned',
};

const PowerShellCommand = {
  Executable: 'powershell',
  NoProfile: '-NoProfile',
  NonInteractive: '-NonInteractive',
  ExecutionPolicy: '-ExecutionPolicy',
  Bypass: 'Bypass',
  Command: '-Command',
};

const LOCAL_SIGNING_CERT_SUBJECT = 'CN=ZhiYuanAgent Local Inference Runtime Signing';
const WINDOWS_SIGNABLE_FILE_EXTENSIONS = new Set(['.dll', '.exe']);

function parseCliArgs(argv) {
  const options = { dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === CliFlag.Help) {
      options.help = true;
      continue;
    }
    if (arg === CliFlag.DryRun) {
      options.dryRun = true;
      continue;
    }
    if (arg === CliFlag.LocalSigningConfirmed) {
      options.localSigningConfirmed = true;
      continue;
    }
    if (
      arg === CliFlag.Manifest ||
      arg === CliFlag.ResourcesDir ||
      arg === CliFlag.AppDataDir ||
      arg === CliFlag.LogPath ||
      arg === CliFlag.Platform ||
      arg === CliFlag.Arch ||
      arg === CliFlag.HasNvidiaGpu
    ) {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`Missing value for ${arg}.`);
      }
      index += 1;
      if (arg === CliFlag.Manifest) options.manifestPath = value;
      if (arg === CliFlag.ResourcesDir) options.resourcesDir = value;
      if (arg === CliFlag.AppDataDir) options.appDataDir = value;
      if (arg === CliFlag.LogPath) options.logPath = value;
      if (arg === CliFlag.Platform) options.platform = value;
      if (arg === CliFlag.Arch) options.arch = value;
      if (arg === CliFlag.HasNvidiaGpu) options.hasNvidiaGpu = parseBoolean(value);
      continue;
    }
    throw new Error(`Unknown argument: ${arg}.`);
  }
  return options;
}

function printUsage() {
  console.log(
    [
      'Usage: node scripts/install-llamacpp-backend-nsis.cjs [options]',
      '',
      'Options:',
      '  --manifest <path>            Manifest path. Defaults to resources/llamacpp-backends/manifest.json.',
      '  --resources-dir <path>       Directory containing manifest.json and optional backend archives.',
      '  --app-data-dir <path>        AppData root. Defaults to %APPDATA%/ZhiYuanAgent.',
      '  --log-path <path>            Log file path. Defaults to %APPDATA%/ZhiYuanAgent/install-llamacpp.log.',
      '  --platform <platform>        Runtime platform override for tests, for example win32.',
      '  --arch <arch>                Runtime arch override for tests, for example x64 or arm64.',
      '  --has-nvidia-gpu <true|false>  GPU override for tests.',
      '  --local-signing-confirmed   Allow the helper to locally sign unsigned Windows runtime files.',
      '  --dry-run                   Plan only. If omitted, the helper installs the selected backend.',
    ].join('\n'),
  );
}

function parseBoolean(value) {
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
  if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;
  throw new Error(`Invalid boolean value: ${value}.`);
}

function resolveDefaultResourcesDir(scriptDir = __dirname, cwd = process.cwd()) {
  const scriptSibling = path.join(scriptDir, LLAMACPP_BACKEND_RESOURCES_DIR);
  if (fs.existsSync(path.join(scriptSibling, MANIFEST_FILE))) return scriptSibling;

  const packagedResources = path.join(scriptDir, 'resources', LLAMACPP_BACKEND_RESOURCES_DIR);
  if (fs.existsSync(path.join(packagedResources, MANIFEST_FILE))) return packagedResources;

  return path.join(cwd, 'build', 'win-lite');
}

function resolveAppDataDir(env = process.env) {
  const appDataRoot = env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  return path.join(appDataRoot, ZHIYUAN_APP_DATA_DIR);
}

function resolveLogPath(appDataDir) {
  return path.join(appDataDir, INSTALL_LOG_FILE);
}

function readManifest(manifestPath) {
  const raw = fs.readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(raw);
  if (!manifest || !Array.isArray(manifest.backends)) {
    throw new Error('Invalid llama.cpp backend manifest: missing backends array.');
  }
  return manifest;
}

function buildInstallPlan(input = {}) {
  const resourcesDir = path.resolve(
    input.resourcesDir || resolveDefaultResourcesDir(input.scriptDir, input.cwd),
  );
  const manifestPath = path.resolve(input.manifestPath || path.join(resourcesDir, MANIFEST_FILE));
  const manifest = input.manifest || readManifest(manifestPath);
  const platform = normalizePlatform(input.platform || process.platform);
  const arch = input.arch || process.arch;
  const hasNvidiaGpu =
    typeof input.hasNvidiaGpu === 'boolean'
      ? input.hasNvidiaGpu
      : detectNvidiaGpu({ platform, arch });
  const selection = selectRecommendedBackend(manifest, { platform, arch, hasNvidiaGpu });

  if (!selection.entry) {
    const exitCode =
      selection.reason === SelectionReason.UnsupportedRuntime
        ? ExitCode.UnsupportedRuntime
        : ExitCode.NoCompatibleBackend;
    return {
      success: false,
      exitCode,
      reason: selection.reason,
      error: selection.message,
      platform,
      arch,
      hasNvidiaGpu,
      manifestPath,
      resourcesDir,
    };
  }

  const appDataDir = path.resolve(input.appDataDir || resolveAppDataDir(input.env));
  const runtimeRoot = path.join(appDataDir, LLAMACPP_RUNTIME_DIR);
  const ref = toBackendRef(selection.entry);
  const backendDir = path.join(runtimeRoot, RuntimePathName.Backends, ref.version, ref.backend);
  const currentPath = path.join(runtimeRoot, RuntimePathName.Current);
  const downloadsDir = path.join(runtimeRoot, RuntimePathName.Downloads);
  const archivePlan = resolveArchivePlan(selection.entry, manifest, resourcesDir);

  return {
    success: true,
    exitCode: ExitCode.Success,
    dryRun: Boolean(input.dryRun),
    reason: selection.reason,
    platform,
    arch,
    hasNvidiaGpu,
    manifestPath,
    resourcesDir,
    runtimeRoot,
    backendDir,
    currentPath,
    downloadsDir,
    backend: {
      ...ref,
      platform: normalizePlatform(selection.entry.platform),
      arch: selection.entry.arch,
      accelerator: selection.entry.accelerator,
      cudaMajor: selection.entry.cudaMajor,
    },
    archive: archivePlan,
  };
}

function selectRecommendedBackend(manifest, runtime) {
  const platform = normalizePlatform(runtime.platform);
  const arch = runtime.arch;
  if (
    platform !== RuntimePlatform.Windows ||
    ![RuntimeArch.X64, RuntimeArch.Arm64].includes(arch)
  ) {
    return {
      entry: null,
      reason: SelectionReason.UnsupportedRuntime,
      message: `Unsupported llama.cpp NSIS runtime: ${platform}/${arch}.`,
    };
  }

  const compatible = manifest.backends.filter(
    entry => normalizePlatform(entry.platform) === RuntimePlatform.Windows && entry.arch === arch,
  );
  if (compatible.length === 0) {
    return {
      entry: null,
      reason: SelectionReason.NoCompatibleBackend,
      message: `No compatible llama.cpp backend is declared for ${platform}/${arch}.`,
    };
  }

  if (arch === RuntimeArch.Arm64) {
    return {
      entry: findPreferredBackend(compatible, {
        backend: BackendId.WinArm64,
        accelerator: BackendAccelerator.Cpu,
      }),
      reason: SelectionReason.WindowsArm64Cpu,
    };
  }

  if (runtime.hasNvidiaGpu) {
    const cudaBackend = findPreferredCudaBackend(compatible);
    if (cudaBackend) {
      return {
        entry: cudaBackend,
        reason: SelectionReason.WindowsX64Cuda,
      };
    }
  }

  return {
    entry: findPreferredBackend(compatible, {
      backend: BackendId.WinX64,
      accelerator: BackendAccelerator.Cpu,
    }),
    reason: SelectionReason.WindowsX64Cpu,
  };
}

function findPreferredBackend(entries, preference) {
  return (
    entries.find(entry => entry.backend === preference.backend) ||
    entries.find(entry => entry.accelerator === preference.accelerator) ||
    entries[0] ||
    null
  );
}

function findPreferredCudaBackend(entries) {
  const cudaEntries = entries.filter(entry => entry.accelerator === BackendAccelerator.Cuda);
  return (
    cudaEntries.find(entry => String(entry.cudaMajor || '') === PREFERRED_CUDA_MAJOR) ||
    cudaEntries.find(entry => entry.backend.includes(`cuda-${PREFERRED_CUDA_MAJOR}`)) ||
    cudaEntries[0] ||
    null
  );
}

function resolveArchivePlan(entry, manifest, resourcesDir) {
  const archive = entry.archive;
  if (!archive?.assetName) return null;

  const localArchivePath = path.join(resourcesDir, archive.assetName);
  if (fs.existsSync(localArchivePath)) {
    return {
      source: ArchiveSource.Local,
      assetName: archive.assetName,
      sha256: archive.sha256,
      path: localArchivePath,
      url: pathToFileURL(localArchivePath).href,
      requiresDownload: false,
    };
  }

  return {
    source: ArchiveSource.Remote,
    assetName: archive.assetName,
    sha256: archive.sha256,
    url: archive.url || resolveReleaseAssetUrl(manifest, archive.assetName),
    requiresDownload: true,
  };
}

function resolveReleaseAssetUrl(manifest, assetName) {
  if (!manifest.releaseBaseUrl) return undefined;
  return `${String(manifest.releaseBaseUrl).replace(/\/+$/, '')}/${assetName}`;
}

function detectNvidiaGpu(runtime) {
  if (runtime.platform !== RuntimePlatform.Windows || runtime.arch !== RuntimeArch.X64)
    return false;
  const result = spawnSync('nvidia-smi', ['-L'], {
    encoding: 'utf8',
    timeout: 5000,
    windowsHide: true,
  });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  return result.status === 0 && /nvidia|gpu/i.test(output);
}

function normalizePlatform(platform) {
  if (platform === RuntimePlatform.LegacyWindows) return RuntimePlatform.Windows;
  return platform;
}

function toBackendRef(entry) {
  return {
    version: entry.version,
    backend: entry.backend,
    versionBackend: `${entry.version}/${entry.backend}`,
  };
}

function appendLog(logPath, message) {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${message}\n`, 'utf8');
}

function writePlanLog(plan, logPath, mode = 'dry-run') {
  appendLog(logPath, `llama.cpp NSIS helper ${mode} started`);
  if (!plan.success) {
    appendLog(logPath, `selection failed: ${plan.error}`);
    return;
  }
  appendLog(logPath, `selected backend: ${plan.backend.versionBackend}`);
  appendLog(logPath, `runtime root: ${plan.runtimeRoot}`);
  appendLog(logPath, `backend dir: ${plan.backendDir}`);
  appendLog(logPath, `current link: ${plan.currentPath}`);
  appendLog(logPath, `archive source: ${plan.archive?.source || 'none'}`);
  if (mode === 'dry-run') {
    appendLog(
      logPath,
      'dry-run complete; no download, extraction, or junction changes were executed',
    );
  }
}

async function runCli(argv = process.argv.slice(2), env = process.env) {
  try {
    const options = parseCliArgs(argv);
    if (options.help) {
      printUsage();
      return ExitCode.Success;
    }
    const appDataDir = path.resolve(options.appDataDir || resolveAppDataDir(env));
    const logPath = path.resolve(options.logPath || resolveLogPath(appDataDir));
    const plan = buildInstallPlan({ ...options, appDataDir, env });
    if (!plan.success) {
      writePlanLog(plan, logPath);
      console.error(plan.error);
      return plan.exitCode;
    }
    if (options.dryRun) {
      writePlanLog(plan, logPath);
      console.log(JSON.stringify(plan, null, 2));
      return ExitCode.Success;
    }
    writePlanLog(plan, logPath, 'install');
    const result = await installBackendFromPlan(plan, {
      localSigningConfirmed: Boolean(options.localSigningConfirmed),
      logPath,
    });
    if (!result.success) {
      console.error(result.error);
      return result.exitCode || ExitCode.UnexpectedFailure;
    }
    console.log(JSON.stringify(result, null, 2));
    return result.exitCode;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    return /manifest/i.test(message) || /json/i.test(message)
      ? ExitCode.ManifestReadFailed
      : ExitCode.InvalidArguments;
  }
}

async function installBackendFromPlan(plan, options = {}) {
  const logPath = options.logPath || resolveLogPath(path.dirname(plan.runtimeRoot));
  try {
    if (!plan.success) {
      return plan;
    }

    assertSafeBackendRef(plan.backend);
    const archive = await prepareArchiveForInstall(plan, logPath);
    fs.mkdirSync(plan.runtimeRoot, { recursive: true });
    appendLog(logPath, `installing backend: ${plan.backend.versionBackend} from ${archive.source}`);
    await verifySha256(archive.path, archive.sha256);

    const tempRoot = fs.mkdtempSync(path.join(plan.runtimeRoot, '.install-'));
    const extractDir = path.join(tempRoot, 'extract');
    const stagedBackendDir = path.join(tempRoot, 'backend');
    try {
      fs.mkdirSync(extractDir, { recursive: true });
      fs.mkdirSync(getManagedBackendBinDir(stagedBackendDir), { recursive: true });
      appendLog(logPath, `extracting archive: ${archive.path}`);
      await extractZip(archive.path, { dir: extractDir });

      const executableName = resolveLlamaServerExecutableName(plan.platform);
      const extractedExecutable = findExecutablePath(extractDir, executableName);
      if (!extractedExecutable) {
        throw new Error(`Backend archive does not contain ${executableName}.`);
      }

      copyDirectoryContents(
        path.dirname(extractedExecutable),
        getManagedBackendBinDir(stagedBackendDir),
      );
      const stagedExecutable = getManagedBackendExecutablePath(stagedBackendDir, plan.platform);
      if (!fs.existsSync(stagedExecutable)) {
        throw new Error(
          `Staged backend is missing ${path.join(RuntimePathName.Build, RuntimePathName.Bin, executableName)}.`,
        );
      }

      writeRuntimeBuildInfo(stagedBackendDir, {
        version: plan.backend.version,
        backend: plan.backend.backend,
        versionBackend: plan.backend.versionBackend,
        target: plan.backend.backend,
        source: archive.buildInfoSource,
        archive: archive.assetName,
        archiveSha256: archive.sha256,
        archiveUrl: archive.url,
        platform: plan.backend.platform,
        arch: plan.backend.arch,
        accelerator: plan.backend.accelerator,
        cudaMajor: plan.backend.cudaMajor,
        installedAt: new Date().toISOString(),
      });

      const signingResult = ensureWindowsRuntimeLocalSigning({
        binDir: getManagedBackendBinDir(stagedBackendDir),
        certificateProvider: options.localSigningCertificateProvider,
        confirmed: Boolean(options.localSigningConfirmed),
        fileSigner: options.localSigningFileSigner,
        logPath,
        platform: plan.platform,
        statusProvider: options.localSigningStatusProvider,
      });
      if (!signingResult.success) {
        return failedInstallResult(signingResult.exitCode, signingResult.error);
      }

      replaceBackendDirectory(stagedBackendDir, plan.backendDir, logPath);
      syncCurrentBackend(plan.runtimeRoot, plan.backendDir, plan.currentPath);
      const executablePath = getManagedBackendExecutablePath(plan.currentPath, plan.platform);
      appendLog(logPath, `installed backend: ${plan.backend.versionBackend}`);
      return {
        success: true,
        exitCode: ExitCode.Success,
        backend: plan.backend,
        runtimeRoot: plan.runtimeRoot,
        backendDir: plan.backendDir,
        currentPath: plan.currentPath,
        executablePath,
      };
    } finally {
      safeRemovePath(tempRoot, logPath);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    appendLog(logPath, `installation failed: ${message}`);
    return failedInstallResult(resolveInstallFailureExitCode(error), message);
  }
}

async function prepareArchiveForInstall(plan, logPath) {
  if (!plan.archive?.assetName) {
    throw createInstallError(
      ExitCode.ArchiveInstallFailed,
      'Selected backend does not declare an archive.',
    );
  }
  if (plan.archive.source === ArchiveSource.Local && plan.archive.path) {
    return {
      source: ArchiveSource.Local,
      buildInfoSource: RuntimeBuildInfoSource.NsisWinFull,
      path: plan.archive.path,
      assetName: plan.archive.assetName,
      sha256: plan.archive.sha256,
      url: plan.archive.url,
    };
  }
  if (plan.archive.source === ArchiveSource.Remote) {
    const archivePath = await downloadRemoteArchive(plan, logPath);
    return {
      source: ArchiveSource.Remote,
      buildInfoSource: RuntimeBuildInfoSource.NsisWinLite,
      path: archivePath,
      assetName: plan.archive.assetName,
      sha256: plan.archive.sha256,
      url: plan.archive.url,
    };
  }
  throw createInstallError(
    ExitCode.LocalArchiveRequired,
    'Local llama.cpp backend archive is required when no remote archive URL is available.',
  );
}

async function downloadRemoteArchive(plan, logPath) {
  if (!plan.archive.url) {
    throw createInstallError(
      ExitCode.DownloadFailed,
      `Remote llama.cpp backend archive URL is missing. ${NETWORK_FAILURE_HINT}`,
    );
  }

  fs.mkdirSync(plan.downloadsDir, { recursive: true });
  const outputPath = path.join(plan.downloadsDir, plan.archive.assetName);
  appendLog(logPath, `downloading archive: ${plan.archive.url}`);

  const downloader = new DownloaderHelper(plan.archive.url, plan.downloadsDir, {
    fileName: plan.archive.assetName,
    headers: { 'User-Agent': DownloadConfig.UserAgent },
    override: true,
    removeOnFail: false,
    removeOnStop: false,
    resumeIfFileExists: true,
    resumeOnIncomplete: true,
    resumeOnIncompleteMaxRetry: DownloadConfig.ResumeOnIncompleteMaxRetry,
    retry: { maxRetries: DownloadConfig.MaxRetries, delay: DownloadConfig.RetryDelayMs },
  });
  let retryEvents = 0;
  let retryAbortError = null;
  downloader.on('retry', (_attempt, _retryOptions, error) => {
    retryEvents += 1;
    appendLog(
      logPath,
      `download retry scheduled: ${Math.min(retryEvents, DownloadConfig.TotalRetryEvents)}/${DownloadConfig.TotalRetryEvents}`,
    );
    if (retryEvents >= DownloadConfig.TotalRetryEvents && !retryAbortError) {
      const message =
        error instanceof Error ? error.message : String(error || 'retry limit exceeded');
      retryAbortError = createInstallError(
        ExitCode.DownloadFailed,
        `Download failed after automatic retries. ${NETWORK_FAILURE_HINT} ${message}`,
      );
      setImmediate(() => {
        downloader.stop().catch(stopError => {
          const stopMessage = stopError instanceof Error ? stopError.message : String(stopError);
          appendLog(logPath, `download retry stop failed: ${stopMessage}`);
        });
      });
    }
  });
  downloader.on('error', () => undefined);

  try {
    const downloadResult = await downloader.start();
    if (retryAbortError) {
      throw retryAbortError;
    }
    if (downloadResult === false) {
      throw createInstallError(
        ExitCode.DownloadFailed,
        `Downloaded llama.cpp backend archive is incomplete. ${NETWORK_FAILURE_HINT}`,
      );
    }
  } catch (error) {
    if (retryAbortError) {
      throw retryAbortError;
    }
    const message = error instanceof Error ? error.message : String(error);
    throw createInstallError(
      ExitCode.DownloadFailed,
      `Download failed after automatic retries. ${NETWORK_FAILURE_HINT} ${message}`,
    );
  }

  if (!fs.existsSync(outputPath)) {
    throw createInstallError(
      ExitCode.DownloadFailed,
      `Downloaded llama.cpp backend archive was not created. ${NETWORK_FAILURE_HINT}`,
    );
  }

  appendLog(logPath, `downloaded archive: ${outputPath}`);
  return outputPath;
}

async function verifySha256(filePath, expectedSha256) {
  if (!expectedSha256) return;
  const actualSha256 = await calculateSha256(filePath);
  if (actualSha256.toLowerCase() !== String(expectedSha256).toLowerCase()) {
    throw new Error(`SHA256 mismatch for ${path.basename(filePath)}.`);
  }
}

function calculateSha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function getManagedBackendBinDir(backendDir) {
  return path.join(backendDir, RuntimePathName.Build, RuntimePathName.Bin);
}

function getManagedBackendExecutablePath(backendDir, platform) {
  return path.join(getManagedBackendBinDir(backendDir), resolveLlamaServerExecutableName(platform));
}

function resolveLlamaServerExecutableName(platform) {
  return normalizePlatform(platform) === RuntimePlatform.Windows
    ? LLAMA_SERVER_EXE
    : LLAMA_SERVER_POSIX;
}

function findExecutablePath(rootDir, executableName) {
  const queue = [rootDir];
  while (queue.length > 0) {
    const currentDir = queue.shift();
    if (!currentDir) continue;
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      const entryPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        queue.push(entryPath);
        continue;
      }
      if (entry.isFile() && entry.name === executableName) {
        return entryPath;
      }
    }
  }
  return null;
}

function copyDirectoryContents(sourceDir, targetDir) {
  fs.mkdirSync(targetDir, { recursive: true });
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    fs.cpSync(sourcePath, targetPath, { recursive: true });
  }
}

function writeRuntimeBuildInfo(backendDir, buildInfo) {
  fs.writeFileSync(
    path.join(backendDir, BUILD_INFO_FILE),
    `${JSON.stringify(buildInfo, null, 2)}\n`,
    'utf8',
  );
}

function ensureWindowsRuntimeLocalSigning(input) {
  const platform = normalizePlatform(input.platform);
  if (platform !== RuntimePlatform.Windows) {
    return { success: true, checkedCount: 0, signedCount: 0 };
  }

  const hasInjectedSigningProvider = Boolean(
    input.statusProvider || input.certificateProvider || input.fileSigner,
  );
  if (process.platform !== RuntimePlatform.Windows && !hasInjectedSigningProvider) {
    appendLog(input.logPath, 'local signing skipped because the helper is not running on Windows');
    return { success: true, checkedCount: 0, signedCount: 0 };
  }

  try {
    const signableFiles = findWindowsRuntimeSignableFiles(input.binDir);
    if (signableFiles.length === 0) {
      appendLog(
        input.logPath,
        'local signing skipped because no Windows executable files were staged',
      );
      return { success: true, checkedCount: 0, signedCount: 0 };
    }

    const getSignatureStatus = input.statusProvider || getWindowsAuthenticodeStatus;
    const unsignedFiles = [];
    for (const filePath of signableFiles) {
      const status = getSignatureStatus(filePath);
      if (status === WindowsSignatureStatus.NotSigned) {
        unsignedFiles.push(filePath);
      }
    }

    if (unsignedFiles.length === 0) {
      appendLog(
        input.logPath,
        `local signing skipped because all ${signableFiles.length} executable files already have signatures or are not signable PE files`,
      );
      return { success: true, checkedCount: signableFiles.length, signedCount: 0 };
    }

    appendLog(
      input.logPath,
      `local signing confirmation required for ${unsignedFiles.length} unsigned Windows runtime files`,
    );
    if (!input.confirmed) {
      return failedInstallResult(
        ExitCode.LocalSigningConfirmationRequired,
        `${unsignedFiles.length} unsigned Windows llama.cpp runtime files require local signing confirmation.`,
      );
    }

    const getCertificate = input.certificateProvider || ensureWindowsLocalCodeSigningCertificate;
    const signFile = input.fileSigner || signWindowsRuntimeFile;
    const thumbprint = getCertificate(input.logPath);
    let signedCount = 0;
    for (const filePath of unsignedFiles) {
      const status = signFile(filePath, thumbprint);
      if (!status || status === WindowsSignatureStatus.NotSigned) {
        throw createInstallError(
          ExitCode.LocalSigningFailed,
          `Local signing did not attach a signature to ${path.basename(filePath)}.`,
        );
      }
      signedCount += 1;
    }

    appendLog(input.logPath, `local signing completed for ${signedCount} Windows runtime files`);
    return { success: true, checkedCount: signableFiles.length, signedCount };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    appendLog(input.logPath, `local signing failed: ${message}`);
    return failedInstallResult(resolveLocalSigningFailureExitCode(error), message);
  }
}

function findWindowsRuntimeSignableFiles(rootDir) {
  const resolvedRoot = path.resolve(rootDir);
  if (!fs.existsSync(resolvedRoot)) {
    return [];
  }

  const files = [];
  const queue = [resolvedRoot];
  while (queue.length > 0) {
    const currentDir = queue.shift();
    if (!currentDir) continue;
    assertPathInside(currentDir, resolvedRoot);
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      const entryPath = path.join(currentDir, entry.name);
      assertPathInside(entryPath, resolvedRoot);
      if (entry.isDirectory()) {
        queue.push(entryPath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (WINDOWS_SIGNABLE_FILE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        files.push(entryPath);
      }
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
}

function getWindowsAuthenticodeStatus(filePath) {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    '$signature = Get-AuthenticodeSignature -FilePath $args[0]',
    'Write-Output $signature.Status',
  ].join('; ');
  return readLastNonEmptyLine(runPowerShellScript(script, [filePath], { timeoutMs: 15000 }));
}

function ensureWindowsLocalCodeSigningCertificate(logPath) {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    '$subject = $args[0]',
    '$cert = Get-ChildItem -Path Cert:\\CurrentUser\\My -CodeSigningCert | Where-Object { $_.Subject -eq $subject -and $_.NotAfter -gt (Get-Date).AddDays(7) } | Sort-Object NotAfter -Descending | Select-Object -First 1',
    'if (-not $cert) { $cert = New-SelfSignedCertificate -Type CodeSigningCert -Subject $subject -CertStoreLocation Cert:\\CurrentUser\\My -KeyUsage DigitalSignature }',
    "$stores = @('Cert:\\CurrentUser\\Root', 'Cert:\\CurrentUser\\TrustedPublisher')",
    'foreach ($store in $stores) {',
    '  $target = Join-Path $store $cert.Thumbprint',
    '  if (-not (Test-Path $target)) { Copy-Item -Path ("Cert:\\CurrentUser\\My\\" + $cert.Thumbprint) -Destination $store | Out-Null }',
    '}',
    'Write-Output $cert.Thumbprint',
  ].join('; ');
  const thumbprint = readLastNonEmptyLine(
    runPowerShellScript(script, [LOCAL_SIGNING_CERT_SUBJECT], { timeoutMs: 60000 }),
  );
  if (!thumbprint) {
    throw createInstallError(
      ExitCode.LocalSigningFailed,
      'Local code signing certificate was not created.',
    );
  }
  appendLog(logPath, `local signing certificate ready: ${thumbprint}`);
  return thumbprint;
}

function signWindowsRuntimeFile(filePath, thumbprint) {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    '$thumbprint = $args[0]',
    '$filePath = $args[1]',
    '$cert = Get-Item -Path ("Cert:\\CurrentUser\\My\\" + $thumbprint)',
    '$signature = Set-AuthenticodeSignature -FilePath $filePath -Certificate $cert',
    'if ($signature.Status -eq "NotSigned") { Write-Output $signature.Status; exit 2 }',
    '$updated = Get-AuthenticodeSignature -FilePath $filePath',
    'Write-Output $updated.Status',
  ].join('; ');
  return readLastNonEmptyLine(
    runPowerShellScript(script, [thumbprint, filePath], { timeoutMs: 60000 }),
  );
}

function runPowerShellScript(script, args = [], options = {}) {
  const result = spawnSync(
    PowerShellCommand.Executable,
    [
      PowerShellCommand.NoProfile,
      PowerShellCommand.NonInteractive,
      PowerShellCommand.ExecutionPolicy,
      PowerShellCommand.Bypass,
      PowerShellCommand.Command,
      script,
      ...args,
    ],
    {
      encoding: 'utf8',
      timeout: options.timeoutMs || 60000,
      windowsHide: true,
    },
  );
  const stdout = String(result.stdout || '').trim();
  const stderr = String(result.stderr || '').trim();
  if (result.error) {
    throw createInstallError(ExitCode.LocalSigningFailed, result.error.message);
  }
  if (result.status !== 0) {
    throw createInstallError(
      ExitCode.LocalSigningFailed,
      stderr || stdout || `PowerShell exited with code ${result.status}.`,
    );
  }
  return stdout;
}

function readLastNonEmptyLine(output) {
  const lines = String(output || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
  return lines.length > 0 ? lines[lines.length - 1] : '';
}

function assertPathInside(targetPath, rootDir) {
  const root = path.resolve(rootDir);
  const target = path.resolve(targetPath);
  const relative = path.relative(root, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw createInstallError(ExitCode.LocalSigningFailed, `Unsafe local signing path: ${target}`);
  }
}

function resolveLocalSigningFailureExitCode(error) {
  if (error && typeof error.exitCode === 'number') {
    return error.exitCode;
  }
  return ExitCode.LocalSigningFailed;
}

function replaceBackendDirectory(stagedBackendDir, backendDir, logPath) {
  fs.mkdirSync(path.dirname(backendDir), { recursive: true });
  fs.rmSync(backendDir, { recursive: true, force: true });
  try {
    fs.renameSync(stagedBackendDir, backendDir);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    appendLog(logPath, `staged backend rename failed, falling back to copy: ${message}`);
    fs.rmSync(backendDir, { recursive: true, force: true });
    fs.cpSync(stagedBackendDir, backendDir, { recursive: true });
  }
}

function syncCurrentBackend(runtimeRoot, backendDir, currentPath) {
  fs.mkdirSync(runtimeRoot, { recursive: true });
  removeCurrentBackend(currentPath);
  fs.symlinkSync(backendDir, currentPath, 'junction');
}

function removeCurrentBackend(currentPath) {
  try {
    const stat = fs.lstatSync(currentPath);
    if (stat.isSymbolicLink()) {
      fs.unlinkSync(currentPath);
      return;
    }
    fs.rmSync(currentPath, { recursive: true, force: true });
  } catch {
    // Missing current backend is valid.
  }
}

function safeRemovePath(targetPath, logPath) {
  try {
    fs.rmSync(targetPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    appendLog(logPath, `temporary cleanup skipped: ${message}`);
  }
}

function assertSafeBackendRef(ref) {
  for (const value of [ref.version, ref.backend]) {
    if (!/^[A-Za-z0-9._-]+$/.test(value) || value.includes('..')) {
      throw new Error(`Unsafe llama.cpp backend path segment: ${value}`);
    }
  }
}

function failedInstallResult(exitCode, error) {
  return {
    success: false,
    exitCode,
    error,
  };
}

function createInstallError(exitCode, message) {
  const error = new Error(message);
  error.exitCode = exitCode;
  return error;
}

function resolveInstallFailureExitCode(error) {
  if (error && typeof error.exitCode === 'number') {
    return error.exitCode;
  }
  const message = error instanceof Error ? error.message : String(error);
  return /SHA256/i.test(message) ? ExitCode.Sha256Mismatch : ExitCode.ArchiveInstallFailed;
}

module.exports = {
  ArchiveSource,
  BackendAccelerator,
  BackendId,
  CliFlag,
  DownloadConfig,
  ExitCode,
  RuntimeArch,
  RuntimeBuildInfoSource,
  RuntimePathName,
  RuntimePlatform,
  SelectionReason,
  WindowsSignatureStatus,
  buildInstallPlan,
  detectNvidiaGpu,
  ensureWindowsRuntimeLocalSigning,
  findWindowsRuntimeSignableFiles,
  installBackendFromPlan,
  parseCliArgs,
  readManifest,
  resolveAppDataDir,
  resolveDefaultResourcesDir,
  resolveLogPath,
  runCli,
  selectRecommendedBackend,
};

if (require.main === module) {
  runCli().then(exitCode => {
    process.exitCode = exitCode;
  });
}
