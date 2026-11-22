import { createHash } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import type { PythonSkillDependencies } from '../../shared/pythonRuntime';
import { readBoundedFile } from '../libs/boundedFileRead';

const NAME = '[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?';
const REQUIREMENT = new RegExp(`^(${NAME})(?:[ \\t]*\\[([^\\]]+)\\])?[ \\t]*(.*)$`);
const EXTRA = new RegExp(`^${NAME}$`);
const VERSION =
  /^v?(?:\d+!)?\d+(?:\.\d+)*(?:[-_.]?(?:a|b|c|rc|alpha|beta|pre|preview)[-_.]?\d*)?(?:(?:[-_.]?(?:post|rev|r)[-_.]?\d*)|-\d+)?(?:[-_.]?dev[-_.]?\d*)?(?:\+[a-z0-9]+(?:[-_.][a-z0-9]+)*)?$/i;
const SPECIFIER = /^(==|!=|>=|<=|>|<|~=)[ \t]*(\S+)$/;
const WILDCARD = /^(?:\d+!)?\d+(?:\.\d+)*\.\*$/;
const SHA256 = /^[a-f0-9]{64}$/i;
const MAX_REQUIREMENT_BYTES = 64 * 1024;
const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_LOCK_BYTES = 8 * 1024 * 1024;
const MAX_PACKAGES = 40;
const MAX_REQUIREMENT_LENGTH = 200;
const LOCKED_REQUIREMENT = new RegExp(`^${NAME}(?:\\[[A-Za-z0-9_,.-]+\\])?==(.+)$`);
const ManifestVersion = { FullCore: 2, Layered: 3 } as const;
const Coverage = { Core: 'core', Overlay: 'overlay' } as const;
const CONFIRM_REQUIRED_PACKAGES = new Set([
  'vtk',
  'vtkmodules',
  'cadquery-ocp',
  'cadquery-ocp-novtk',
  'ocp',
  'build123d',
  'scipy',
  'statsmodels',
  'playwright',
  'sympy',
  'scikit-learn',
]);

function invalidRequirement(): never {
  throw new Error(
    'Use PyPI package names or version constraints; URLs, paths, markers and command options are not accepted.',
  );
}

function normalizeRequirement(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length > MAX_REQUIREMENT_LENGTH ||
    /[\r\n\0]/.test(value)
  ) {
    return invalidRequirement();
  }
  const match = REQUIREMENT.exec(value.trim());
  if (!match) return invalidRequirement();
  const extras = match[2]?.split(',').map(extra => extra.trim());
  if (extras?.some(extra => !EXTRA.test(extra))) return invalidRequirement();
  const constraints = match[3]
    ? match[3].split(',').map(constraint => {
        const specifier = SPECIFIER.exec(constraint.trim());
        if (!specifier) return invalidRequirement();
        const [, operator, version] = specifier;
        const equality = operator === '==' || operator === '!=';
        if (version.includes('*')) {
          if (!equality || !WILDCARD.test(version)) return invalidRequirement();
        } else if (
          !VERSION.test(version) ||
          (!equality && version.includes('+')) ||
          (operator === '~=' && !/^(?:v)?(?:\d+!)?\d+\.\d+/i.test(version))
        ) {
          return invalidRequirement();
        }
        return `${operator}${version}`;
      })
    : [];
  return `${match[1]}${extras ? `[${extras.join(',')}]` : ''}${constraints.join(',')}`;
}

export function validatePackages(packages: unknown): string[] {
  if (!Array.isArray(packages) || packages.length > MAX_PACKAGES) return invalidRequirement();
  return packages.map(normalizeRequirement);
}

