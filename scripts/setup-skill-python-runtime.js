#!/usr/bin/env node
/**
 * Build one relocatable Python dependency layer for Skills that declare
 * requirements.txt. Each Skill keeps its own requirement fingerprint, but the
 * wheels live in a single uv-managed environment. This prevents duplicated
 * numpy/pandas/psycopg2 installations from inflating the offline installer.
 */

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const SKILLS_ROOT = path.join(PROJECT_ROOT, 'SKILLs');
const RUNTIME_ROOT = path.join(PROJECT_ROOT, 'resources', 'skill-python');
const MANIFEST_VERSION = 2;
const SHARED_ENVIRONMENT_NAME = 'shared';
const LAYERS_DIRECTORY_NAME = 'layers';
const SKILLS_DIRECTORY_NAME = 'skills';
const LOCKS_DIRECTORY_NAME = 'locks';

const IMPORT_NAME_OVERRIDES = {
  pillow: 'PIL',
  'scikit-learn': 'sklearn',
  'psycopg2-binary': 'psycopg2',
  pypdfium2: 'pypdfium2',
};
const PYTHON_STDLIB_MODULES = new Set([
  '__future__',
  'argparse',
  'ast',
  'builtins',
  'cProfile',
  'collections',
  'colorsys',
  'copy',
  'datetime',
  'decimal',
  'html',
  'io',
  'json',
  'math',
  'os',
  'pathlib',
  'pstats',
  'random',
  're',
  'shutil',
  'sqlite3',
  'subprocess',
  'sys',
  'tempfile',
  'textwrap',
  'time',
  'traceback',
  'tracemalloc',
  'typing',
  'xml',
  'zipfile',
]);

function normalizePlatform(value = process.platform) {
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'win' || normalized === 'windows' || normalized === 'win32') return 'win32';
  if (normalized === 'mac' || normalized === 'macos' || normalized === 'darwin') return 'darwin';
  if (normalized === 'linux') return 'linux';
  throw new Error(`Unsupported Skill Python target platform: ${value}`);
}

function listRequirementFiles(skillsRoot = SKILLS_ROOT) {
  if (!fs.existsSync(skillsRoot)) return [];
  return fs
    .readdirSync(skillsRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => {
      const skillId = entry.name;
      const requirementsPath = path.join(skillsRoot, skillId, 'requirements.txt');
      return fs.existsSync(requirementsPath) ? { skillId, requirementsPath } : null;
    })
    .filter(Boolean)
    .sort((left, right) => left.skillId.localeCompare(right.skillId));
}

function listPythonFiles(root) {
  const files = [];
  const visit = current => {
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.py')) {
        files.push(fullPath);
      }
    }
  };
  visit(root);
  return files;
}

function parsePythonImportNames(filePath) {
  const names = new Set();
  const source = fs.readFileSync(filePath, 'utf8');
  for (const line of source.split(/\r?\n/)) {
    const fromMatch = line.match(/^\s*from\s+([A-Za-z_][A-Za-z0-9_.]*)\s+import\s+/);
    if (fromMatch) {
      names.add(fromMatch[1].split('.')[0]);
      continue;
    }
    const importMatch = line.match(/^\s*import\s+(.+)$/);
    if (!importMatch) continue;
    for (const imported of importMatch[1].split(',')) {
      const name = imported.trim().split(/\s+as\s+/)[0].trim();
      if (/^[A-Za-z_][A-Za-z0-9_.]*$/.test(name)) {
        names.add(name.split('.')[0]);
      }
    }
  }
  return names;
}

