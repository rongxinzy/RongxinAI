import fs from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';

import type { SkillSecurityReport } from './skillSecurityTypes';

/** Bounded scan pool limits (AGENTS.md worker requirements: pool ≤ 2). */
export const SkillSecurityScanLimit = {
  Workers: 1,
  Queue: 4,
  MaxDirs: 64,
  MaxPathLength: 4096,
  TimeoutBaseMs: 15_000,
  TimeoutPerDirMs: 5_000,
  TimeoutMaxMs: 120_000,
} as const;

type ScanRequest = { skillDirs: string[] };
type ScanResponse = { reports?: SkillSecurityReport[]; error?: string; runMs: number };
type Job = {
  skillDirs: string[];
  queuedAt: number;
  resolve: (reports: SkillSecurityReport[]) => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  onAbort: () => void;
};
type Slot = { worker: Worker; job?: Job; startedAt?: number; timer?: NodeJS.Timeout };

const RISK_LEVELS = new Set(['safe', 'low', 'medium', 'high', 'critical']);

/** Structured result validation — the main process owns worker output checks. */
function isValidReport(report: unknown): report is SkillSecurityReport {
  if (!report || typeof report !== 'object') return false;
  const candidate = report as Partial<SkillSecurityReport>;
  return (
    typeof candidate.skillName === 'string' &&
    RISK_LEVELS.has(candidate.riskLevel ?? '') &&
    Number.isInteger(candidate.riskScore) &&
    (candidate.riskScore ?? -1) >= 0 &&
    (candidate.riskScore ?? 101) <= 100 &&
    Array.isArray(candidate.findings) &&
    candidate.findings.every(
      finding =>
        finding &&
        typeof finding.ruleId === 'string' &&
        typeof finding.file === 'string' &&
        !path.isAbsolute(finding.file),
    )
  );
}

export class SkillSecurityScanPool {
  private readonly slots: Slot[] = [];
  private readonly queue: Job[] = [];

  constructor(private readonly workerPath = path.join(__dirname, 'skillSecurityScanWorker.js')) {}

  /** Scan skill directories off the main thread. Paths are validated here. */
  async scan(skillDirs: string[], signal?: AbortSignal): Promise<SkillSecurityReport[]> {
    if (signal?.aborted) throw new Error('Skill security scan cancelled');
    if (
      !Array.isArray(skillDirs) ||
      skillDirs.length === 0 ||
      skillDirs.length > SkillSecurityScanLimit.MaxDirs
    ) {
      throw new Error('Skill security scan requires 1 to 64 directories');
    }
    for (const dir of skillDirs) {
      if (typeof dir !== 'string' || dir.length > SkillSecurityScanLimit.MaxPathLength) {
        throw new Error('Skill security scan received an invalid directory path');
      }
      if (!path.isAbsolute(dir)) {
        throw new Error('Skill security scan requires absolute directory paths');
      }
      const stat: fs.Stats | null = await fs.promises.stat(dir).catch((): null => null);
      if (!stat?.isDirectory()) {
        throw new Error(`Skill security scan directory does not exist: ${dir}`);
      }
    }
    if (this.queue.length >= SkillSecurityScanLimit.Queue) {
      throw new Error('Skill security scan queue is full');
    }
    return new Promise((resolve, reject) => {
      const job: Job = {
        skillDirs,
        queuedAt: performance.now(),
        resolve,
        reject,
        signal,
        onAbort: () => {
          const slot = this.slots.find(candidate => candidate.job === job);
          if (slot) this.finish(slot, new Error('Skill security scan cancelled'), true);
          else {
            const index = this.queue.indexOf(job);
            if (index >= 0) this.queue.splice(index, 1);
            signal?.removeEventListener('abort', job.onAbort);
            reject(new Error('Skill security scan cancelled'));
          }
        },
      };
      signal?.addEventListener('abort', job.onAbort, { once: true });
      this.queue.push(job);
      this.dispatch();
    });
  }

  dispose(): void {
    for (const job of this.queue.splice(0)) {
      job.signal?.removeEventListener('abort', job.onAbort);
      job.reject(new Error('Skill security scan pool closed'));
    }
    for (const slot of [...this.slots]) {
      this.finish(slot, new Error('Skill security scan pool closed'), true);
    }
  }

  private dispatch(): void {
    while (this.queue.length) {
      let slot = this.slots.find(candidate => !candidate.job);
      if (!slot && this.slots.length < SkillSecurityScanLimit.Workers) {
        let worker: Worker;
        try {
          worker = new Worker(this.workerPath);
        } catch (error) {
          const job = this.queue.shift()!;
          job.signal?.removeEventListener('abort', job.onAbort);
          job.reject(
            error instanceof Error
              ? error
              : new Error('Unable to start skill security scan worker'),
          );
          continue;
        }
        slot = { worker };
        const created = slot;
        worker.on('message', (response: ScanResponse) => {
          const job = created.job;
          if (!job) return;
          console.debug(
            `[SkillSecurity] scan finished after ${Math.round(created.startedAt! - job.queuedAt)} ms queued and ${Math.round(response.runMs)} ms running`,
          );
          if (
            response.error ||
            !Array.isArray(response.reports) ||
            response.reports.length !== job.skillDirs.length ||
            !response.reports.every(isValidReport)
          ) {
            this.finish(
              created,
              new Error(response.error || 'Invalid skill security scan worker result'),
            );
          } else {
            this.finish(created, undefined, false, response.reports);
          }
        });
        worker.on('error', error => this.finish(created, error, true));
        worker.on('exit', () => {
          if (this.slots.includes(created)) {
            this.finish(created, new Error('Skill security scan worker exited unexpectedly'), true);
          }
        });
        this.slots.push(slot);
      }
      if (!slot) return;
      const job = this.queue.shift()!;
      slot.job = job;
      slot.startedAt = performance.now();
      slot.worker.ref();
      const request: ScanRequest = { skillDirs: job.skillDirs };
      slot.timer = setTimeout(
        () => this.finish(slot!, new Error('Skill security scan timed out'), true),
        Math.min(
          SkillSecurityScanLimit.TimeoutBaseMs +
            SkillSecurityScanLimit.TimeoutPerDirMs * job.skillDirs.length,
          SkillSecurityScanLimit.TimeoutMaxMs,
        ),
      );
      try {
        slot.worker.postMessage(request);
      } catch (error) {
        this.finish(slot, error instanceof Error ? error : new Error(String(error)), true);
      }
    }
  }

  private finish(
    slot: Slot,
    error?: Error,
    terminate = false,
    reports?: SkillSecurityReport[],
  ): void {
    const job = slot.job;
    clearTimeout(slot.timer);
    slot.job = undefined;
    if (terminate) {
      const index = this.slots.indexOf(slot);
      if (index >= 0) this.slots.splice(index, 1);
      void slot.worker.terminate();
    } else slot.worker.unref();
    if (job) {
      job.signal?.removeEventListener('abort', job.onAbort);
      if (error) job.reject(error);
      else job.resolve(reports!);
    }
    this.dispatch();
  }
}

const pool = new SkillSecurityScanPool();

/** Scan skill directories through the bounded worker pool (non-blocking for main). */
export const scanSkillDirsAsync = (
  skillDirs: string[],
  signal?: AbortSignal,
): Promise<SkillSecurityReport[]> => pool.scan(skillDirs, signal);
