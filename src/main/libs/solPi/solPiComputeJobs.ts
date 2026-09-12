/**
 * Job contract between the Electron main process and the SoL-Pi compute
 * worker (src/main/workers/solPiComputeWorker.ts).
 *
 * The worker exists so the blocking CPU work the vendored SoL-Pi extensions
 * perform on the agent-stream path — first-sight full-text sha256/line
 * counting/excerpt splitting and the fused-command interference hashes — runs
 * off the main event loop, per the repository's Main Process / Worker
 * Boundary rules. The worker loads the SAME vendored module (via jiti, from
 * the same candidate resolution as solPiVendor.ts), so ids, hashes and
 * placeholder excerpts stay byte-identical to the in-process path.
 */

export const SolPiComputeJob = {
  /** Compute an Observation (hash/id/lines/tokens) plus its placeholder. */
  PrepareObservation: 'solpi-prepare-observation',
  /** sha256 of one file (fused-command interference check). */
  FileSha256: 'solpi-file-sha256',
  /** sha256 of a transferred buffer (EEXIST content verify). */
  BufferSha256: 'solpi-buffer-sha256',
} as const;
export type SolPiComputeJob = (typeof SolPiComputeJob)[keyof typeof SolPiComputeJob];

/** Structural slice of a Pi ToolResultMessage (JSON-serializable). */
export interface SolPiToolResultMessagePayload {
  role: 'toolResult';
  toolCallId: string;
  toolName: string;
  isError: boolean;
  content: Array<{ type: 'text'; text: string }>;
}

export interface PrepareObservationPayload {
  message: SolPiToolResultMessagePayload;
  runtimeRoot: string;
}

export interface ObservationDigest {
  id: string;
  contentHash: string;
  filePath: string;
  toolName: string;
  bytes: number;
  lines: number;
  tokens: number;
}

export interface PrepareObservationResult {
  /** Null when the result is below the archive threshold or carries a receipt. */
  observation: ObservationDigest | null;
  /** Null exactly when observation is null. */
  placeholder: string | null;
}

export interface FileSha256Payload {
  path: string;
}

export interface FileSha256Result {
  sha256: string;
}

export interface BufferSha256Payload {
  buffer: ArrayBuffer;
}

export interface BufferSha256Result {
  sha256: string;
}

/** Envelope the worker replies with; error is a structured plain object. */
export interface SolPiComputeReply {
  seq: number;
  ok: boolean;
  result?: unknown;
  error?: { message: string; code?: string };
}
