/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: MIT
 */
/**
 * ObservationPack - keep large tool results reachable without replaying them.
 *
 * A large tool result is sent in full for its first few provider requests, then
 * replaced with a short, stable placeholder for every later request. The
 * original bytes are archived by observation id outside the provider context,
 * and the agent pulls exact pages back with the registered `obs_recall` tool.
 *
 * The mechanism never edits history in place. It rewrites only at the
 * projection layer (`pi.on("context")`), so the stored session stays intact and
 * recall keeps working after native compaction or a session resume.
 *
 * Storage lives under the active Pi session directory.
 *
 * The projection runs on every provider request, so each extension instance
 * caches its per-message projection (no full text retained) and skips the
 * hash/archive work for messages it has already seen. Archiving new objects is
 * additionally bounded by a per-root archive budget shared across instances in
 * this process; over-budget results simply stay in full context.
 */

import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import type { ToolResultMessage } from "@earendil-works/pi-ai";
import { runtimeRoot } from "../../runtime-paths.ts";
import { formatSavingsCount, renderSolPiTool, showSolPiSavings } from "../../tui.ts";
import { createLedger, type Ledger } from "./ledger.ts";
import {
	archiveBytes,
	countLines,
	createObservation,
	ensureStored,
	estimateTokens,
	FULL_SENDS,
	isObservationId,
	isPureTextResult,
	objectSize,
	observationPath,
	placeholderFor,
	type RecallChunk,
	readRecallChunk,
} from "./observation.ts";

const RECALL_MAX_BYTES = 16 * 1024;
const RECALL_MAX_LINES = 400;
const RECALL_HEADER_RESERVE_BYTES = 512;
const RECALL_HEADER_LINES = 2;

const RECALL_LIMITS = {
	maxBytes: RECALL_MAX_BYTES - RECALL_HEADER_RESERVE_BYTES,
	maxLines: RECALL_MAX_LINES - RECALL_HEADER_LINES,
};

/** Upper bound for archived observation objects per session runtime root. */
export const DEFAULT_ARCHIVE_BUDGET_BYTES = 256 * 1024 * 1024;
/** Entry cap for the by-tool-call-id projection cache (FIFO eviction). */
const PROJECTION_CACHE_MAX_ENTRIES = 1024;

export interface ObservationPackOptions {
	/** Archived-bytes ceiling per runtime root; defaults to DEFAULT_ARCHIVE_BUDGET_BYTES. */
	readonly archiveBudgetBytes?: number;
}

interface ProjectionMeta {
	readonly id: string;
	readonly contentHash: string;
	readonly toolName: string;
	readonly bytes: number;
	readonly textUnits: number;
	readonly lines: number;
	readonly tokens: number;
}

interface ArchivedProjection extends ProjectionMeta {
	readonly archived: true;
	readonly placeholder: string;
	readonly placeholderTokens: number;
}

interface SkippedProjection extends ProjectionMeta {
	readonly archived: false;
}

type Projection = ArchivedProjection | SkippedProjection;

interface ArchiveBudget {
	readonly limit: number;
	bytes: number;
	initialized: Promise<void>;
	warned: boolean;
}

/** Shared per process so every extension instance on one root counts the same bytes. */
const archiveBudgets = new Map<string, ArchiveBudget>();

const budgetTrackerFor = (root: string, limit: number): ArchiveBudget => {
	const existing = archiveBudgets.get(root);
	if (existing) return existing;

	const budget: ArchiveBudget = { limit, bytes: 0, initialized: Promise.resolve(), warned: false };
	budget.initialized = archiveBytes(root).then(
		(bytes) => {
			budget.bytes = bytes;
		},
		(error) => {
			// Fail open: an unmeasurable archive must not break the context path.
			console.error(
				`[observationpack] failed to measure archive bytes: ${error instanceof Error ? error.message : String(error)}`,
			);
		},
	);
	archiveBudgets.set(root, budget);
	return budget;
};

