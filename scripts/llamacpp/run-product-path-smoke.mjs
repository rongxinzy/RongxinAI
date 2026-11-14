#!/usr/bin/env node
/**
 * Reproducible local/CI entry for llama.cpp product-path smoke.
 *
 * Example:
 *   node scripts/download-llamacpp-runtime.cjs linux-x64
 *   node scripts/llamacpp/download-smoke-fixtures.mjs
 *   node scripts/llamacpp/run-product-path-smoke.mjs
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ensureLlamaCppSmokeFixtures } from './download-smoke-fixtures.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

async function main() {
  const fixtures = await ensureLlamaCppSmokeFixtures();
  const executable =
    process.env.LLAMACPP_SMOKE_EXECUTABLE?.trim() ||
    path.join(ROOT, 'vendor/llamacpp-runtime/linux-x64/bin/llama-server');
  if (!fs.existsSync(executable)) {
    throw new Error(
      `llama-server missing at ${executable}; run: node scripts/download-llamacpp-runtime.cjs linux-x64`,
    );
  }

  const version = spawnSync(executable, ['--version'], { encoding: 'utf8' });
  if (version.status !== 0) {
    throw new Error(`llama-server --version failed: ${version.stderr || version.stdout}`);
  }

  console.log('[llamacpp-smoke] runtime:', version.stdout.trim());
  console.log('[llamacpp-smoke] fixtures:', fixtures.summaryPath);

  const vitest = spawnSync(
    'bunx',
    [
      'vitest',
      'run',
      'src/main/libs/llamacppProductPath.smoke.test.ts',
      '--config',
      'vitest.config.ts',
    ],
    {
      cwd: ROOT,
      stdio: 'inherit',
      env: {
        ...process.env,
        LLAMACPP_SMOKE_REQUIRED: '1',
        LLAMACPP_SMOKE_EXECUTABLE: executable,
        LLAMACPP_SMOKE_FIXTURES_DIR: fixtures.cacheDir,
      },
    },
  );
  process.exit(vitest.status ?? 1);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
