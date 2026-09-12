/**
 * Core job handlers for the SoL-Pi compute worker.
 *
 * Lives in app code (not the worker entry) so tests can drive the exact job
 * contract without spawning a thread. The worker entry
 * (src/main/workers/solPiComputeWorker.ts) is a thin parentPort adapter over
 * this module.
 *
 * The observation job loads the SAME vendored module the main process loads
 * (jiti, same candidate resolution), so observation ids, content hashes and
 * placeholder excerpts are byte-identical to the in-process path — the
 * precision guarantee recall and quoted excerpts depend on.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { createJiti } from 'jiti';

import { resolveSolPiVendorRoot } from './solPiVendor';
import {
  SolPiComputeJob,
  type BufferSha256Payload,
  type BufferSha256Result,
  type FileSha256Payload,
  type FileSha256Result,
  type ObservationDigest,
  type PrepareObservationPayload,
  type PrepareObservationResult,
  type SolPiToolResultMessagePayload,
} from './solPiComputeJobs';

/** Structural slice of the vendored observation module the worker needs. */
interface VendorObservationModule {
  createObservation: (
    message: SolPiToolResultMessagePayload,
    runtimeRoot: string,
  ) => (ObservationDigest & { text: string }) | undefined;
  placeholderFor: (observation: ObservationDigest & { text: string }) => string;
}

let vendorObservationPromise: Promise<VendorObservationModule> | null = null;

function loadVendorObservation(): Promise<VendorObservationModule> {
  vendorObservationPromise ??= (async (): Promise<VendorObservationModule> => {
    const jiti = createJiti(__filename, { moduleCache: true });
    const entry = path.join(resolveSolPiVendorRoot(), 'extensions', 'observation-pack', 'observation.ts');
    const loaded = (await jiti.import(entry)) as Partial<VendorObservationModule>;
    if (typeof loaded.createObservation !== 'function' || typeof loaded.placeholderFor !== 'function') {
      throw new Error(`Vendored observation module is missing its exports: ${entry}`);
    }
    return loaded as VendorObservationModule;
  })();
  return vendorObservationPromise;
}

/**
 * Execute one compute job. Throws plain Errors; the worker adapter converts
 * them into the structured reply envelope.
 */
export async function executeSolPiComputeJob(kind: string, payload: unknown): Promise<unknown> {
  switch (kind) {
    case SolPiComputeJob.PrepareObservation: {
      const { message, runtimeRoot } = payload as PrepareObservationPayload;
      const vendor = await loadVendorObservation();
      const observation = vendor.createObservation(message, runtimeRoot);
      if (!observation) return { observation: null, placeholder: null } satisfies PrepareObservationResult;
      // The full text never crosses back: the caller already holds the
      // message and reconstructs `text` with the same block join the vendor
      // uses, so only the digest (hash/id/counts) and the bounded placeholder
      // are serialized.
      const { text: _text, ...digest } = observation;
      return { observation: digest, placeholder: vendor.placeholderFor(observation) } satisfies PrepareObservationResult;
    }
    case SolPiComputeJob.FileSha256: {
      const { path: filePath } = payload as FileSha256Payload;
      const sha256 = createHash('sha256').update(await readFile(filePath)).digest('hex');
      return { sha256 } satisfies FileSha256Result;
    }
    case SolPiComputeJob.BufferSha256: {
      const { buffer } = payload as BufferSha256Payload;
      const sha256 = createHash('sha256').update(new Uint8Array(buffer)).digest('hex');
      return { sha256 } satisfies BufferSha256Result;
    }
    default:
      throw new Error(`Unknown SoL-Pi compute job kind: ${kind}`);
  }
}
