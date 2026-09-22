import { expect, test, vi } from 'vitest';

import { AgentResourceDiagnostics } from './agentResourceDiagnostics';
import type { ProcessMetric } from 'electron';

const memory = (): NodeJS.MemoryUsage => ({
  rss: 80 * 1024 * 1024,
  heapTotal: 40 * 1024 * 1024,
  heapUsed: 20 * 1024 * 1024,
  external: 4 * 1024 * 1024,
  arrayBuffers: 0,
});

test('tracks room, ACP queue, and Pi resource peaks without logging payload contents', () => {
  const logs: string[] = [];
  const diagnostics = new AgentResourceDiagnostics({
    getMemoryUsage: memory,
    getElectronMetrics: () => [],
    log: message => logs.push(message),
  });
  const queuedEvent = { kind: 'tool', payload: { output: 'secret output' } };

  diagnostics.recordRoomSnapshot(12, 2);
  diagnostics.recordRoomSnapshot(20, 3);
  diagnostics.startAcpTurn('session-1', 1234);
  diagnostics.recordAcpEnqueued('session-1', queuedEvent);
  diagnostics.startPiTurn('session-1', 1, 1);
  diagnostics.recordPiToolResult('session-1', 4096);
  diagnostics.finishPiTurn('session-1', 1, 0);
  diagnostics.recordAcpDequeued('session-1', queuedEvent);
  diagnostics.finishAcpTurn('session-1', false);

  const snapshot = diagnostics.snapshot();
  expect(snapshot.room).toMatchObject({
    latestEventCount: 20,
    latestLaneCount: 3,
    peakEventCount: 20,
    publishCount: 2,
  });
  expect(snapshot.acp).toMatchObject({ activeTurns: 0, peakQueuedEvents: 0 });
  expect(snapshot.pi).toMatchObject({ activeSessions: 1, runningSessions: 0 });
  expect(logs).toHaveLength(4);
  expect(logs.join('\n')).not.toContain('secret output');
  expect(logs.join('\n')).toContain('queuePeak=1/');
});

test('logs renderer process termination with current process metrics', () => {
  const log = vi.fn<(message: string) => void>();
  const diagnostics = new AgentResourceDiagnostics({
    getMemoryUsage: memory,
    getElectronMetrics: () => [
      {
        pid: 42,
        type: 'GPU',
        memory: { privateBytes: 1024, workingSetSize: 2048, peakWorkingSetSize: 2048 },
      } as ProcessMetric,
    ],
    log,
  });

  diagnostics.logRendererProcessGone('oom');

  expect(log).toHaveBeenCalledWith(expect.stringContaining('renderer-process-gone'));
  expect(log).toHaveBeenCalledWith(expect.stringContaining('GPU[42] rss=2.0MiB'));
});
