'use strict';

const fs = require('node:fs');
const path = require('node:path');

const WHEELHOUSE_ROOT = path.resolve(__dirname, '..', 'resources', 'defense-python');
const DEFENSE_REQUIREMENTS = {
  skillId: 'defense-common',
  requirementsPath: path.join(__dirname, 'python-runtime', 'defense-requirements.in'),
};
const PYPI = 'https://pypi.org/simple';

function defenseWheelhouseInstallArgs(root) {
  return root
    ? ['--offline', '--no-index', '--find-links', path.join(root, 'wheels'), '--require-hashes']
    : [];
}

function isDefenseWheelhouseReady(root, lockPath, target) {
  try {
    if (!fs.readFileSync(path.join(root, 'requirements.txt')).equals(fs.readFileSync(lockPath))) {
      return false;
    }
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'runtime.json'), 'utf8'));
    if (manifest.platform !== target.platform || manifest.arch !== target.arch) return false;
    const actual = fs.readdirSync(path.join(root, 'wheels')).sort();
    return actual.length > 0 && JSON.stringify(actual) === JSON.stringify(manifest.wheels);
  } catch {
    return false;
  }
}

function ensureDefenseWheelhouse(root, lockPath, target, base, run) {
  if (isDefenseWheelhouseReady(root, lockPath, target)) return;
  if (target.platform !== process.platform || target.arch !== process.arch) {
    throw new Error('Build the defense Python wheelhouse on a native target runner.');
  }

  const staged = fs.mkdtempSync(`${root}.preparing-`);
  try {
    const wheels = path.join(staged, 'wheels');
    run(base.uvPath, [
      'run',
      '--no-project',
      '--no-config',
      '--no-python-downloads',
      '--python',
      base.pythonPath,
      '--default-index',
      PYPI,
      '--with',
      'pip==25.3',
      '--',
      'python',
      '-m',
      'pip',
      '--isolated',
      '--disable-pip-version-check',
      'download',
      '--index-url',
      PYPI,
      '--dest',
      wheels,
      '--only-binary',
      ':all:',
      '--no-deps',
      '--require-hashes',
      '--requirement',
      lockPath,
    ]);
    const files = fs.readdirSync(wheels).sort();
    if (!files.length || files.some(file => !file.endsWith('.whl'))) {
      throw new Error('The defense wheelhouse must contain only wheels.');
    }
    fs.copyFileSync(lockPath, path.join(staged, 'requirements.txt'));
    fs.writeFileSync(
      path.join(staged, 'runtime.json'),
      `${JSON.stringify({ ...target, wheels: files })}\n`,
    );
    fs.rmSync(root, { recursive: true, force: true });
    fs.renameSync(staged, root);
  } finally {
    fs.rmSync(staged, { recursive: true, force: true });
  }
}

module.exports = {
  defenseWheelhouseInstallArgs,
  DEFENSE_REQUIREMENTS,
  WHEELHOUSE_ROOT,
  ensureDefenseWheelhouse,
  isDefenseWheelhouseReady,
};
