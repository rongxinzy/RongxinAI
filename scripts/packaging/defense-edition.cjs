'use strict';

const fs = require('node:fs');
const path = require('node:path');
const defenseAppId = 'com.zhiyuanagent.defense';
const defenseProductName = '知远智能体 国防版';
const defenseEdition = 'defense';
const defensePackageName = 'zhiyuan-defense';
const excludedDefenseEntries = {
  dist: ['desktop-pet.html', 'companion.html'],
  'dist-electron': [
    'desktopPetPreload.js',
    'desktopPetWindowsEntry.js',
    'companionWindowPreload.js',
    'llamacppModelDaemonEntry.js',
    'catalogWorker.js',
    'modelCatalogUpdateWorker.js',
    'appUpdateHashWorker.js',
  ],
};
const defenseOnlySkills = ['operations-document-writing', 'command-post-exercise-documents'];
const defenseSkills = [...defenseOnlySkills, 'docx', 'xlsx', 'pdf'];

function defenseStage(root) {
  return path.join(root, 'build-tar', defenseEdition);
}

function isDefensePackage(context) {
  return context?.packager?.config?.appId === defenseAppId;
}

function prepareDefenseSkills(root) {
  const source = path.join(root, 'SKILLs');
  const defenseSource = path.join(root, 'scripts', 'packaging', 'defense-skills');
  const destination = path.join(defenseStage(root), 'SKILLs');
  fs.rmSync(destination, { recursive: true, force: true });
  fs.mkdirSync(destination, { recursive: true });
  for (const skill of defenseSkills) {
    const sourceRoot = defenseOnlySkills.includes(skill) ? defenseSource : source;
    fs.cpSync(path.join(sourceRoot, skill), path.join(destination, skill), {
      recursive: true,
      filter: filename => {
        const basename = path.basename(filename);
        return (
          !fs.lstatSync(filename).isSymbolicLink() &&
          !['.git', '.venv', 'node_modules', '__pycache__', 'bin', 'obj'].includes(basename) &&
          !/^(?:\.env(?:\.|$)|.*\.(?:test|spec)\.)/.test(basename)
        );
      },
    });
  }
  const config = JSON.parse(fs.readFileSync(path.join(source, 'skills.config.json'), 'utf8'));
  config.description = 'Default offline skill configuration for ZhiYuan Agent Defense Edition';
  config.defaults = Object.fromEntries(
    defenseSkills.map(skill => [skill, config.defaults[skill] || { enabled: true }]),
  );
  fs.writeFileSync(
    path.join(destination, 'skills.config.json'),
    `${JSON.stringify(config, null, 2)}\n`,
  );
  return destination;
}

function configureDefenseResources(context, skillsRoot) {
  const projectRoot = context.packager.projectDir;
  const resources = [
    [path.relative(projectRoot, skillsRoot), 'SKILLs'],
    ...(context.electronPlatformName === 'win32'
      ? [
          ['resources/mingit', 'mingit'],
          ['resources/python-win', 'python-win'],
          ['resources/uv-win', 'uv-win'],
        ]
      : [
          ['resources/python-linux', 'python-linux'],
          ['resources/uv-linux', 'uv-linux'],
        ]),
    ['resources/skill-python', 'skill-python'],
    ['resources/defense-python', 'defense-python'],
  ];
  const config = context.packager.config;
  config.extraResources = [
    ...(config.extraResources || []),
    ...resources.map(([from, to]) => ({ from, to })),
  ];
}

