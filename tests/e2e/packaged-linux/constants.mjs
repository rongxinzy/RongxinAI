/** @typedef {'pass' | 'fail' | 'skip'} E2EStatus */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const E2E_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(E2E_DIR, '../../..');

export const APP_DATA_DIR_NAME = 'ZhiYuanAgent';
export const DB_FILENAME = 'zhiyuan.sqlite';

export const GLM_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4';
export const GLM_MODEL = process.env.ZHIYUAN_E2E_GLM_MODEL?.trim() || 'glm-4.7';

export const E2E_ARTIFACT_DIR =
  process.env.ZHIYUAN_E2E_ARTIFACT_DIR?.trim() ||
  path.join(REPO_ROOT, '.github/pr-assets/packaged-linux-e2e');

export const DEFAULT_LINUX_UNPACKED_DIR = path.join(REPO_ROOT, 'release/linux-unpacked');

export const EXECUTABLE_NAME = '知远';

/** Small public GGUF used for local overflow smoke (override with env if needed). */
export const E2E_LLAMA_MODEL_URL =
  process.env.ZHIYUAN_E2E_LLAMA_GGUF_URL?.trim() ||
  'https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf';

export const E2E_LLAMA_MODEL_FILENAME =
  process.env.ZHIYUAN_E2E_LLAMA_FILENAME?.trim() || 'qwen2.5-0.5b-instruct-q4_k_m.gguf';

export const E2E_LLAMACPP_BIN =
  process.env.ZHIYUAN_E2E_LLAMACPP_BIN?.trim() ||
  path.join(REPO_ROOT, 'vendor/llamacpp-runtime/current/bin/llama-server');
