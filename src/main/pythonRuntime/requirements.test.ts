import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';

import { packageName, resolveSkillRequirements, validatePackages } from './requirements';

const roots: string[] = [];
const signal = () => new AbortController().signal;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const skillId = 'fixture';
const defaultLock = `packaging==25.0 \\\n    --hash=sha256:${'a'.repeat(64)}\n`;

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

async function fixture(
  options: {
    requirements?: string;
    manifest?: Record<string, unknown>;
    lock?: string;
  } = {},
) {
  const root = await mkdtemp(path.join(tmpdir(), 'skill-requirements-'));
  roots.push(root);
  const runtimeRoot = path.join(root, 'skill-python');
  const sharedPythonPath = path.join(runtimeRoot, 'layers', 'shared', 'bin', 'python');
  const requirementsPath = path.join(root, 'requirements.txt');
  const manifestPath = path.join(runtimeRoot, 'skills', skillId, 'runtime.json');
  const locksRoot = path.join(runtimeRoot, 'locks');
  const lockPath = path.join(locksRoot, `${skillId}.delta.txt`);
  const requirements =
    options.requirements ?? '# Test dependencies\npackaging >= 24, < 26 # inline note\n';
  const lock = options.lock ?? defaultLock;
  const manifest = {
    version: 3,
    skillId,
    requirementsSha256: hash(requirements),
    coverage: 'core',
    ...options.manifest,
  };
  await Promise.all([
    mkdir(path.dirname(sharedPythonPath), { recursive: true }),
    mkdir(path.dirname(manifestPath), { recursive: true }),
    mkdir(locksRoot, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(sharedPythonPath, ''),
    writeFile(requirementsPath, requirements),
    writeFile(manifestPath, JSON.stringify(manifest)),
    writeFile(lockPath, lock),
  ]);
  return {
    root,
    runtimeRoot,
    sharedPythonPath,
    requirementsPath,
    manifestPath,
    locksRoot,
    lockPath,
    manifest,
    lock,
  };
}

function delta(lock: string, packages = ['packaging']) {
  return { lockFile: `${skillId}.delta.txt`, sha256: hash(lock), packages };
}

test('accepts named packages, extras and common PEP 440 version constraints', () => {
  expect(
    validatePackages([
      'packaging',
      'requests [ socks , security ] >= 2.31 , < 3',
      'numpy==2.3.*',
      'pandas!=2.0.*,>=1.5',
      'urllib3~=2.0',
      'torch==2!1.0rc1.post2.dev3+cpu.1',
      'pytest>7,<=9',
    ]),
  ).toEqual([
    'packaging',
    'requests[socks,security]>=2.31,<3',
    'numpy==2.3.*',
    'pandas!=2.0.*,>=1.5',
    'urllib3~=2.0',
    'torch==2!1.0rc1.post2.dev3+cpu.1',
    'pytest>7,<=9',
  ]);
  expect(packageName('Scikit_Learn [ extras ] >= 1.0')).toBe('scikit-learn');
  expect(packageName('zope.interface!=5.0')).toBe('zope-interface');
});

test.each([
  '--target=/tmp',
  '-r requirements.txt',
  'https://example.com/package.whl',
  'requests @ https://example.com/package.whl',
  'git+https://example.com/repo',
  '/tmp/local',
  './local',
  'C:\\local\\package',
  'requests; python_version>="3.10"',
  'requests\n--index-url=https://example.com',
  'requests\r--target=/tmp',
  'requests\0',
  'requests==1.*;rm -rf /',
  'requests>=1.*',
  'requests==*',
  'requests===1.0',
  'requests~=1',
  'requests>=1.0+local',
  'requests>=one',
  'requests[--target]',
  'requests>=1,',
  'requests --index-url=https://example.com',
])('rejects non-registry or malformed requirement %j', requirement => {
  expect(() => validatePackages([requirement])).toThrow(
    'PyPI package names or version constraints',
  );
});

test('bounds requirement count and length and rejects non-string entries', () => {
  for (const input of [undefined, {}, [5], Array(41).fill('packaging'), ['a'.repeat(201)]]) {
    expect(() => validatePackages(input)).toThrow('PyPI package names or version constraints');
  }
});

test('verifies requirements hashes and strips comments for core Skills', async () => {
  const files = await fixture();
  await expect(
    resolveSkillRequirements(
      files.sharedPythonPath,
      { skillId, requirementsPath: files.requirementsPath },
      signal(),
    ),
  ).resolves.toEqual({
    requirements: ['packaging>=24,<26'],
    requirementsSha256: files.manifest.requirementsSha256,
    skillId,
  });
});

test('accepts a fingerprinted version 2 full-core manifest without a delta install', async () => {
  const files = await fixture({
    requirements: 'scipy>=1.14\n',
    manifest: { version: 2, coverage: undefined },
  });
  const result = await resolveSkillRequirements(
    files.sharedPythonPath,
    { skillId, requirementsPath: files.requirementsPath },
    signal(),
  );
  expect(result.requirements).toEqual(['scipy>=1.14']);
  expect(result.lock).toBeUndefined();
});

test('fails closed when the manifest is missing or the requirements have changed', async () => {
  const files = await fixture();
  await writeFile(files.requirementsPath, 'requests\n');
  await expect(
    resolveSkillRequirements(
      files.sharedPythonPath,
      { skillId, requirementsPath: files.requirementsPath },
      signal(),
    ),
  ).rejects.toThrow('Skill dependency manifest');
  await rm(files.manifestPath);
  await expect(
    resolveSkillRequirements(
      files.sharedPythonPath,
      { skillId, requirementsPath: files.requirementsPath },
      signal(),
    ),
  ).rejects.toThrow('Skill dependency manifest');
});

test.each([
  { skillId: 'another' },
  { version: 4 },
  { coverage: 'other' },
  { coverage: 'overlay', delta: null },
])('rejects incompatible manifest metadata %j', async manifest => {
  const files = await fixture({ manifest });
  await expect(
    resolveSkillRequirements(
      files.sharedPythonPath,
      { skillId, requirementsPath: files.requirementsPath },
      signal(),
    ),
  ).rejects.toThrow('Skill dependency manifest');
});

test('returns the authenticated delta lock bytes without removing hash options', async () => {
  const files = await fixture({ manifest: { coverage: 'overlay', delta: delta(defaultLock) } });
  const result = await resolveSkillRequirements(
    files.sharedPythonPath,
    { skillId, requirementsPath: files.requirementsPath },
    signal(),
  );
  expect(result.lock).toEqual({ content: defaultLock, sha256: hash(defaultLock) });
  expect(result.requirements).toEqual(['packaging>=24,<26']);
  expect(result.lockedRequirements).toEqual(['packaging==25.0']);
});

test('extracts exact pins from uv multiline hash locks and preserves platform markers and quoted comments', async () => {
  const lock = [
    '# This file was autogenerated by uv.',
    'packaging==25.0 \\',
    `    --hash=sha256:${'a'.repeat(64)} \\`,
    `    --hash=sha256:${'b'.repeat(64)}`,
    '    # via fixture',
    'colorama==0.4.6 ; sys_platform == "win32" \\',
    `    --hash=sha256:${'c'.repeat(64)} # artifact hash`,
    'numpy==2.3.4 ; python_version >= "3.14" and (sys_platform != "win32" or platform_machine == "AMD64")',
    'example[feature]==1!2.0rc1+local ; platform_version == "value#with;punctuation" # comment',
    '',
  ].join('\n');
  const files = await fixture({ lock, manifest: { coverage: 'overlay', delta: delta(lock) } });
  const result = await resolveSkillRequirements(
    files.sharedPythonPath,
    { skillId, requirementsPath: files.requirementsPath },
    signal(),
  );
  expect(result.lock).toEqual({ content: lock, sha256: hash(lock) });
  expect(result.lockedRequirements).toEqual([
    'packaging==25.0',
    'colorama==0.4.6; sys_platform == "win32"',
    'numpy==2.3.4; python_version >= "3.14" and (sys_platform != "win32" or platform_machine == "AMD64")',
    'example[feature]==1!2.0rc1+local; platform_version == "value#with;punctuation"',
  ]);
});

test.each([
  'packaging',
  'packaging>=25.0',
  'packaging!=24,==25.0',
  'packaging==25.*',
  'packaging @ https://example.com/package.whl',
  'https://example.com/package.whl',
  'git+https://example.com/package.git',
  '/tmp/package.whl',
  './local-package',
  '-e /tmp/local-package',
  '--extra-index-url https://example.com',
  'packaging==25.0 --target /tmp/packages',
  'packaging==25.0; sys_platform == "win32" --index-url https://example.com',
  'packaging==25.0; sys_platform == "win32" @ https://example.com/package.whl',
  'packaging==25.0; unsupported_marker == "value"',
  'packaging==25.0; python_version >= "3.10" and',
  'packaging==25.0; (python_version >= "3.10"',
  'packaging==25.0; sys_platform == "win32" garbage',
  'packaging==25.0 --hash=sha256:short',
  'packaging==25.0 \\',
])('rejects unpinned, external or executable delta lock requirement %j', async requirement => {
  const lock = `${requirement}\n`;
  const files = await fixture({ lock, manifest: { coverage: 'overlay', delta: delta(lock) } });
  await expect(
    resolveSkillRequirements(
      files.sharedPythonPath,
      { skillId, requirementsPath: files.requirementsPath },
      signal(),
    ),
  ).rejects.toThrow('Skill dependency manifest');
});

test('rejects changed delta lock bytes even when the requirements hash matches', async () => {
  const files = await fixture({ manifest: { coverage: 'overlay', delta: delta(defaultLock) } });
  await writeFile(files.lockPath, `${defaultLock}# modified\n`);
  await expect(
    resolveSkillRequirements(
      files.sharedPythonPath,
      { skillId, requirementsPath: files.requirementsPath },
      signal(),
    ),
  ).rejects.toThrow('Skill dependency manifest delta lock hash does not match');
});

test.each(['../outside.txt', '/tmp/outside.txt', 'nested/lock.txt', '..\\outside.txt'])(
  'rejects delta lock path %j',
  async lockFile => {
    const files = await fixture({
      manifest: { coverage: 'overlay', delta: { ...delta(defaultLock), lockFile } },
    });
    await expect(
      resolveSkillRequirements(
        files.sharedPythonPath,
        { skillId, requirementsPath: files.requirementsPath },
        signal(),
      ),
    ).rejects.toThrow('Skill dependency manifest');
  },
);

test('rejects a delta lock symlink escaping the locks directory', async () => {
  if (process.platform === 'win32') return;
  const files = await fixture({ manifest: { coverage: 'overlay', delta: delta(defaultLock) } });
  const outside = path.join(files.root, 'outside.txt');
  await writeFile(outside, defaultLock);
  await rm(files.lockPath);
  await symlink(outside, files.lockPath);
  await expect(
    resolveSkillRequirements(
      files.sharedPythonPath,
      { skillId, requirementsPath: files.requirementsPath },
      signal(),
    ),
  ).rejects.toThrow('Skill dependency manifest delta lock must remain');
});

test('returns large-download confirmation metadata without blocking an already installed Skill', async () => {
  const lock = `scikit-learn==1.8.0 --hash=sha256:${'b'.repeat(64)}\n`;
  const files = await fixture({
    lock,
    manifest: { coverage: 'overlay', delta: delta(lock, ['scikit_learn']) },
  });
  const skill = { skillId, requirementsPath: files.requirementsPath };
  await expect(
    resolveSkillRequirements(files.sharedPythonPath, skill, signal()),
  ).resolves.toMatchObject({
    confirmationPackages: ['scikit-learn'],
    lock: { content: lock },
  });
  await expect(
    resolveSkillRequirements(
      files.sharedPythonPath,
      { ...skill, confirmDependencyInstall: true },
      signal(),
    ),
  ).resolves.toMatchObject({ confirmationPackages: ['scikit-learn'], lock: { content: lock } });
});

test('derives confirmation metadata from authenticated lock contents even if package metadata is incomplete', async () => {
  const lock = `  scipy==1.18.0 --hash=sha256:${'c'.repeat(64)}\n`;
  const files = await fixture({ lock, manifest: { coverage: 'overlay', delta: delta(lock, []) } });
  await expect(
    resolveSkillRequirements(
      files.sharedPythonPath,
      { skillId, requirementsPath: files.requirementsPath },
      signal(),
    ),
  ).resolves.toMatchObject({ confirmationPackages: ['scipy'] });
});

test('bounds file reads and honors cancellation before reading', async () => {
  const files = await fixture();
  await writeFile(files.requirementsPath, 'a'.repeat(64 * 1024 + 1));
  const skill = { skillId, requirementsPath: files.requirementsPath };
  await expect(resolveSkillRequirements(files.sharedPythonPath, skill, signal())).rejects.toThrow(
    'size limit',
  );
  const controller = new AbortController();
  controller.abort();
  await expect(
    resolveSkillRequirements(files.sharedPythonPath, skill, controller.signal),
  ).rejects.toThrow('aborted');
});

test('does not accept executable requirements directives from a matching manifest', async () => {
  const files = await fixture({ requirements: '--extra-index-url https://example.com\n' });
  await expect(
    resolveSkillRequirements(
      files.sharedPythonPath,
      { skillId, requirementsPath: files.requirementsPath },
      signal(),
    ),
  ).rejects.toThrow('Skill dependency manifest');
});