export function packageName(value: string): string {
  const normalized = normalizeRequirement(value);
  return normalized
    .split(/[\[<>=!~]/)[0]
    .toLowerCase()
    .replace(/[-_.]+/g, '-');
}

export interface ResolvedSkillRequirements {
  requirements: string[];
  requirementsSha256: string;
  lock?: { content: string; sha256: string };
  lockedRequirements?: string[];
  confirmationPackages?: string[];
  skillId: string;
}

const sha256 = (content: Buffer): string => createHash('sha256').update(content).digest('hex');
const manifestError = (detail: string): Error => new Error(`Skill dependency manifest ${detail}`);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const MARKER_VARIABLES = new Set([
  'python_version',
  'python_full_version',
  'os_name',
  'sys_platform',
  'platform_release',
  'platform_system',
  'platform_version',
  'platform_machine',
  'platform_python_implementation',
  'implementation_name',
  'implementation_version',
  'extra',
  'extras',
  'dependency_groups',
]);
const MARKER_OPERATORS = new Set(['===', '==', '!=', '<=', '>=', '<', '>', '~=', 'in', 'not in']);

/** Validate PEP 508 marker structure without evaluating another platform's conditions. */
function validMarker(marker: string): boolean {
  if (!marker || marker.length > MAX_REQUIREMENT_BYTES) return false;
  const token =
    /[ \t]*(?:'[^'\r\n\\]*'|"[^"\r\n\\]*"|===|==|!=|<=|>=|~=|[<>()]|not[ \t]+in\b|[A-Za-z_][A-Za-z0-9_]*)/y;
  const tokens: string[] = [];
  let offset = 0;
  while (offset < marker.length) {
    token.lastIndex = offset;
    const match = token.exec(marker);
    if (!match) return false;
    tokens.push(match[0].trim().replace(/^not[ \t]+in$/, 'not in'));
    offset = token.lastIndex;
  }
  let cursor = 0;
  const operand = () => {
    const value = tokens[cursor++];
    return (
      value !== undefined &&
      (value.startsWith("'") || value.startsWith('"') || MARKER_VARIABLES.has(value))
    );
  };
  function atom(depth: number): boolean {
    if (depth > 64) return false;
    if (tokens[cursor] === '(') {
      cursor++;
      if (!expression(depth + 1) || tokens[cursor++] !== ')') return false;
      return true;
    }
    return operand() && MARKER_OPERATORS.has(tokens[cursor++]) && operand();
  }
  function conjunction(depth: number): boolean {
    if (!atom(depth)) return false;
    while (tokens[cursor] === 'and') {
      cursor++;
      if (!atom(depth)) return false;
    }
    return true;
  }
  function expression(depth: number): boolean {
    if (!conjunction(depth)) return false;
    while (tokens[cursor] === 'or') {
      cursor++;
      if (!conjunction(depth)) return false;
    }
    return true;
  }
  return expression(0) && cursor === tokens.length;
}

function withoutLockComment(line: string): string {
  let quote: string | undefined;
  for (let index = 0; index < line.length; index++) {
    const value = line[index];
    if (quote) {
      if (value === quote) quote = undefined;
    } else if (value === "'" || value === '"') {
      quote = value;
    } else if (value === '#') {
      return line.slice(0, index);
    }
  }
  return line;
}

function withoutLockHashes(line: string): string {
  let quote: string | undefined;
  let result = '';
  for (let index = 0; index < line.length; index++) {
    const value = line[index];
    if (quote) {
      if (value === quote) quote = undefined;
    } else if (value === "'" || value === '"') {
      quote = value;
    } else if (line.startsWith('--hash', index) && (index === 0 || /\s/.test(line[index - 1]))) {
      const hashOption = /^--hash(?:=|[ \t]+)sha256:[a-f0-9]{64}(?=[ \t]|$)/i.exec(
        line.slice(index),
      );
      if (!hashOption) throw manifestError('contains an invalid wheel hash option.');
      index += hashOption[0].length - 1;
      result += ' ';
      continue;
    }
    result += value;
  }
  return result.trim();
}

function lockedRequirements(content: string): string[] {
  const requirements: string[] = [];
  let logicalLine = '';
  for (const physicalLine of content.split(/\r?\n/)) {
    const line = withoutLockComment(physicalLine).trim();
    if (!line) continue;
    const continued = line.endsWith('\\');
    logicalLine += `${line.slice(0, continued ? -1 : undefined)} `;
    if (continued) continue;
    const requirement = withoutLockHashes(logicalLine);
    logicalLine = '';
    const markerIndex = requirement.indexOf(';');
    const packagePart = markerIndex === -1 ? requirement : requirement.slice(0, markerIndex);
    const marker = markerIndex === -1 ? undefined : requirement.slice(markerIndex + 1).trim();
    let normalized: string;
    try {
      normalized = normalizeRequirement(packagePart);
    } catch {
      throw manifestError('delta lock must contain named exact package pins only.');
    }
    const exactPin = LOCKED_REQUIREMENT.exec(normalized);
    if (!exactPin || !VERSION.test(exactPin[1]) || (marker !== undefined && !validMarker(marker))) {
      throw manifestError(
        'delta lock must contain named exact pins and valid environment markers.',
      );
    }
    requirements.push(`${normalized}${marker === undefined ? '' : `; ${marker}`}`);
    if (requirements.length > 4096)
      throw manifestError('delta lock contains too many package pins.');
  }
  if (logicalLine.trim()) throw manifestError('delta lock ends with an unfinished continuation.');
  return [...new Set(requirements)];
}

function sharedRuntimeRoot(sharedPythonPath: string): string {
  const executableDirectory = path.dirname(path.resolve(sharedPythonPath));
  const environmentRoot = ['bin', 'scripts'].includes(
    path.basename(executableDirectory).toLowerCase(),
  )
    ? path.dirname(executableDirectory)
    : executableDirectory;
  if (
    path.basename(environmentRoot) !== 'shared' ||
    path.basename(path.dirname(environmentRoot)) !== 'layers'
  ) {
    throw manifestError('cannot locate the bundled Skill runtime root.');
  }
  return path.dirname(path.dirname(environmentRoot));
}

function within(root: string, filePath: string): boolean {
  const relative = path.relative(root, filePath);
  return (
    relative !== '' &&
    !relative.startsWith(`..${path.sep}`) &&
    relative !== '..' &&
    !path.isAbsolute(relative)
  );
}

async function readDeltaLock(
  root: string,
  delta: Record<string, unknown>,
  signal: AbortSignal,
): Promise<{ content: string; sha256: string }> {
  if (
    typeof delta.lockFile !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(delta.lockFile) ||
    typeof delta.sha256 !== 'string' ||
    !SHA256.test(delta.sha256)
  ) {
    throw manifestError('has an invalid delta lock descriptor.');
  }
  const realRoot = await realpath(root);
  const locksRoot = path.join(realRoot, 'locks');
  const realLocksRoot = await realpath(locksRoot);
  const lockPath = await realpath(path.join(locksRoot, delta.lockFile));
  if (realLocksRoot !== locksRoot || !within(realLocksRoot, lockPath)) {
    throw manifestError('delta lock must remain inside its locks directory.');
  }
  const bytes = await readBoundedFile(lockPath, MAX_LOCK_BYTES, signal);
  const digest = sha256(bytes);
  if (digest !== delta.sha256.toLowerCase()) throw manifestError('delta lock hash does not match.');
  const content = bytes.toString('utf8');
  if (!Buffer.from(content, 'utf8').equals(bytes)) throw manifestError('delta lock must be UTF-8.');
  return { content, sha256: digest };
}

/** Runs in the supervised Python Runner, outside Electron's main process. */
export async function resolveSkillRequirements(
  sharedPythonPath: string,
  skill: PythonSkillDependencies,
  signal: AbortSignal,
): Promise<ResolvedSkillRequirements> {
  try {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(skill.skillId)) {
      throw manifestError('has an invalid Skill identifier.');
    }
    const root = sharedRuntimeRoot(sharedPythonPath);
    const [requirementsBytes, manifestBytes] = await Promise.all([
      readBoundedFile(skill.requirementsPath, MAX_REQUIREMENT_BYTES, signal),
      readBoundedFile(
        path.join(root, 'skills', skill.skillId, 'runtime.json'),
        MAX_MANIFEST_BYTES,
        signal,
      ),
    ]);
    const requirementsSha256 = sha256(requirementsBytes);
    const manifest: unknown = JSON.parse(manifestBytes.toString('utf8'));
    if (
      !isRecord(manifest) ||
      manifest.skillId !== skill.skillId ||
      manifest.requirementsSha256 !== requirementsSha256 ||
      (manifest.version !== ManifestVersion.FullCore &&
        manifest.version !== ManifestVersion.Layered)
    ) {
      throw manifestError('is missing, stale or incompatible with this Skill.');
    }
    const requirements = validatePackages(
      requirementsBytes
        .toString('utf8')
        .split(/\r?\n/)
        .map(line => line.split('#')[0].trim())
        .filter(Boolean),
    );
    const result = { requirements, requirementsSha256, skillId: skill.skillId };
    if (
      (manifest.version === ManifestVersion.FullCore && manifest.coverage === undefined) ||
      manifest.coverage === Coverage.Core
    ) {
      return result;
    }
    if (
      manifest.version !== ManifestVersion.Layered ||
      manifest.coverage !== Coverage.Overlay ||
      !isRecord(manifest.delta)
    ) {
      throw manifestError('has invalid dependency coverage.');
    }
    const lock = await readDeltaLock(root, manifest.delta, signal);
    const pins = lockedRequirements(lock.content);
    const metadataPackages = manifest.delta.packages;
    if (
      !Array.isArray(metadataPackages) ||
      metadataPackages.some(value => typeof value !== 'string' || !EXTRA.test(value))
    ) {
      throw manifestError('has invalid delta package names.');
    }
    const lockedPackages = pins.map(requirement => packageName(requirement.split(';')[0]));
    const largePackages = [
      ...new Set([...metadataPackages, ...lockedPackages].map(packageName)),
    ].filter(name => CONFIRM_REQUIRED_PACKAGES.has(name));
    signal.throwIfAborted();
    return { ...result, lock, lockedRequirements: pins, confirmationPackages: largePackages };
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof Error && /^Skill dependency manifest/.test(error.message)) throw error;
    throw manifestError(
      `could not be verified: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