function validateSkillDependencyDeclarations(skillsRoot = SKILLS_ROOT) {
  const missing = [];
  if (!fs.existsSync(skillsRoot)) return { ok: true, missing };

  for (const entry of fs.readdirSync(skillsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillId = entry.name;
    const skillDir = path.join(skillsRoot, skillId);
    const pythonFiles = listPythonFiles(skillDir);
    const localModules = new Set(pythonFiles.map(filePath => path.basename(filePath, '.py')));
    const requirementsPath = path.join(skillDir, 'requirements.txt');
    const declaredImports = fs.existsSync(requirementsPath)
      ? new Set(parseImportNames(requirementsPath))
      : new Set();

    for (const pythonFile of pythonFiles) {
      for (const importName of parsePythonImportNames(pythonFile)) {
        if (
          PYTHON_STDLIB_MODULES.has(importName) ||
          localModules.has(importName) ||
          declaredImports.has(importName)
        ) {
          continue;
        }
        missing.push(`${skillId}: ${importName} is imported but not declared in requirements.txt`);
      }
    }
  }

  return { ok: missing.length === 0, missing };
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function parseImportNames(requirementsPath) {
  const names = [];
  const seen = new Set();
  for (const line of fs.readFileSync(requirementsPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('-')) continue;
    const match = trimmed.match(/^([A-Za-z0-9_.-]+)/);
    if (!match) continue;
    const packageName = match[1].toLowerCase();
    const importName = IMPORT_NAME_OVERRIDES[packageName] || packageName.replaceAll('-', '_');
    if (!seen.has(importName)) {
      seen.add(importName);
      names.push(importName);
    }
  }
  return names;
}

function pythonExecutableForEnvironment(environmentRoot, platform) {
  const candidates =
    platform === 'win32'
      ? [
          path.join(environmentRoot, 'Scripts', 'python.exe'),
          path.join(environmentRoot, 'python.exe'),
        ]
      : [path.join(environmentRoot, 'bin', 'python3'), path.join(environmentRoot, 'bin', 'python')];
  return candidates.find(candidate => fs.existsSync(candidate)) || null;
}

function walkSymlinks(root) {
  const links = [];
  const visit = current => {
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      let stat;
      try {
        stat = fs.lstatSync(fullPath);
      } catch {
        continue;
      }
      if (stat.isSymbolicLink()) {
        links.push(fullPath);
      } else if (stat.isDirectory()) {
        visit(fullPath);
      }
    }
  };
  visit(root);
  return links;
}

function rebaseEnvironmentSymlinks(environmentRoot, basePythonPath) {
  const baseRuntimeRoot = path.dirname(path.dirname(basePythonPath));
  for (const linkPath of walkSymlinks(environmentRoot)) {
    const linkTarget = fs.readlinkSync(linkPath);
    if (!path.isAbsolute(linkTarget)) continue;
    const resolvedTarget = path.resolve(linkTarget);
    if (
      resolvedTarget !== basePythonPath &&
      !resolvedTarget.startsWith(`${baseRuntimeRoot}${path.sep}`)
    ) {
      continue;
    }
    const targetRelativeToBase = path.relative(baseRuntimeRoot, resolvedTarget);
    const packageBaseRoot = path.dirname(path.dirname(environmentRoot));
    const packagedBaseRoot = path.join(packageBaseRoot, path.basename(baseRuntimeRoot));
    const packagedTarget = path.join(packagedBaseRoot, targetRelativeToBase);
    const relativeTarget = path.relative(path.dirname(linkPath), packagedTarget);
    fs.unlinkSync(linkPath);
    fs.symlinkSync(relativeTarget, linkPath);
  }
}

function isEnvironmentRelocatable(environmentRoot) {
  return walkSymlinks(environmentRoot).every(
    linkPath => !path.isAbsolute(fs.readlinkSync(linkPath)),
  );
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || PROJECT_ROOT,
    env: { ...process.env, ...(options.env || {}) },
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: options.timeout || 20 * 60 * 1000,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = `${result.stderr || result.stdout || ''}`.trim();
    throw new Error(
      `${command} ${args.join(' ')} failed with exit code ${result.status}: ${detail}`,
    );
  }
  return result;
}

