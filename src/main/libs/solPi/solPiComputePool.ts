/**
 * Process-wide SoL-Pi compute pool (bounded, at most two workers).
 *
 * Moves the vendored extensions' blocking CPU work — first-sight observation
 * hashing/excerpt splitting and the fused-command interference hashes — off
 * the Electron main event loop. The injected functions keep the vendored
 * contracts byte-identical: the worker loads the same vendored module graph.
 *
 * Two degradation modes, kept distinct on purpose: when no worker bundle is
 * available (source-mode execution), the hooks stay undefined and the vendored
 * in-process defaults apply unchanged; when a hooked call fails at runtime
 * (spawn failure, queue overflow, worker crash, job error), the rejection
 * flows into the vendor's own fail-open — the observation stays in full
 * context and the fused-command interference check is skipped for that call —
 * the same semantics the vendored code already applies to its own errors.
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

/**
 * Worker bundle location (built next to the main bundle by vite).
 *
 * In packaged builds the resolved path is the app.asar archive member, which
 * is deliberate and verified: worker threads on the pinned Electron load
 * asar-member scripts and resolve their bare specifiers (require('jiti'))
 * against the archive's own node_modules — confirmed empirically against the
 * real archive layout (scripts/ci/solpi-packaged-smoke.cjs exercises the
 * spawn in the macOS packaged gate run). The app.asar.unpacked sibling (kept
 * by asarUnpack) would NOT work as the spawn path: bare-specifier resolution
 * from outside the archive never reaches app.asar/node_modules
 * (MODULE_NOT_FOUND for jiti). Do not "fix" this to the unpacked convention
 * used for spawned child processes.
 *
 * Source-mode execution (vitest, straight from src/) has no candidate that
 * resolves, so the pool latches unavailable there and the vendored
 * in-process defaults apply.
 */
function resolveWorkerScript(): string | null {
  const candidates = [
    // vite bundle layout (packaged app and electron:dev): __dirname is the
    // bundle directory dist-electron/.
    path.resolve(__dirname, 'solPiComputeWorker.js'),
    // tsc layout (dist-electron/main/libs/solPi): used by the packaged smoke
    // scripts, which require the compiled module directly.
    path.resolve(__dirname, '../../../solPiComputeWorker.js'),
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
