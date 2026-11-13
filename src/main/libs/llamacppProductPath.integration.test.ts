/**
 * Opt-in CPU product-path integration: spawn via buildLlamaServerArgs, probe via LlamaCppClient
 * (health, /models, /v1/chat/completions with stream + cancel). Requires a vendored or installed
 * llama-server and optionally LLAMACPP_PRODUCT_PATH_MODEL for a tiny GGUF fixture.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { buildLlamaCppServeEnv, buildLlamaServerArgs } from './llamacppServe';
import { buildLlamaCppExecutableCandidates } from './llamacppManager';
import { LlamaCppClient } from './llamacppClient';

const ENABLED = process.env.LLAMACPP_PRODUCT_PATH_INTEGRATION === '1';

function resolveExecutable(): string | null {
  const candidates = buildLlamaCppExecutableCandidates({
    platform: process.platform,
    isPackaged: false,
    resourceRoot: path.join(process.cwd(), 'resources'),
    appRoot: process.cwd(),
    cwd: process.cwd(),
    userRuntimeRoot: path.join(os.homedir(), 'llamacpp-runtime'),
    envPath: process.env.LLAMACPP_PRODUCT_PATH_EXECUTABLE,
  });
  return candidates.find(candidate => fs.existsSync(candidate)) ?? null;
}

const run = ENABLED ? describe : describe.skip;

run('llama.cpp product path (CPU integration)', () => {
  let proc: ChildProcessWithoutNullStreams | null = null;
  let workDir = '';
  let modelsDir = '';
  let presetPath = '';
  let port = '18089';
  let baseUrl = '';

  beforeAll(async () => {
    const executable = resolveExecutable();
    if (!executable) {
      throw new Error('llama-server executable not found; set LLAMACPP_PRODUCT_PATH_EXECUTABLE');
    }
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llamacpp-product-path-'));
    modelsDir = path.join(workDir, 'models');
    presetPath = path.join(workDir, 'models-preset.ini');
    fs.mkdirSync(modelsDir, { recursive: true });
    fs.writeFileSync(presetPath, 'version = 1\n\n', 'utf8');

    const modelPath = process.env.LLAMACPP_PRODUCT_PATH_MODEL?.trim();
    if (modelPath && fs.existsSync(modelPath)) {
      const modelName = path.basename(modelPath, path.extname(modelPath));
      fs.copyFileSync(modelPath, path.join(modelsDir, path.basename(modelPath)));
      fs.writeFileSync(
        presetPath,
        `version = 1\n\n[${modelName}]\nmodel = ${path.join(modelsDir, path.basename(modelPath))}\n`,
        'utf8',
      );
    }

    const args = buildLlamaServerArgs({ port, modelsMax: '1' }, modelsDir, presetPath);
    proc = spawn(executable, args, {
      env: buildLlamaCppServeEnv(process.env, executable, process.platform),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    baseUrl = `http://127.0.0.1:${port}`;
    const client = new LlamaCppClient(baseUrl, { loadTimeoutMs: 120_000 });
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      try {
        await client.health(1_000);
        return;
      } catch {
        await new Promise(resolve => setTimeout(resolve, 250));
      }
    }
    throw new Error('llama-server failed to become healthy');
  }, 120_000);

  afterAll(async () => {
    if (proc && !proc.killed) {
      proc.kill('SIGTERM');
      await new Promise<void>(resolve => {
        proc?.once('exit', () => resolve());
        setTimeout(() => {
          if (proc && !proc.killed) proc.kill('SIGKILL');
          resolve();
        }, 5_000);
      });
    }
    if (workDir) fs.rmSync(workDir, { recursive: true, force: true });
  });

  test('lists models and completes a streaming request when a fixture model is configured', async () => {
    const client = new LlamaCppClient(baseUrl, { loadTimeoutMs: 120_000 });
    const models = await client.listModels();
    expect(Array.isArray(models)).toBe(true);

    const modelPath = process.env.LLAMACPP_PRODUCT_PATH_MODEL?.trim();
    if (!modelPath || !fs.existsSync(modelPath)) {
      return;
    }
    const modelName = path.basename(modelPath, path.extname(modelPath));
    await client.loadModel({ model: modelName });

    const controller = new AbortController();
    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelName,
        stream: true,
        max_tokens: 8,
        messages: [{ role: 'user', content: 'Reply with OK.' }],
      }),
      signal: controller.signal,
    });
    expect(response.ok).toBe(true);
    controller.abort();
    await client.unloadModel(modelName);
  }, 180_000);
});
