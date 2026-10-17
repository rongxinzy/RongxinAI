import fs from 'fs';
import path from 'path';

import { app } from 'electron';

import {
  InferenceEdition,
  isBundledRuntimeEdition,
  isCudaInferenceEditionSupported,
  isLocalInferenceEnabledForEdition,
  normalizeInferenceEdition,
} from '../../shared/inferenceEdition';

export function readPackagedInferenceEdition(): InferenceEdition {
  if (!app.isPackaged) {
    return normalizeInferenceEdition(process.env.ZHIYUAN_UPDATE_VARIANT);
  }
  try {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(app.getAppPath(), 'package.json'), 'utf8'),
    ) as { zhiyuanUpdateVariant?: unknown };
    return normalizeInferenceEdition(
      typeof packageJson.zhiyuanUpdateVariant === 'string'
        ? packageJson.zhiyuanUpdateVariant
        : undefined,
    );
  } catch {
    return InferenceEdition.Lite;
  }
}

export function resolveEffectiveInferenceEdition(): InferenceEdition {
  const edition = readPackagedInferenceEdition();
  if (!isCudaInferenceEditionSupported(edition, process.platform, process.arch)) {
    return edition === InferenceEdition.Cuda ? InferenceEdition.Cpu : edition;
  }
  return edition;
}

export function isLocalInferenceFeatureEnabled(): boolean {
  return isLocalInferenceEnabledForEdition(resolveEffectiveInferenceEdition());
}

export function usesBundledLlamaCppRuntime(): boolean {
  if (!app.isPackaged) {
    return process.env.ZHIYUAN_USE_BUNDLED_LLAMACPP === '1';
  }
  return isBundledRuntimeEdition(resolveEffectiveInferenceEdition());
}

export function allowEndUserLlamaCppRuntimeDownload(): boolean {
  if (process.env.LLAMACPP_ALLOW_RUNTIME_DOWNLOAD === '1') return true;
  if (!app.isPackaged) return true;
  return !usesBundledLlamaCppRuntime();
}
