/**
 * Parity tests for the SoL-Pi compute worker core.
 *
 * The worker must produce byte-identical results to the vendored in-process
 * functions — observation ids, content hashes, byte/line/token counts and
 * placeholder excerpts (the precision recall and quoted原文 depend on), plus
 * the file/buffer hashes used by the fused-command interference check and the
 * EEXIST verify.
 */
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, test } from 'vitest';

import { executeSolPiComputeJob } from './solPiComputeWorkerCore';
import { SolPiComputeJob } from './solPiComputeJobs';
import { loadVendorModule } from './solPiTestFixtures';

interface VendorObservationModule {
  createObservation: (
    message: { role: string; toolCallId: string; toolName: string; isError: boolean; content: Array<{ type: 'text'; text: string }> },
    runtimeRoot: string,
  ) =>
    | {
        id: string;
        contentHash: string;
        filePath: string;
        toolName: string;
        text: string;
        bytes: number;
        lines: number;
        tokens: number;
      }
    | undefined;
  placeholderFor: (observation: {
    id: string;
    toolName: string;
    text: string;
    bytes: number;
    lines: number;
    tokens: number;
  }) => string;
}

const bigText = (bytes: number, seed = 0): string => {
  const line = (seed % 36).toString(36) + '0123456789abcdefghijklmnopqrstuvwxyz\n';
  return (line.repeat(Math.ceil(bytes / line.length))).slice(0, Math.max(0, bytes - 1)) + '\n';
};

const toolResultMessage = (text: string, toolCallId = 'call-big') => ({
  role: 'toolResult' as const,
  toolCallId,
  toolName: 'bash',
  isError: false,
  content: [{ type: 'text' as const, text }],
});

describe('executeSolPiComputeJob parity with the vendored in-process path', () => {
  test('prepare-observation matches createObservation + placeholderFor exactly', async () => {
    const vendor = await loadVendorModule<VendorObservationModule>(
      'extensions/observation-pack/observation.ts',
    );
    const root = mkdtempSync(path.join(tmpdir(), 'solpi-core-parity-'));
    const cases = [
      toolResultMessage(bigText(12 * 1024, 1), 'call-a'),
      toolResultMessage(bigText(48 * 1024, 7), 'call-b'),
      toolResultMessage('tiny', 'call-c'), // below threshold
    ];
    for (const message of cases) {
      const expected = vendor.createObservation(message, root);
      const actual = (await executeSolPiComputeJob(SolPiComputeJob.PrepareObservation, {
        message,
        runtimeRoot: root,
      })) as { observation: unknown; placeholder: string | null };

      if (!expected) {
        expect(actual.observation).toBeNull();
        expect(actual.placeholder).toBeNull();
        continue;
      }
      // The worker's Observation digest excludes the full text (it never
      // crosses the thread boundary); everything else must match exactly.
      const { text: _text, ...expectedDigest } = expected;
      expect(actual.observation).toEqual(expectedDigest);
      expect(actual.placeholder).toBe(vendor.placeholderFor(expected));
    }
  });

  test('file-sha256 matches node crypto on real files', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'solpi-core-files-'));
    const filePath = path.join(directory, 'payload.bin');
    const payload = Buffer.alloc(256 * 1024, 0x5a);
    writeFileSync(filePath, payload);
    const result = (await executeSolPiComputeJob(SolPiComputeJob.FileSha256, {
      path: filePath,
    })) as { sha256: string };
    expect(result.sha256).toBe(createHash('sha256').update(payload).digest('hex'));
  });

  test('buffer-sha256 matches node crypto on transferred buffers', async () => {
    const payload = Buffer.alloc(64 * 1024, 0x33);
    const result = (await executeSolPiComputeJob(SolPiComputeJob.BufferSha256, {
      buffer: Uint8Array.from(payload).buffer,
    })) as { sha256: string };
    expect(result.sha256).toBe(createHash('sha256').update(payload).digest('hex'));
  });

  test('unknown kinds fail with a structured error', async () => {
    await expect(executeSolPiComputeJob('nonsense', {})).rejects.toThrow(/unknown/i);
  });
});
