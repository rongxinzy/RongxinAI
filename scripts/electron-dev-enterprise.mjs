import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  renderEnterpriseConfig,
  writeEnterpriseConfig,
} from '../enterprise/scripts/render-enterprise-config.mjs';

export function prepareEnterpriseDevelopment(projectRoot, env) {
  const extensionPath = path.join(projectRoot, 'enterprise', 'dist', 'extension.cjs');
  if (!fs.existsSync(extensionPath)) {
    throw new Error('Enterprise extension is missing; run bun run build:enterprise first.');
  }
  const configPath = env.ZHIYUAN_ENTERPRISE_CONFIG_DEV_PATH
    ? path.resolve(projectRoot, env.ZHIYUAN_ENTERPRISE_CONFIG_DEV_PATH)
    : path.join(projectRoot, '.work', 'enterprise-dev', 'config.json');
  if (env.ZHIYUAN_ENTERPRISE_CONFIG_DEV_PATH) {
    if (!fs.existsSync(configPath)) {
      throw new Error('The enterprise development configuration file does not exist.');
    }
  } else {
    writeEnterpriseConfig(
      configPath,
      renderEnterpriseConfig(
        env.ZHIYUAN_AEP_BASE_URL ?? 'http://localhost:8080',
        env.ZHIYUAN_AGENT_CONTROL_BASE_URL || undefined,
      ),
    );
  }
  return {
    ...env,
    ZHIYUAN_ENTERPRISE_EXTENSION_DEV_PATH: extensionPath,
    ZHIYUAN_ENTERPRISE_CONFIG_DEV_PATH: configPath,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const env = prepareEnterpriseDevelopment(projectRoot, process.env);
    console.log("[electron:dev:enterprise] Starting with this worktree's enterprise extension.");
    const result = spawnSync('bun', ['run', 'electron:dev'], {
      cwd: projectRoot,
      env,
      stdio: 'inherit',
    });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  } catch (error) {
    console.error('[electron:dev:enterprise]', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
