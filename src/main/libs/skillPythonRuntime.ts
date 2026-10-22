import crypto from 'crypto';
import { app } from 'electron';
import fs from 'fs';
import path from 'path';

const RUNTIME_DIR_NAME = 'skill-python';
const SHARED_ENVIRONMENT_NAME = 'shared';
const LAYERS_DIRECTORY_NAME = 'layers';
const SKILLS_DIRECTORY_NAME = 'skills';
const LOCKS_DIRECTORY_NAME = 'locks';

/**
 * Where a Skill's Python dependencies come from.
 *
 * `core` means the packaged offline layer already satisfies the Skill's
 * requirements. `overlay` means the Skill needs a per-Skill overlay directory
 * that the app installs on demand into user data (see skillPythonDependencies).
 */
export const SkillPythonCoverage = {
  Core: 'core',
  Overlay: 'overlay',
} as const;
export type SkillPythonCoverage = (typeof SkillPythonCoverage)[keyof typeof SkillPythonCoverage];

export interface SkillPythonDelta {
  /** Lock that pins exactly the packages the overlay still needs. */
  lockFile?: string;
  sha256?: string;
  packageCount?: number;
  packages?: string[];
}

export interface SkillPythonSkillManifest {
  version?: number;
  skillId?: string;
  coverage?: SkillPythonCoverage;
  requirementsSha256?: string;
  delta?: SkillPythonDelta | null;
}

export interface SkillPythonOverlayManifest {
  version?: number;
  skillId?: string;
  lockSha256?: string;
  installedAt?: string;
  packageCount?: number;
}

export type SkillPythonResolution =
  | {
      kind: 'ready';
      skillId: string;
      python: string;
      coverage: SkillPythonCoverage;
      /** Extra site-packages directory to expose through PYTHONPATH. */
      sitePackages: string | null;
    }
  | {
      kind: 'dependencies-missing';
      skillId: string;
      delta: SkillPythonDelta;
      /** Absolute path of the delta lock shipped with the app, when present. */
      lockPath: string | null;
    }
  | {
      kind: 'runtime-missing';
      skillId: string;
      reason: 'stale-skill' | 'no-layer';
    };

export type SkillPythonDependencyStatus =
  | { status: 'core'; skillId: string }
  | { status: 'installed'; skillId: string; sitePackages: string; packageCount: number }
  | {
      status: 'missing';
      skillId: string;
      lockPath: string | null;
      lockSha256: string | null;
      packageCount: number;
      packages: string[];
    }
  | { status: 'unavailable'; skillId: string; reason: 'stale-skill' | 'no-layer' };

function resolveBundledCandidates(): string[] {
  if (app.isPackaged) {
    const candidates: string[] = [];
    if (typeof process.resourcesPath === 'string' && process.resourcesPath) {
      candidates.push(path.join(process.resourcesPath, RUNTIME_DIR_NAME));
    }
    try {
      candidates.push(path.join(app.getAppPath(), RUNTIME_DIR_NAME));
    } catch {
      // Some Node-only test harnesses mark Electron as packaged without an app path.
    }
    const projectRoot = path.resolve(__dirname, '..', '..', '..');
    candidates.push(path.join(projectRoot, 'resources', RUNTIME_DIR_NAME));
    return candidates;
  }

  const projectRoot = path.resolve(__dirname, '..', '..', '..');
  return [
    path.join(projectRoot, 'resources', RUNTIME_DIR_NAME),
    path.join(process.cwd(), 'resources', RUNTIME_DIR_NAME),
    path.join(app.getAppPath(), 'resources', RUNTIME_DIR_NAME),
  ];
}

function findPythonExecutable(environmentRoot: string): string | null {
  const candidates =
    process.platform === 'win32'
      ? [
          path.join(environmentRoot, 'Scripts', 'python.exe'),
          path.join(environmentRoot, 'python.exe'),
        ]
      : [path.join(environmentRoot, 'bin', 'python3'), path.join(environmentRoot, 'bin', 'python')];
  return candidates.find(candidate => fs.existsSync(candidate)) || null;
}

