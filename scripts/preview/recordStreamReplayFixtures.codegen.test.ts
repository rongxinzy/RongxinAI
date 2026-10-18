/**
 * Stream replay fixture recorder (vitest harness). Not part of `bun run test`.
 * Run via: bun run web:preview:stream-replay:codegen
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import '../../src/main/libs/agentEngine/piRuntimeAdapter.testHarness';
import { setupPiRuntimeAdapterSuite } from '../../src/main/libs/agentEngine/piRuntimeAdapter.testHarness';
import {
  recordGlmFixtureIpcTrace,
  recordScriptedPiIpcTrace,
  recordSyntheticTextIpcTrace,
  scripted503RetryPiEvents,
} from '../../tests/helpers/recordGlmStreamIpcTrace';
import { writeStreamReplayFixture } from './streamReplayFixtureLib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const outDir = resolve(root, 'src/renderer/browserMock/fixtures/streamReplay');

describe('stream replay fixture codegen', () => {
  setupPiRuntimeAdapterSuite();

  it('writes deterministic browser replay fixtures', async () => {
    writeStreamReplayFixture(
      outDir,
      'glm-tool-text-jsonl',
      await recordGlmFixtureIpcTrace('glm-tool-text.jsonl', 'preview-stream-tool-text'),
    );
    writeStreamReplayFixture(
      outDir,
      'glm-fresh-pr1127-jsonl-gz',
      await recordGlmFixtureIpcTrace('glm-fresh-pr1127.jsonl.gz', 'preview-stream-glm-fresh'),
    );
    writeStreamReplayFixture(
      outDir,
      '503-auto-retry',
      await recordScriptedPiIpcTrace(
        '503-auto-retry',
        'preview-stream-503-retry',
        scripted503RetryPiEvents,
        'Recovered',
      ),
    );
    writeStreamReplayFixture(
      outDir,
      'synthetic-20000',
      await recordSyntheticTextIpcTrace('preview-stream-synthetic-20k', 20_000, 0x20_000),
    );
    expect(true).toBe(true);
    // Fingerprint is written by scripts/preview/generate-stream-replay.ts after this file runs.
  }, 240_000);
});
