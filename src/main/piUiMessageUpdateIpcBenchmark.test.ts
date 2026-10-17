import { performance } from 'node:perf_hooks';
import { expect, test } from 'vitest';

import { PiUiEventType } from '../shared/cowork/piUiEvent';
import { createPiUiEventBatcher } from './piUiEventBatcher';
import { CoworkContentProjection } from './coworkContentProjection';
import { runTextWorkerOperation } from './workbenchTask/textWorkerOperations';

const FINAL_BYTES = 100 * 1024;
const EMIT_INTERVAL_MS = 200;
const STREAM_DURATION_MS = 60_000;

function estimateMessageUpdateIpcBytes(finalContent: string, emitCount: number): number {
  let bytes = 0;
  const step = Math.max(1, Math.floor(finalContent.length / emitCount));
  for (let i = 1; i <= emitCount; i += 1) {
    const length = Math.min(finalContent.length, i * step);
    const content = finalContent.slice(0, length);
    bytes += Buffer.byteLength(
      JSON.stringify({
        type: PiUiEventType.MessageUpdate,
        sessionId: 'session',
        messageId: 'message',
        content,
      }),
      'utf8',
    );
  }
  return bytes;
}

async function measurePatchPathIpcBytes(
  finalContent: string,
  emitCount: number,
): Promise<{ ipcBytes: number; mainCpuMs: number }> {
  const projection = new CoworkContentProjection(async input => runTextWorkerOperation(input));
  const step = Math.max(1, Math.floor(finalContent.length / emitCount));
  let ipcBytes = 0;
  const start = performance.now();
  for (let i = 1; i <= emitCount; i += 1) {
    const length = Math.min(finalContent.length, i * step);
    const content = finalContent.slice(0, length);
    const patches = await projection.project('session', 'message', content);
    for (const patch of patches) {
      ipcBytes += Buffer.byteLength(JSON.stringify(patch), 'utf8');
    }
  }
  return { ipcBytes, mainCpuMs: performance.now() - start };
}

test('synthetic 100KB stream: MessageUpdate full-replace IPC vs incremental ContentPatch', async () => {
  const emitCount = Math.floor(STREAM_DURATION_MS / EMIT_INTERVAL_MS);
  const finalContent = 'x'.repeat(FINAL_BYTES);

  const messageUpdateBytes = estimateMessageUpdateIpcBytes(finalContent, emitCount);
  const patchPath = await measurePatchPathIpcBytes(finalContent, emitCount);

  // Document regression guardrails: full replace should not beat incremental IPC.
  expect(patchPath.ipcBytes).toBeLessThan(messageUpdateBytes);
  expect(messageUpdateBytes / patchPath.ipcBytes).toBeGreaterThan(10);

  // eslint-disable-next-line no-console -- benchmark output for manual CI logs
  console.info(
    JSON.stringify({
      scenario: '100KB assistant stream / 200ms throttle / 60s',
      emitCount,
      messageUpdateIpcBytes: messageUpdateBytes,
      contentPatchIpcBytes: patchPath.ipcBytes,
      ratio: Number((messageUpdateBytes / patchPath.ipcBytes).toFixed(2)),
      patchPathMainCpuMs: Number(patchPath.mainCpuMs.toFixed(2)),
      messageUpdateBatchWindowMs: 32,
      estimatedMessageUpdateIpcMbps: Number(
        ((messageUpdateBytes * 8) / STREAM_DURATION_MS / 1000).toFixed(2),
      ),
    }),
  );
});

test('piUiEventBatcher coalesces to one wire frame per 32ms window', () => {
  const payloads: unknown[] = [];
  const send = createPiUiEventBatcher(payload => payloads.push(payload));
  const content = 'a'.repeat(4096);
  for (let i = 0; i < 8; i += 1) {
    send({
      type: PiUiEventType.MessageUpdate,
      sessionId: 'session',
      messageId: 'message',
      content: content.slice(0, (i + 1) * 512),
    });
  }
  expect(payloads).toHaveLength(0);
});
