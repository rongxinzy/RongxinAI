/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: MIT
 */
import { appendFile, mkdir, rename, stat } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Append-only JSONL record of what the mechanism did on each provider request.
 *
 * The caller derives the ledger path from the active Pi session.
 *
 * Local divergence from upstream: the directory is created once per path
 * (memoized mkdir) instead of before every append; one call may batch an
 * array of entries into a single append (the projection loop collects a
 * whole request's entries first); and the file is rotated (one generation,
 * `ledger.jsonl.1`) at a byte ceiling so a long-lived session cannot grow it
 * without bound. The ledger is diagnostics-only — recall reads objects, never
 * the ledger — so rotation loses no references.
 */
export type Ledger = (entry: Record<string, unknown> | Record<string, unknown>[]) => Promise<void>;

export interface LedgerOptions {
	/** Rotate to `<path>.1` once the current file exceeds this size. */
	readonly maxBytes?: number;
}

const DEFAULT_MAX_BYTES = 1024 * 1024;

export function createLedger(path: string, options: LedgerOptions = {}): Ledger {
	const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
	let directoryReady: Promise<void> | null = null;
	let bytesWritten: number | null = null;
	let writeChain: Promise<void> = Promise.resolve();

	const ensureDirectory = (): Promise<void> => {
		directoryReady ??= mkdir(dirname(path), { recursive: true }).then(
			() => undefined,
			(error) => {
				// Retry on the next append (the directory may have disappeared).
				directoryReady = null;
				throw error;
			},
		);
		return directoryReady;
	};

	const measure = async (): Promise<number> => {
		try {
			return (await stat(path)).size;
		} catch {
			return 0;
		}
	};

	const rotateIfNeeded = async (): Promise<void> => {
		if (bytesWritten === null) bytesWritten = await measure();
		if (bytesWritten <= maxBytes) return;
		try {
			await rename(path, `${path}.1`);
			bytesWritten = 0;
		} catch {
			// A missing/unmovable ledger must never break the projection path;
			// keep appending to the current file instead.
			bytesWritten = 0;
		}
	};

	return async (entry) => {
		const entries = Array.isArray(entry) ? entry : [entry];
		if (entries.length === 0) return;
		const block = `${entries
			.map((record) => JSON.stringify({ timestamp: new Date().toISOString(), ...record }))
			.join("\n")}\n`;
		// Serialize writes so batched appends keep their order and the byte
		// accounting stays exact. The awaiting caller observes the attempt's
		// failure, but the chain itself continues from a settled state — one
		// rejected append (ENOSPC, vanished directory) must not poison every
		// later append for the rest of the session.
		const attempt = writeChain.then(async () => {
			await ensureDirectory();
			await rotateIfNeeded();
			await appendFile(path, block, "utf8");
			bytesWritten = (bytesWritten ?? 0) + Buffer.byteLength(block, "utf8");
		});
		writeChain = attempt.catch(() => undefined);
		await attempt;
	};
}
