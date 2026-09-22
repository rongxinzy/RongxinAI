import type { ProcessMetric } from 'electron';

export const AgentResourceDiagnosticTrigger = {
  AcpTurnStarted: 'acp-turn-started',
  AcpTurnFinished: 'acp-turn-finished',
  PiTurnStarted: 'pi-turn-started',
  PiTurnFinished: 'pi-turn-finished',
  RendererProcessGone: 'renderer-process-gone',
} as const;

export type AgentResourceDiagnosticTrigger =
  (typeof AgentResourceDiagnosticTrigger)[keyof typeof AgentResourceDiagnosticTrigger];

type AcpTurnStats = {
  queuedEvents: number;
  queuedBytes: number;
  peakQueuedEvents: number;
  peakQueuedBytes: number;
};

type PiTurnStats = {
  peakToolResultBytes: number;
};

export type AgentResourceDiagnosticSnapshot = {
  mainProcess: {
    rssBytes: number;
    heapUsedBytes: number;
    externalBytes: number;
  };
  electronProcesses: Array<{
    pid: number;
    type: ProcessMetric['type'];
    name: string | null;
    residentSetBytes: number;
    privateBytes: number;
  }>;
  room: {
    latestEventCount: number;
    latestLaneCount: number;
    peakEventCount: number;
    publishCount: number;
  };
  acp: {
    activeTurns: number;
    peakQueuedEvents: number;
    peakQueuedBytes: number;
  };
  pi: {
    activeSessions: number;
    runningSessions: number;
    peakToolResultBytes: number;
  };
};

type DiagnosticDependencies = {
  getMemoryUsage: () => NodeJS.MemoryUsage;
  getElectronMetrics: () => ProcessMetric[];
  log: (message: string) => void;
};

const defaultDependencies: DiagnosticDependencies = {
  getMemoryUsage: () => process.memoryUsage(),
  getElectronMetrics: () => [],
  log: message => console.log(message),
};