function probePython(pythonPath, importNames) {
  const code = [
    'import importlib',
    ...importNames.map(name => `importlib.import_module(${JSON.stringify(name)})`),
    'print("skill-python-health-ok")',
  ].join('\n');
  const result = spawnSync(pythonPath, ['-c', code], {
    cwd: PROJECT_ROOT,
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: 60_000,
    windowsHide: true,
  });
  return {
    ok: result.status === 0,
    detail: `${result.stderr || result.stdout || ''}`.trim(),
  };
}

function readManifest(environmentRoot) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(environmentRoot, 'runtime.json'), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function getPythonVersion(pythonPath) {
  const result = run(pythonPath, ['--version'], { timeout: 60_000 });
  return `${result.stdout || result.stderr || ''}`.trim();
}

function getUvVersion(uvPath) {
  const result = run(uvPath, ['--version'], { timeout: 60_000 });
  return `${result.stdout || result.stderr || ''}`.trim();
}

function expectedManifest(entry, platform, arch, pythonVersion, uvVersion) {
  return {
    version: MANIFEST_VERSION,
    skillId: entry.skillId,
    platform,
    arch,
    requirementsSha256: sha256File(entry.requirementsPath),
    layerIds: [SHARED_ENVIRONMENT_NAME],
    pythonVersion,
    uvVersion,
  };
}

function sharedEnvironmentRoot(runtimeRoot) {
  return path.join(runtimeRoot, LAYERS_DIRECTORY_NAME, SHARED_ENVIRONMENT_NAME);
}

function skillManifestRoot(runtimeRoot, skillId) {
  return path.join(runtimeRoot, SKILLS_DIRECTORY_NAME, skillId);
}

function requirementHashes(requirements) {
  return Object.fromEntries(
    requirements.map(entry => [entry.skillId, sha256File(entry.requirementsPath)]),
  );
}

function expectedSharedManifest(requirements, platform, arch, pythonVersion, uvVersion) {
  return {
    version: MANIFEST_VERSION,
    kind: 'shared-layer',
    platform,
    arch,
    requirementsSha256: requirementHashes(requirements),
    pythonVersion,
    uvVersion,
  };
}

function manifestMatches(manifest, expected) {
  return Boolean(
    manifest &&
    manifest.version === expected.version &&
    manifest.skillId === expected.skillId &&
    manifest.platform === expected.platform &&
    manifest.arch === expected.arch &&
    JSON.stringify(manifest.requirementsSha256) === JSON.stringify(expected.requirementsSha256) &&
    JSON.stringify(manifest.layerIds) === JSON.stringify(expected.layerIds) &&
    manifest.pythonVersion === expected.pythonVersion &&
    manifest.uvVersion === expected.uvVersion,
  );
}

function checkSkillPythonRuntimeHealth(options = {}) {
  const platform = normalizePlatform(options.platform);
  const arch = options.arch || process.arch;
  const requirements = listRequirementFiles(options.skillsRoot || SKILLS_ROOT);
  const environments = [];
  const declarations = validateSkillDependencyDeclarations(options.skillsRoot || SKILLS_ROOT);
  const missing = [...declarations.missing];

  const runtimeRoot = options.runtimeRoot || RUNTIME_ROOT;
  const sharedRoot = sharedEnvironmentRoot(runtimeRoot);
  const lockPaths = requirements.map(entry =>
    path.join(runtimeRoot, LOCKS_DIRECTORY_NAME, `${entry.skillId}.txt`),
  );
  const pythonPath = pythonExecutableForEnvironment(sharedRoot, platform);
  const sharedManifest = readManifest(sharedRoot);
  if (!pythonPath) missing.push('shared: python executable');
  if (!sharedManifest || sharedManifest.version !== MANIFEST_VERSION || sharedManifest.kind !== 'shared-layer') {
    missing.push('shared: matching runtime.json');
  }
  if (!isEnvironmentRelocatable(sharedRoot)) missing.push('shared: relocatable symlinks');

  for (const entry of requirements) {
    const environmentRoot = skillManifestRoot(runtimeRoot, entry.skillId);
    const importNames = parseImportNames(entry.requirementsPath);
    const manifest = readManifest(environmentRoot);
    const requirementsSha256 = sha256File(entry.requirementsPath);
    const entryMissing = [];
    if (
      !manifest ||
      manifest.version !== MANIFEST_VERSION ||
      manifest.skillId !== entry.skillId ||
      manifest.platform !== platform ||
      manifest.arch !== arch ||
      manifest.requirementsSha256 !== requirementsSha256
    ) {
      entryMissing.push('matching runtime.json');
    }
    if (pythonPath) {
      const probe = probePython(pythonPath, importNames);
      if (!probe.ok) entryMissing.push(`imports (${probe.detail || 'probe failed'})`);
    }
    if (entryMissing.length > 0) {
      missing.push(`${entry.skillId}: ${entryMissing.join(', ')}`);
    }
    environments.push({
      skillId: entry.skillId,
      environmentRoot,
      pythonPath,
      missing: entryMissing,
    });
  }

  return { ok: missing.length === 0, missing, environments };
}

