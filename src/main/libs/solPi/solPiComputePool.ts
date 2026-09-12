/**
 * Process-wide SoL-Pi compute pool (bounded, at most two workers).
 *
 * Moves the vendored extensions' blocking CPU work — first-sight observation
 * hashing/excerpt splitting and the fused-command interference hashes — off
 * the Electron main event loop. The injected functions keep the vendored
 * contracts byte-identical: the worker loads the same vendored module graph,
 * and failures (worker unavailable, queue overflow, worker crash) reject so
 * callers can fall back to the vendored in-process default — matching the
 * extension's own fail-open semantics.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';

import { createWorkerPool, type WorkerPool } from '../backgroundWorkerPool';
import {
  SolPiComputeJob,
  type FileSha256Result,
  type PrepareObservationResult,
  type SolPiToolResultMessagePayload,
} from './solPiComputeJobs';

let pool: WorkerPool | null = null;
let poolUnavailable = false;

/** Worker bundle location (built next to the main bundle by vite). */
function resolveWorkerScript(): string | null {
  const candidates = [
    path.resolve(__dirname, 'solPiComputeWorker.js'),
    path.resolve(__dirname, '../dist-electron/solPiComputeWorker.js'),
  ];
  return candidates.find(candidate => existsSync(candidate)) ?? null;
}

function getPool(): WorkerPool | null {
  if (poolUnavailable) return null;
  if (pool) return pool;
  const script = resolveWorkerScript();
  if (!script) {
    // Source-mode execution (vitest) has no built worker bundle; fall back to
    // the vendored in-process path.
    poolUnavailable = true;
    return null;
  }
  pool = createWorkerPool(script, { maxWorkers: 2, maxQueued: 64, idleShutdownMs: 30_000 });
  return pool;
}

export interface SolPiCompute {
  /** Vendor-compatible createObservation + placeholderFor, computed off-thread. */
  prepareObservation(
    message: SolPiToolResultMessagePayload,
    runtimeRoot: string,
  ): Promise<PrepareObservationResult>;
  /** sha256 of one file, computed off-thread. */
  fileHash(filePath: string): Promise<string>;
  /** sha256 of one buffer (transferred), computed off-thread. */
  hashBuffer(buffer: Buffer): Promise<string>;
}

/**
 * Pool-backed compute API, or null when no worker bundle is available (the
 * caller then leaves the vendored in-process defaults in place).
 */
export function getSolPiCompute(): SolPiCompute | null {
  const activePool = getPool();
  if (!activePool) return null;
  return {
    async prepareObservation(message, runtimeRoot) {
      const prepared = (await activePool.run({
        kind: SolPiComputeJob.PrepareObservation,
        payload: { message, runtimeRoot },
      })) as PrepareObservationResult;
      if (!prepared.observation) return null;
      // Reconstruct the full text on this side with the exact block join the
      // vendored textFromResult uses (the worker hashed precisely this text;
      // all-text content is guaranteed by the vendor's isPureTextResult gate).
      const text = message.content.map(block => block.text).join('\n');
      return { observation: { ...prepared.observation, text }, placeholder: prepared.placeholder ?? '' };
    },
    async fileHash(filePath) {
      const result = (await activePool.run({
        kind: SolPiComputeJob.FileSha256,
        payload: { path: filePath },
      })) as FileSha256Result;
      return result.sha256;
    },
    async hashBuffer(buffer) {
      // Copy into a standalone ArrayBuffer so it can be transferred instead
      // of structured-cloned (Buffers may share the pool allocator).
      const transferable = Uint8Array.from(buffer);
      const result = (await activePool.run({
        kind: SolPiComputeJob.BufferSha256,
        payload: { buffer: transferable.buffer },
        transfer: [transferable.buffer],
      })) as FileSha256Result;
      return result.sha256;
    },
  };
}

/** Terminate the pool (app quit). Safe to call repeatedly. */
export async function disposeSolPiComputePool(): Promise<void> {
  if (!pool) return;
  const activePool = pool;
  pool = null;
  await activePool.dispose();
}