function readJsonObject(filePath: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function readManifest(environmentRoot: string): Record<string, unknown> | null {
  return readJsonObject(path.join(environmentRoot, 'runtime.json'));
}

function requirementsHash(requirementsPath: string): string | null {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(requirementsPath)).digest('hex');
  } catch {
    return null;
  }
}

function candidateRoots(): string[] {
  const userRoot = path.join(app.getPath('userData'), 'runtimes', RUNTIME_DIR_NAME);
  return [userRoot, ...resolveBundledCandidates()].filter(
    (candidate, index, candidates) =>
      candidates.indexOf(candidate) === index && fs.existsSync(candidate),
  );
}

/**
 * Resolve a prebuilt Skill environment only when its requirements manifest
 * matches the active Skill copy. This prevents a stale user Skill update from
 * silently using incompatible packaged dependencies.
 */
export function findSkillPythonExecutable(
  skillId: string,
  requirementsPath: string,
): string | null {
  const expectedHash = requirementsHash(requirementsPath);
  if (!expectedHash) return null;

  for (const root of candidateRoots()) {
    const skillRoot = path.join(root, SKILLS_DIRECTORY_NAME, skillId);
    const manifest = readManifest(skillRoot);
    if (manifest?.requirementsSha256 !== expectedHash || manifest?.skillId !== skillId) continue;
    // Version 3 packages one uv-managed dependency layer instead of a full
    // venv per Skill. The per-Skill manifest above remains the compatibility
    // gate, so an updated Skill cannot silently run against stale packages.
    const executable = findPythonExecutable(
      path.join(root, LAYERS_DIRECTORY_NAME, SHARED_ENVIRONMENT_NAME),
    );
    if (executable) return executable;
  }
  return null;
}

/**
 * Resolve the shared dependency layer's Python executable without per-Skill
 * manifest gating. Used to put the managed environment (pandas, numpy, ...)
 * on the agent's shell PATH for ad-hoc scripts. Skill script execution still
 * goes through resolveSkillPython with its compatibility gate.
 */
export function findSharedSkillPythonExecutable(): string | null {
  for (const root of candidateRoots()) {
    const executable = findPythonExecutable(
      path.join(root, LAYERS_DIRECTORY_NAME, SHARED_ENVIRONMENT_NAME),
    );
    if (executable) return executable;
  }
  return null;
}

/** User-writable overlay directory that holds one Skill's on-demand packages. */
export function skillPythonOverlayRoot(skillId: string): string {
  return path.join(
    app.getPath('userData'),
    'runtimes',
    RUNTIME_DIR_NAME,
    LAYERS_DIRECTORY_NAME,
    skillId,
  );
}

function readSkillPythonManifest(
  skillId: string,
): { root: string; manifest: SkillPythonSkillManifest } | null {
  for (const root of candidateRoots()) {
    const manifest = readJsonObject(
      path.join(root, SKILLS_DIRECTORY_NAME, skillId, 'runtime.json'),
    ) as SkillPythonSkillManifest | null;
    if (manifest && manifest.skillId === skillId) return { root, manifest };
  }
  return null;
}

function findDeltaLockPath(root: string, lockFile: string | undefined): string | null {
  if (!lockFile) return null;
  const candidates = [
    path.join(root, LOCKS_DIRECTORY_NAME, lockFile),
    ...resolveBundledCandidates().map(candidate =>
      path.join(candidate, LOCKS_DIRECTORY_NAME, lockFile),
    ),
  ];
  return candidates.find(candidate => fs.existsSync(candidate)) || null;
}

export function readSkillPythonOverlayManifest(
  sitePackages: string,
): SkillPythonOverlayManifest | null {
  return readJsonObject(
    path.join(sitePackages, 'runtime.json'),
  ) as SkillPythonOverlayManifest | null;
}

/**
 * Decide how one Skill's Python dependencies are provided right now.
 *
 * The Skill manifest is fingerprinted by `requirements.txt`, so a marketplace
 * Skill update invalidates the packaged layer instead of silently running it
 * against packages it was never tested with.
 */
