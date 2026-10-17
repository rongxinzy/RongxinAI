'use strict';

const baseTargets = require('./nsis-offline-components.json');

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

module.exports = {
  LLAMACPP_BUNDLED_TARGET,
  resolveInferenceEdition,
  shouldIncludeLlamaCppBundledComponent,
  resolveNsisOfflineComponentTargets,
};