async function resolveBaseRuntime(platform, arch) {
  if (platform === 'win32') {
    const [
      { ensurePortableUvRuntime, findPortableUvExecutables },
      { ensurePortablePythonRuntime, findPortablePythonExecutable },
    ] = await Promise.all([
      Promise.resolve(require('./setup-uv-runtime.js')),
      Promise.resolve(require('./setup-python-runtime.js')),
    ]);
    await ensurePortableUvRuntime({ required: true });
    await ensurePortablePythonRuntime({ required: true });
    return {
      uvPath: findPortableUvExecutables().uv,
      pythonPath: findPortablePythonExecutable(),
    };
  }

  const { ensurePosixUvRuntime } = require('./setup-mac-uv-runtime.js');
  const { ensurePosixPythonRuntime } = require('./setup-mac-python-runtime.js');
  const uv = await ensurePosixUvRuntime({ required: true, platform, arch });
  const python = await ensurePosixPythonRuntime({ required: true, platform, arch });
  return { uvPath: uv.uvPath, pythonPath: python.pythonPath };
}

async function ensureSkillPythonRuntimes(options = {}) {
  const platform = normalizePlatform(options.platform);
  const arch = options.arch || process.arch;
  const skillsRoot = options.skillsRoot || SKILLS_ROOT;
  const runtimeRoot = options.runtimeRoot || RUNTIME_ROOT;
  const requirements = listRequirementFiles(skillsRoot);
  const declarations = validateSkillDependencyDeclarations(skillsRoot);
  if (!declarations.ok) {
    throw new Error(`Skill dependency declarations are incomplete: ${declarations.missing.join('; ')}`);
  }
  if (requirements.length === 0) {
    return { ok: true, skipped: true, environments: [] };
  }

  const base = await resolveBaseRuntime(platform, arch);
  if (!base.uvPath || !base.pythonPath) {
    throw new Error('Bundled uv and Python are required before building Skill Python runtimes.');
  }

  const pythonVersion = getPythonVersion(base.pythonPath);
  const uvVersion = getUvVersion(base.uvPath);
  const sharedRoot = sharedEnvironmentRoot(runtimeRoot);
  const sharedExpected = expectedSharedManifest(requirements, platform, arch, pythonVersion, uvVersion);
  const existingPython = pythonExecutableForEnvironment(sharedRoot, platform);
  const healthyExistingLayer =
    existingPython &&
    isEnvironmentRelocatable(sharedRoot) &&
    manifestMatches(readManifest(sharedRoot), sharedExpected) &&
    lockPaths.every(lockPath => fs.existsSync(lockPath)) &&
    requirements.every(entry => probePython(existingPython, parseImportNames(entry.requirementsPath)).ok);

  if (!healthyExistingLayer) {
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
    fs.mkdirSync(runtimeRoot, { recursive: true });
    fs.mkdirSync(path.join(runtimeRoot, LOCKS_DIRECTORY_NAME), { recursive: true });
    console.log('[setup-skill-python-runtime] creating shared relocatable dependency layer');
    for (const [index, entry] of requirements.entries()) {
      run(
        base.uvPath,
        [
          'pip',
          'compile',
          '--generate-hashes',
          '--output-file',
          lockPaths[index],
          entry.requirementsPath,
        ],
        { env: { UV_NO_PROGRESS: '1', UV_PYTHON: base.pythonPath } },
      );
    }
    run(
      base.uvPath,
      [
        'venv',
        '--no-project',
        '--relocatable',
        '--link-mode',
        'copy',
        '--no-managed-python',
        '--no-python-downloads',
        '--python',
        base.pythonPath,
        sharedRoot,
      ],
      { env: { UV_NO_PROGRESS: '1', UV_PYTHON: base.pythonPath } },
    );
    const environmentPython = pythonExecutableForEnvironment(sharedRoot, platform);
    if (!environmentPython)
      throw new Error('shared layer: uv did not create a Python executable.');
    rebaseEnvironmentSymlinks(sharedRoot, base.pythonPath);
    const installArgs = [
      'pip',
      'install',
      '--python',
      environmentPython,
      ...lockPaths.flatMap(lockPath => ['--requirement', lockPath]),
      '--link-mode',
      'copy',
      '--no-managed-python',
      '--no-python-downloads',
    ];
    run(base.uvPath, installArgs, { env: { UV_NO_PROGRESS: '1', UV_PYTHON: base.pythonPath } });
    rebaseEnvironmentSymlinks(sharedRoot, base.pythonPath);
    for (const entry of requirements) {
      const probe = probePython(environmentPython, parseImportNames(entry.requirementsPath));
      if (!probe.ok)
        throw new Error(`${entry.skillId}: dependency health check failed: ${probe.detail}`);
    }
    fs.writeFileSync(
      path.join(sharedRoot, 'runtime.json'),
      `${JSON.stringify(sharedExpected, null, 2)}\n`,
      'utf8',
    );
  }

  for (const entry of requirements) {
    const environmentRoot = skillManifestRoot(runtimeRoot, entry.skillId);
    const expected = expectedManifest(entry, platform, arch, pythonVersion, uvVersion);
    fs.mkdirSync(environmentRoot, { recursive: true });
    fs.writeFileSync(path.join(environmentRoot, 'runtime.json'), `${JSON.stringify(expected, null, 2)}\n`, 'utf8');
    console.log(`[setup-skill-python-runtime] ${entry.skillId}: linked to shared layer`);
  }

  const health = checkSkillPythonRuntimeHealth({ platform, arch, skillsRoot, runtimeRoot });
  if (!health.ok)
    throw new Error(`Skill Python runtime health check failed: ${health.missing.join('; ')}`);
  return { ok: true, skipped: false, environments: health.environments };
}

async function main() {
  const platformIndex = process.argv.indexOf('--platform');
  const archIndex = process.argv.indexOf('--arch');
  await ensureSkillPythonRuntimes({
    platform: platformIndex >= 0 ? process.argv[platformIndex + 1] : process.platform,
    arch: archIndex >= 0 ? process.argv[archIndex + 1] : process.arch,
  });
}

if (require.main === module) {
  main().catch(error => {
    console.error(
      '[setup-skill-python-runtime] ERROR:',
      error instanceof Error ? error.message : String(error),
    );
    process.exit(1);
  });
}

module.exports = {
  RUNTIME_ROOT,
  checkSkillPythonRuntimeHealth,
  listRequirementFiles,
  normalizePlatform,
  parseImportNames,
  pythonExecutableForEnvironment,
  validateSkillDependencyDeclarations,
  ensureSkillPythonRuntimes,
};