export function resolveSkillPython(
  skillId: string,
  requirementsPath: string,
): SkillPythonResolution {
  const expectedHash = requirementsHash(requirementsPath);
  if (!expectedHash) return { kind: 'runtime-missing', skillId, reason: 'stale-skill' };

  const matched = readSkillPythonManifest(skillId);
  if (!matched || matched.manifest.requirementsSha256 !== expectedHash) {
    return { kind: 'runtime-missing', skillId, reason: 'stale-skill' };
  }

  const python = findPythonExecutable(
    path.join(matched.root, LAYERS_DIRECTORY_NAME, SHARED_ENVIRONMENT_NAME),
  );
  if (!python) return { kind: 'runtime-missing', skillId, reason: 'no-layer' };

  const coverage = matched.manifest.coverage ?? SkillPythonCoverage.Core;
  if (coverage === SkillPythonCoverage.Core) {
    return { kind: 'ready', skillId, python, coverage, sitePackages: null };
  }

  const delta = matched.manifest.delta ?? {};
  const sitePackages = skillPythonOverlayRoot(skillId);
  const overlay = readSkillPythonOverlayManifest(sitePackages);
  if (overlay && delta.sha256 && overlay.lockSha256 === delta.sha256) {
    return { kind: 'ready', skillId, python, coverage, sitePackages };
  }

  return {
    kind: 'dependencies-missing',
    skillId,
    delta,
    lockPath: findDeltaLockPath(matched.root, delta.lockFile),
  };
}

/** Status projection used by tooling, IPC and the settings surface. */
export function skillPythonDependencyStatus(
  skillId: string,
  requirementsPath: string,
): SkillPythonDependencyStatus {
  const resolution = resolveSkillPython(skillId, requirementsPath);
  if (resolution.kind === 'ready') {
    if (resolution.coverage === SkillPythonCoverage.Core || !resolution.sitePackages) {
      return { status: 'core', skillId };
    }
    const overlay = readSkillPythonOverlayManifest(resolution.sitePackages);
    return {
      status: 'installed',
      skillId,
      sitePackages: resolution.sitePackages,
      packageCount: overlay?.packageCount ?? 0,
    };
  }
  if (resolution.kind === 'dependencies-missing') {
    return {
      status: 'missing',
      skillId,
      lockPath: resolution.lockPath,
      lockSha256: resolution.delta.sha256 ?? null,
      packageCount: resolution.delta.packageCount ?? 0,
      packages: resolution.delta.packages ?? [],
    };
  }
  return { status: 'unavailable', skillId, reason: resolution.reason };
}

/**
 * Create the Windows python3.exe alias inside the user-owned shared layer.
 *
 * uv venvs on Windows expose only Scripts/python.exe, while the bare base
 * runtime ships python.exe + python3.exe. Without an alias, `python3` on the
 * agent shell PATH resolves past the shared layer to the base interpreter,
 * which lacks the preinstalled Skill dependencies. The alias sits next to
 * python.exe, so venv home discovery behaves identically. Read-only resource
 * roots are never touched — packaged layers ship the alias from the build.
 */
export function ensureSharedSkillWindowsPython3Alias(
  platform: NodeJS.Platform = process.platform,
): void {
  if (platform !== 'win32') return;
  try {
    const scriptsDir = path.join(
      app.getPath('userData'),
      'runtimes',
      RUNTIME_DIR_NAME,
      LAYERS_DIRECTORY_NAME,
      SHARED_ENVIRONMENT_NAME,
      'Scripts',
    );
    const pythonExe = path.join(scriptsDir, 'python.exe');
    const python3Exe = path.join(scriptsDir, 'python3.exe');
    if (!fs.existsSync(pythonExe) || fs.existsSync(python3Exe)) return;
    fs.copyFileSync(pythonExe, python3Exe);
    console.log('[skill-python-runtime] created python3.exe alias in the shared layer');
  } catch (error) {
    console.warn('[skill-python-runtime] could not create the python3.exe alias:', error);
  }
}