function verifyDefenseResources(resourcesRoot, platform = 'win32') {
  const windows = platform === 'win32';
  fs.rmSync(path.join(resourcesRoot, 'app-update.yml'), { force: true });
  for (const name of [
    'channel-runtime',
    'llamacpp-bundled',
    'llamacpp-backends',
    'magpie',
    'model-catalog.sqlite',
    'MCPs',
    'strata-bundled',
    'zhiyuan-enterprise',
  ]) {
    if (fs.existsSync(path.join(resourcesRoot, name))) {
      throw new Error(`Unexpected defense package resource: ${name}`);
    }
  }

  for (const filename of [
    'LICENSE.txt',
    windows ? 'memory/engram.exe' : 'memory/engram',
    'memory/LICENSE',
    ...(windows
      ? [
          'python-runtime/job-runner.exe',
          'python-win/python.exe',
          'skill-python/layers/shared/Scripts/python.exe',
          'uv-win/uv.exe',
          'vc_redist.x64.exe',
        ]
      : ['python-linux/bin/python3', 'skill-python/layers/shared/bin/python3', 'uv-linux/uv']),
    'defense-python/requirements.txt',
    'defense-python/runtime.json',
    windows ? 'SKILLs/docx/runtime/MiniMaxAIDocx.Cli.exe' : 'SKILLs/docx/runtime/MiniMaxAIDocx.Cli',
    ...defenseSkills.map(skill => `SKILLs/${skill}/SKILL.md`),
  ]) {
    const stats = fs.statSync(path.join(resourcesRoot, filename), { throwIfNoEntry: false });
    if (!stats?.isFile() || !stats.size) {
      throw new Error(`Required defense package resource is missing or empty: ${filename}`);
    }
  }
  const bashCandidates = ['mingit/bin/bash.exe', 'mingit/usr/bin/bash.exe'];
  if (
    windows &&
    !bashCandidates.some(filename => {
      const stats = fs.statSync(path.join(resourcesRoot, filename), { throwIfNoEntry: false });
      return stats?.isFile() && stats.size > 0;
    })
  ) {
    throw new Error('Required defense package resource is missing: PortableGit Bash.');
  }
  for (const directory of windows ? ['mingit/dev/shm', 'mingit/dev/mqueue'] : []) {
    const stats = fs.statSync(path.join(resourcesRoot, directory), { throwIfNoEntry: false });
    if (!stats?.isDirectory()) {
      throw new Error(`Required defense package directory is missing: ${directory}`);
    }
  }
  const wheelsRoot = path.join(resourcesRoot, 'defense-python', 'wheels');
  const wheels = fs.readdirSync(wheelsRoot, { withFileTypes: true });
  const wheelManifest = JSON.parse(
    fs.readFileSync(path.join(resourcesRoot, 'defense-python', 'runtime.json'), 'utf8'),
  );
  if (
    wheelManifest.platform !== platform ||
    wheelManifest.arch !== 'x64' ||
    !wheels.length ||
    wheels.some(file => !file.isFile() || !file.name.endsWith('.whl')) ||
    JSON.stringify(wheels.map(file => file.name).sort()) !== JSON.stringify(wheelManifest.wheels)
  ) {
    throw new Error('Defense package offline Python wheelhouse does not match its manifest.');
  }

  const skillsRoot = path.join(resourcesRoot, 'SKILLs');
  const config = JSON.parse(fs.readFileSync(path.join(skillsRoot, 'skills.config.json'), 'utf8'));
  const directories = fs
    .readdirSync(skillsRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name);
  const expectedSkills = [...defenseSkills].sort().join(',');
  if (
    directories.sort().join(',') !== expectedSkills ||
    Object.keys(config.defaults).sort().join(',') !== expectedSkills
  ) {
    throw new Error('Defense package Skills do not match the offline allowlist.');
  }
}

function verifyDefenseAsar(resourcesRoot) {
  const { extractFile, listPackage, uncache } = require('@electron/asar');
  const archive = path.join(resourcesRoot, 'app.asar');
  uncache(archive);
  const { name, productName } = JSON.parse(extractFile(archive, 'package.json').toString('utf8'));
  if (name !== defensePackageName || productName !== defenseProductName) {
    throw new Error('Packaged defense Electron metadata does not identify the defense edition.');
  }
  const entries = new Set(listPackage(archive).map(entry => entry.replaceAll('\\', '/')));
  for (const filename of [
    'dist-electron/python-runtime-runner.js',
    'dist-electron/requestWorker.js',
  ]) {
    if (!entries.has(`/${filename}`)) {
      throw new Error(`Required defense package entry is missing: ${filename}`);
    }
  }
  for (const [directory, filenames] of Object.entries(excludedDefenseEntries)) {
    for (const filename of filenames) {
      if (entries.has(`/${directory}/${filename}`)) {
        throw new Error(`Unexpected defense package entry: ${directory}/${filename}`);
      }
    }
  }
}

module.exports = {
  defenseAppId,
  defenseProductName,
  defenseEdition,
  defensePackageName,
  defenseSkills,
  excludedDefenseEntries,
  isDefensePackage,
  prepareDefenseSkills,
  configureDefenseResources,
  verifyDefenseResources,
  verifyDefenseAsar,
};
