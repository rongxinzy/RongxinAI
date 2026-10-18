/**
 * Generates browser-preview stream replay IPC fixtures from the production harness.
 * Run: bun run web:preview:stream-replay:codegen
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  installStreamReplayRecordingSuite,
  recordGlmFixtureIpcTrace,
  recordScriptedPiIpcTrace,
  recordSyntheticTextIpcTrace,
  scripted503RetryPiEvents,
  type RecordedStreamReplayTrace,
} from './helpers/recordGlmStreamIpcTrace';

const outDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../src/renderer/browserMock/fixtures/streamReplay',
);

const writeTrace = (name: string, trace: RecordedStreamReplayTrace): void => {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, `${name}.json`), `${JSON.stringify(trace, null, 2)}\n`, 'utf8');
};

describe('stream replay fixture codegen', () => {
  installStreamReplayRecordingSuite();

  it('writes GLM and synthetic replay traces', async () => {
    const traces = [];
    traces.push(await recordGlmFixtureIpcTrace('glm-tool-text.jsonl', 'preview-stream-tool-text'));
    traces.push(
      await recordGlmFixtureIpcTrace('glm-fresh-pr1127.jsonl.gz', 'preview-stream-glm-fresh'),
    );
    traces.push(
      await recordScriptedPiIpcTrace(
        '503-auto-retry',
        'preview-stream-503-retry',
        scripted503RetryPiEvents,
        'Recovered',
      ),
    );
    traces.push(
      await recordSyntheticTextIpcTrace('preview-stream-synthetic-20k', 20_000, 0x20_000),
    );
    for (const trace of traces) {
      expect(trace.events.length).toBeGreaterThan(0);
      expect(trace.expectedFinalText.length).toBeGreaterThan(0);
      const slug = trace.fixture.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
      writeTrace(slug, trace);
    }
  }, 240_000);
});

describe('stream replay fixture codegen check', () => {
  it('matches committed browser replay fixtures', () => {
    if (process.env.STREAM_REPLAY_CODEGEN_CHECK !== '1') return;
    const names = [
      'glm-tool-text-jsonl',
      'glm-fresh-pr1127-jsonl-gz',
      '503-auto-retry',
      'synthetic-20000',
    ];
    for (const name of names) {
      const path = resolve(outDir, `${name}.json`);
      readFileSync(path, 'utf8');
    }
  });
});
