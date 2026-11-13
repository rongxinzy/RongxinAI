/**
 * Required CPU product-path smoke (router + gateway + preset + client).
 * CI: `.github/workflows/ci.yml` job `llamacpp-smoke` downloads runtime + fixtures first.
 * Local: `node scripts/llamacpp/download-smoke-fixtures.mjs` then
 * `LLAMACPP_SMOKE_EXECUTABLE=vendor/.../llama-server bunx vitest run src/main/libs/llamacppProductPath.smoke.test.ts`
 */
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import {
  assertGatewayTextSmoke,
  assertVisionCapabilityChain,
  createProductPathSmokeContext,
  destroyProductPathSmokeContext,
  refreshSmokeRouterClient,
  resolveSmokeLlamaServerExecutable,
  type ProductPathSmokeContext,
} from './llamacppProductPathSmokeHarness';
import {
  assertSmokeFixturesPresent,
  readLlamaCppSmokeFixtureManifest,
  resolveSmokeFixturePath,
} from './llamacppSmokeFixtureManifest';

const rootDir = process.cwd();
const manifest = readLlamaCppSmokeFixtureManifest(rootDir);

describe('llama.cpp product path smoke (CPU, real GGUF)', () => {
  let context: ProductPathSmokeContext;
  const textModelId = path.basename(manifest.artifacts.textCpu.fileName, '.gguf');
  const visionModelId = path.basename(manifest.artifacts.visionCpu.fileName, '.gguf');

  beforeAll(async () => {
    if (process.env.LLAMACPP_SMOKE_REQUIRED !== '1') {
      throw new Error(
        'LLAMACPP_SMOKE_REQUIRED=1 is required (CI llamacpp-smoke job). Refusing silent skip.',
      );
    }
    assertSmokeFixturesPresent(manifest, rootDir);
    const executablePath = resolveSmokeLlamaServerExecutable(rootDir);
    context = await createProductPathSmokeContext({
      rootDir,
      executablePath,
      textModelPath: resolveSmokeFixturePath(manifest.artifacts.textCpu, rootDir),
      visionModelPath: resolveSmokeFixturePath(manifest.artifacts.visionCpu, rootDir),
      visionMmprojPath: resolveSmokeFixturePath(manifest.artifacts.visionMmproj, rootDir),
    });
  }, 600_000);

  afterAll(async () => {
    if (context) await destroyProductPathSmokeContext(context);
  }, 120_000);

  test('records pinned fixture provenance', () => {
    expect(manifest.runtimeReleaseTag).toBe('b12359');
    expect(manifest.artifacts.textCpu.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(manifest.artifacts.visionCpu.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(manifest.artifacts.visionMmproj.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(fs.statSync(resolveSmokeFixturePath(manifest.artifacts.textCpu, rootDir)).size).toBe(
      manifest.artifacts.textCpu.sizeBytes,
    );
  });

  test('gateway loads text model, streams non-empty output, survives cancel, and accepts follow-up', async () => {
    await assertGatewayTextSmoke({
      gatewayBaseUrl: context.gatewayBaseUrl,
      modelId: textModelId,
    });
  }, 300_000);

  test('unloads text model and restarts router without deleting fixture files', async () => {
    await context.orchestrator.stopModel(textModelId);
    await context.orchestrator.stopService();
    await context.orchestrator.status();
    await refreshSmokeRouterClient(context);
    expect(context.orchestrator.gatewayBaseUrl()).toBeTruthy();
    await assertGatewayTextSmoke({
      gatewayBaseUrl: context.gatewayBaseUrl,
      modelId: textModelId,
    });
  }, 300_000);

  test('vision: /props → Magpie image input → image chat completion on gateway', async () => {
    await refreshSmokeRouterClient(context);
    const result = await assertVisionCapabilityChain({
      gatewayBaseUrl: context.gatewayBaseUrl,
      routerClient: context.routerClient,
      visionModelId,
    });
    expect(result.propsVision).toBe(true);
    expect(result.magpieHasImageInput).toBe(true);
  }, 600_000);
});