const formatMiB = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(1)}MiB`;

const approximateValueBytes = (value: unknown, budget = 20_000): number => {
  let remaining = budget;
  const seen = new WeakSet<object>();

  const visit = (candidate: unknown): number => {
    if (remaining <= 0) return 0;
    if (typeof candidate === 'string') {
      const bytes = Math.min(candidate.length * 2, remaining);
      remaining -= bytes;
      return bytes;
    }
    if (candidate === null || typeof candidate !== 'object') return 8;
    if (seen.has(candidate)) return 0;
    seen.add(candidate);

    let bytes = 16;
    if (Array.isArray(candidate)) {
      for (const item of candidate) bytes += visit(item);
      return bytes;
    }
    for (const [key, item] of Object.entries(candidate)) {
      bytes += key.length * 2 + visit(item);
      if (remaining <= 0) break;
    }
    return bytes;
  };

  return visit(value);
};

const summarizeElectronProcesses = (
  metrics: ProcessMetric[],
): AgentResourceDiagnosticSnapshot['electronProcesses'] =>
  metrics.map(metric => ({
    pid: metric.pid,
    type: metric.type,
    name: metric.name ?? metric.serviceName ?? null,
    residentSetBytes: metric.memory.workingSetSize * 1024,
    privateBytes: (metric.memory.privateBytes ?? 0) * 1024,
  }));

export class AgentResourceDiagnostics {
  private readonly acpTurns = new Map<string, AcpTurnStats>();
  private readonly piTurns = new Map<string, PiTurnStats>();
  private readonly queuedEventBytes = new WeakMap<object, number>();
  private latestEventCount = 0;
  private latestLaneCount = 0;
  private peakEventCount = 0;
  private publishCount = 0;
  private activePiSessions = 0;
  private runningPiSessions = 0;
  private peakToolResultBytes = 0;
  private electronMetricsProvider: () => ProcessMetric[];

  constructor(private readonly dependencies: DiagnosticDependencies = defaultDependencies) {
    this.electronMetricsProvider = dependencies.getElectronMetrics;
  }

  setElectronMetricsProvider(provider: () => ProcessMetric[]): void {
    this.electronMetricsProvider = provider;
  }

  recordRoomSnapshot(eventCount: number, laneCount: number): void {
    this.latestEventCount = eventCount;
    this.latestLaneCount = laneCount;
    this.peakEventCount = Math.max(this.peakEventCount, eventCount);
    this.publishCount += 1;
  }

  startAcpTurn(sessionId: string, processId: number | undefined): void {
    this.acpTurns.set(sessionId, {
      queuedEvents: 0,
      queuedBytes: 0,
      peakQueuedEvents: 0,
      peakQueuedBytes: 0,
    });
    this.write(AgentResourceDiagnosticTrigger.AcpTurnStarted, {
      sessionId,
      acpProcessId: processId ?? null,
    });
  }

  recordAcpEnqueued(sessionId: string, event: object): void {
    const stats = this.acpTurns.get(sessionId);
    if (!stats) return;
    const bytes = approximateValueBytes(event);
    this.queuedEventBytes.set(event, bytes);
    stats.queuedEvents += 1;
    stats.queuedBytes += bytes;
    stats.peakQueuedEvents = Math.max(stats.peakQueuedEvents, stats.queuedEvents);
    stats.peakQueuedBytes = Math.max(stats.peakQueuedBytes, stats.queuedBytes);
  }

  recordAcpDequeued(sessionId: string, event: object): void {
    const stats = this.acpTurns.get(sessionId);
    if (!stats) return;
    const bytes = this.queuedEventBytes.get(event) ?? 0;
    this.queuedEventBytes.delete(event);
    stats.queuedEvents = Math.max(0, stats.queuedEvents - 1);
    stats.queuedBytes = Math.max(0, stats.queuedBytes - bytes);
  }

  recordAcpReplaced(sessionId: string, previous: object, next: object): void {
    this.recordAcpDequeued(sessionId, previous);
    this.recordAcpEnqueued(sessionId, next);
  }

  finishAcpTurn(sessionId: string, failed: boolean): void {
    const stats = this.acpTurns.get(sessionId);
    if (!stats) return;
    this.write(AgentResourceDiagnosticTrigger.AcpTurnFinished, {
      sessionId,
      failed,
      acp: {
        queuedEvents: stats.queuedEvents,
        queuedBytes: stats.queuedBytes,
        peakQueuedEvents: stats.peakQueuedEvents,
        peakQueuedBytes: stats.peakQueuedBytes,
      },
    });
    this.acpTurns.delete(sessionId);
  }

  startPiTurn(sessionId: string, activeSessions: number, runningSessions: number): void {
    this.piTurns.set(sessionId, { peakToolResultBytes: 0 });
    this.activePiSessions = activeSessions;
    this.runningPiSessions = runningSessions;
    this.write(AgentResourceDiagnosticTrigger.PiTurnStarted, { sessionId });
  }

  recordPiToolResult(sessionId: string, bytes: number): void {
    const stats = this.piTurns.get(sessionId);
    if (!stats) return;
    stats.peakToolResultBytes = Math.max(stats.peakToolResultBytes, bytes);
    this.peakToolResultBytes = Math.max(this.peakToolResultBytes, bytes);
  }

  finishPiTurn(sessionId: string, activeSessions: number, runningSessions: number): void {
    const stats = this.piTurns.get(sessionId);
    if (!stats) return;
    this.activePiSessions = activeSessions;
    this.runningPiSessions = runningSessions;
    this.write(AgentResourceDiagnosticTrigger.PiTurnFinished, {
      sessionId,
      peakToolResultBytes: stats.peakToolResultBytes,
    });
    this.piTurns.delete(sessionId);
  }

  logRendererProcessGone(reason: string): void {
    this.write(AgentResourceDiagnosticTrigger.RendererProcessGone, { reason });
  }

  snapshot(): AgentResourceDiagnosticSnapshot {
    const memory = this.dependencies.getMemoryUsage();
    let peakQueuedEvents = 0;
    let peakQueuedBytes = 0;
    for (const stats of this.acpTurns.values()) {
      peakQueuedEvents = Math.max(peakQueuedEvents, stats.peakQueuedEvents);
      peakQueuedBytes = Math.max(peakQueuedBytes, stats.peakQueuedBytes);
    }
    return {
      mainProcess: {
        rssBytes: memory.rss,
        heapUsedBytes: memory.heapUsed,
        externalBytes: memory.external,
      },
      electronProcesses: summarizeElectronProcesses(this.electronMetricsProvider()),
      room: {
        latestEventCount: this.latestEventCount,
        latestLaneCount: this.latestLaneCount,
        peakEventCount: this.peakEventCount,
        publishCount: this.publishCount,
      },
      acp: {
        activeTurns: this.acpTurns.size,
        peakQueuedEvents,
        peakQueuedBytes,
      },
      pi: {
        activeSessions: this.activePiSessions,
        runningSessions: this.runningPiSessions,
        peakToolResultBytes: this.peakToolResultBytes,
      },
    };
  }

  private write(trigger: AgentResourceDiagnosticTrigger, details: Record<string, unknown>): void {
    const snapshot = this.snapshot();
    const electron = snapshot.electronProcesses
      .map(
        process =>
          `${process.type}[${process.pid}] rss=${formatMiB(process.residentSetBytes)} private=${formatMiB(process.privateBytes)}`,
      )
      .join(',');
    this.dependencies.log(
      `[AgentResource] ${trigger}; main rss=${formatMiB(snapshot.mainProcess.rssBytes)} heap=${formatMiB(snapshot.mainProcess.heapUsedBytes)} room events=${snapshot.room.latestEventCount}/${snapshot.room.peakEventCount} lanes=${snapshot.room.latestLaneCount} publishes=${snapshot.room.publishCount} acp active=${snapshot.acp.activeTurns} queuePeak=${snapshot.acp.peakQueuedEvents}/${formatMiB(snapshot.acp.peakQueuedBytes)} pi sessions=${snapshot.pi.activeSessions} running=${snapshot.pi.runningSessions} toolPeak=${formatMiB(snapshot.pi.peakToolResultBytes)} electron=${electron || 'none'} details=${JSON.stringify(details)}`,
    );
  }
}

export const agentResourceDiagnostics = new AgentResourceDiagnostics();
