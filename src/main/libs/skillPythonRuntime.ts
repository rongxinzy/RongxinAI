import crypto from 'crypto';
import { app } from 'electron';
import fs from 'fs';
import path from 'path';

const RUNTIME_DIR_NAME = 'skill-python';
const SHARED_ENVIRONMENT_NAME = 'shared';
const LAYERS_DIRECTORY_NAME = 'layers';
const SKILLS_DIRECTORY_NAME = 'skills';

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

function readManifest(environmentRoot: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(
      fs.readFileSync(path.join(environmentRoot, 'runtime.json'), 'utf8'),
    );
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
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
    // Version 2 packages one uv-managed dependency layer instead of a full
    // venv per Skill. The per-Skill manifest above remains the compatibility
    // gate, so an updated Skill cannot silently run against stale packages.
    const executable = findPythonExecutable(
      path.join(root, LAYERS_DIRECTORY_NAME, SHARED_ENVIRONMENT_NAME),
    );
    if (executable) return executable;
  }
  return null;
}

export function getSkillPythonRuntimeRoot(): string | null {
  return candidateRoots()[0] || null;
}

/**
 * Resolve the shared dependency layer's Python executable without per-Skill
 * manifest gating. Used to put the managed environment (pandas, numpy, ...)
 * on the agent's shell PATH for ad-hoc scripts. Skill script execution still
 * goes through findSkillPythonExecutable with its compatibility gate.
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