export function createObservationPackExtension(options: ObservationPackOptions = {}): ExtensionFactory {
	const archiveBudgetBytes = options.archiveBudgetBytes ?? DEFAULT_ARCHIVE_BUDGET_BYTES;
	return (pi: ExtensionAPI) => {
		const sentCounts = new Map<string, number>();
		const ledgers = new Map<string, Ledger>();
		const ledgerFor = (ctx: ExtensionContext): Ledger => {
			const root = runtimeRoot(ctx);
			let ledger = ledgers.get(root);
			if (!ledger) {
				ledger = createLedger(join(root, "observation-pack", "ledger.jsonl"));
				ledgers.set(root, ledger);
			}
			return ledger;
		};

		// Steady-state projections skip hashing and archiving entirely. The
		// WeakMap covers repeated requests with the same message object; the
		// tool-call-id map survives message objects being rebuilt (resume,
		// incarnation rebuild, the runner cloning messages per request) with a
		// cheap text-size guard against id reuse.
		const projectionsByMessage = new WeakMap<object, Projection>();
		const projectionsByToolCallId = new Map<string, Projection>();

		// UTF-16 unit total of the joined text (blocks plus "\n" separators).
		// O(content blocks), never touches the text itself: string length is
		// metadata in V8, so the per-request guard stays cheap no matter how
		// large the archived results are. Same discriminator strength as a
		// byte-length check — both catch only size changes. A same-length
		// content change under a reused tool-call id is NOT detected and would
		// be served the old projection (whose id embeds the old content hash);
		// that is an accepted bound because the Pi SDK mints a fresh
		// tool-call id per provider tool_use and nothing in this app or the
		// vendored extensions rewrites an archived toolResult's content in
		// place, so id reuse with mutated content does not occur today.
		const contentUnits = (message: ToolResultMessage): number => {
			let units = message.content.length - 1;
			for (const block of message.content) units += block.text.length;
			return units;
		};

		const cacheLookup = (message: ToolResultMessage): Projection | undefined => {
			const byIdentity = projectionsByMessage.get(message);
			if (byIdentity) return byIdentity;
			const key = message.toolCallId;
			if (!key) return undefined;
			const candidate = projectionsByToolCallId.get(key);
			if (!candidate) return undefined;
			if (contentUnits(message) !== candidate.textUnits) return undefined;
			projectionsByMessage.set(message, candidate);
			return candidate;
		};

		const cacheStore = (message: ToolResultMessage, projection: Projection): void => {
			projectionsByMessage.set(message, projection);
			const key = message.toolCallId;
			if (!key) return;
			if (projectionsByToolCallId.size >= PROJECTION_CACHE_MAX_ENTRIES) {
				const oldest = projectionsByToolCallId.keys().next().value;
				if (oldest !== undefined) projectionsByToolCallId.delete(oldest);
			}
			projectionsByToolCallId.set(key, projection);
		};

		pi.registerTool({
			name: "obs_recall",
			label: "Recall Observation",
			description: "Read a stored large tool result by observation id and byte offset.",
			promptSnippet: "Recall a paged excerpt from a previously replaced large tool result",
			renderShell: "self",
			parameters: Type.Object({
				id: Type.String({ description: "Observation id from a placeholder" }),
				offset: Type.Optional(Type.Integer({ minimum: 0, description: "Byte offset, default 0" })),
			}),
			async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
				if (!isObservationId(params.id)) throw new Error(`Unknown observation id: ${params.id}`);
				const offset = params.offset ?? 0;
				let chunk: RecallChunk;
				try {
					chunk = await readRecallChunk(observationPath(runtimeRoot(ctx), params.id), offset, RECALL_LIMITS);
				} catch (error) {
					if (error instanceof Error && "code" in error && error.code === "ENOENT") {
						throw new Error(`Unknown observation id: ${params.id}`);
					}
					throw error;
				}
				const header = [
					`[obs_recall id=${params.id} offset=${offset} next_offset=${chunk.nextOffset} eof=${chunk.eof}]`,
					`[chunk_bytes=${chunk.bytes} chunk_lines=${chunk.lines}; use next_offset to continue]`,
				].join("\n");
				const content = `${header}\n${chunk.text}`;
				if (Buffer.byteLength(content, "utf8") > RECALL_MAX_BYTES || countLines(content) > RECALL_MAX_LINES) {
					throw new Error("Recall output exceeded its hard limit");
				}
				await ledgerFor(ctx)({
					event: "recall",
					id: params.id,
					offset,
					bytes: chunk.bytes,
					lines: chunk.lines,
					nextOffset: chunk.nextOffset,
					eof: chunk.eof,
				});
				return {
					content: [{ type: "text", text: content }],
					details: {
						id: params.id,
						offset,
						bytes: chunk.bytes,
						lines: chunk.lines,
						nextOffset: chunk.nextOffset,
						eof: chunk.eof,
					},
				};
			},
			renderCall(params, theme) {
				const offset = params.offset ?? 0;
				const base = new Text(theme.fg("dim", `Recall ${params.id} from byte ${offset}`), 0, 0);
				return renderSolPiTool(theme, "Observation Pack", "full observation replay avoided", base);
			},
			renderResult(result, { isPartial }, theme) {
				const details = result.details as { bytes?: number; lines?: number } | undefined;
				const base = new Text(
					theme.fg(
						isPartial ? "warning" : "dim",
						isPartial
							? "Recalling the requested slice..."
							: `Recalled ${details?.bytes ?? 0} bytes across ${details?.lines ?? 0} lines`,
					),
					0,
					0,
				);
				return renderSolPiTool(theme, "Observation Pack", "full observation replay avoided", base);
			},
		});

		pi.on("context", async (event, ctx: ExtensionContext) => {
			const projected = [...event.messages];
			const root = runtimeRoot(ctx);
			const budget = budgetTrackerFor(root, archiveBudgetBytes);
			// How many provider requests each message has already been part of,
			// counted by the assistant messages that follow it.
			const priorAssistantCounts = new Array<number>(event.messages.length);
			let assistantCount = 0;

			for (let index = event.messages.length - 1; index >= 0; index -= 1) {
				priorAssistantCounts[index] = assistantCount;
				if (event.messages[index]?.role === "assistant") assistantCount += 1;
			}

			const requestIndex = assistantCount + 1;
			for (let index = 0; index < event.messages.length; index += 1) {
				const message = event.messages[index];
				if (!message || !isPureTextResult(message)) continue;

				try {
					let projection = cacheLookup(message);
					if (!projection) {
						const observation = createObservation(message, root);
						if (!observation) continue;
						const textUnits = contentUnits(message);

						await budget.initialized;
						if (budget.bytes + observation.bytes > budget.limit) {
							// Over budget: never archive, never placeholder, never
							// count sends — the result simply stays in full context.
							if (!budget.warned) {
								budget.warned = true;
								console.warn(
									`[observationpack] archive budget of ${budget.limit} bytes reached; new large tool results stay in full context`,
								);
							}
							projection = {
								archived: false,
								id: observation.id,
								contentHash: observation.contentHash,
								toolName: observation.toolName,
								bytes: observation.bytes,
								textUnits,
								lines: observation.lines,
								tokens: observation.tokens,
							};
						} else {
							const existingSize = await objectSize(observation.filePath);
							await ensureStored(observation);
							if (existingSize === undefined) budget.bytes += observation.bytes;
							const placeholder = placeholderFor(observation);
							projection = {
								archived: true,
								id: observation.id,
								contentHash: observation.contentHash,
								toolName: observation.toolName,
								bytes: observation.bytes,
								textUnits,
								lines: observation.lines,
								tokens: observation.tokens,
								placeholder,
								placeholderTokens: estimateTokens(placeholder),
							};
						}
						cacheStore(message, projection);
					}
					if (!projection.archived) continue;

					const sendCountKey = `${root}\0${projection.id}`;
					const previousSends = sentCounts.get(sendCountKey) ?? priorAssistantCounts[index] ?? 0;
					if (previousSends < FULL_SENDS) {
						await ledgerFor(ctx)({
							event: "full",
							id: projection.id,
							request: requestIndex,
							tool: projection.toolName,
							originalBytes: projection.bytes,
							originalLines: projection.lines,
							originalTokens: projection.tokens,
							contentHash: projection.contentHash,
						});
						sentCounts.set(sendCountKey, previousSends + 1);
						continue;
					}

					const placeholderTokens = projection.placeholderTokens;
					const removedTokens = Math.max(0, projection.tokens - placeholderTokens);
					await ledgerFor(ctx)({
						event: "placeholder",
						id: projection.id,
						request: requestIndex,
						sendNumber: previousSends + 1,
						tool: projection.toolName,
						originalBytes: projection.bytes,
						originalLines: projection.lines,
						originalTokens: projection.tokens,
						placeholderBytes: Buffer.byteLength(projection.placeholder, "utf8"),
						placeholderTokens,
						removedTokens,
					});
					if (previousSends === FULL_SENDS) {
						showSolPiSavings(
							ctx,
							"Observation Pack",
							formatSavingsCount(removedTokens, "context tokens avoided"),
						);
					}
					projected[index] = { ...message, content: [{ type: "text", text: projection.placeholder }] };
					sentCounts.set(sendCountKey, previousSends + 1);
				} catch (error) {
					// Fail open: a packing failure must never cost the agent its observation.
					const reason = error instanceof Error ? error.message : String(error);
					console.error(`[observationpack] fail-open for tool result: ${reason}`);
				}
			}

			return { messages: projected };
		});
	};
}

export {
	createObservation,
	FULL_SENDS,
	type Observation,
	PLACEHOLDER_EXCERPT_BYTES,
	placeholderFor,
	THRESHOLD_BYTES,
} from "./observation.ts";

export function registerObservationPack(pi: ExtensionAPI, options: ObservationPackOptions = {}): void {
	createObservationPackExtension(options)(pi);
}

export default registerObservationPack;
