'use strict';

const baseTargets = require('./nsis-offline-components.json');
const fs = require('node:fs');
const path = require('node:path');

const LLAMACPP_BUNDLED_TARGET = {
  key: 'llamacpp-bundled',
  prefix: 'llamacpp-bundled',
  sentinel: 'llamacpp-bundled/manifest.json',
};

function resolveInferenceEdition() {
  return (process.env.ZHIYUAN_UPDATE_VARIANT || 'lite').trim().toLowerCase();
}

function shouldIncludeLlamaCppBundledComponent(edition = resolveInferenceEdition()) {
  return edition === 'cpu' || edition === 'cuda';
}

function resolveNsisOfflineComponentTargets(edition = resolveInferenceEdition()) {
  if (!shouldIncludeLlamaCppBundledComponent(edition)) {
    return baseTargets;
  }
  return [...baseTargets, LLAMACPP_BUNDLED_TARGET];
}

// Generate both the routing table and every NSIS phase from the same edition
// contract. A stale optional archive must never make a lite installer include it.
function writeNsisOfflineComponentRouting(
  directory,
  manifests,
  edition = resolveInferenceEdition(),
) {
  const targets = resolveNsisOfflineComponentTargets(edition);
  if (
    manifests.length !== targets.length ||
    targets.some(
      target =>
        manifests.filter(entry => entry.key === target.key && entry.prefix === target.prefix)
          .length !== 1,
    )
  )
    throw new Error('NSIS component manifest does not match the selected edition');
  fs.writeFileSync(
    path.join(directory, 'nsis-targets.json'),
    `${JSON.stringify(targets, null, 2)}\n`,
  );
  const labels = {
    'channel-runtime': '频道运行环境',
    skills: '内置 Skills',
    mcps: '内置 MCPs',
    'portable-git': 'PortableGit',
    python: 'Python 离线运行环境',
    'skill-python': 'Skill Python dependency layer',
    uv: 'uv 离线运行环境',
    'llamacpp-bundled': '本地推理运行环境',
  };
  const phases = [
    [
      'StageEditionComponents',
      target => `!insertmacro StageOfflineComponentMetadata "${target.key}"`,
    ],
    [
      'QueueEditionComponents',
      target =>
        `!insertmacro QueueOfflineComponent ${target.key.toUpperCase().replaceAll('-', '_')} "${target.key}" "${labels[target.key]}"`,
    ],
    [
      'RecordEditionComponents',
      target => `!insertmacro RecordOfflineComponentReady "${target.key}"`,
    ],
  ];
  const source = phases
    .map(([name, render]) =>
      [`!macro ${name}`, ...targets.map(target => `  ${render(target)}`), '!macroend'].join('\n'),
    )
    .join('\n\n');
  fs.writeFileSync(path.join(directory, 'nsis-components.nsh'), `${source}\n`);
}

module.exports = {
  LLAMACPP_BUNDLED_TARGET,
  resolveInferenceEdition,
  shouldIncludeLlamaCppBundledComponent,
  resolveNsisOfflineComponentTargets,
  writeNsisOfflineComponentRouting,
};
