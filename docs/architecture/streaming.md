# Cowork assistant streaming (Pi → renderer)

Read this document **before** changing any file on the streaming path below. The pipeline is incremental end to end: Pi session deltas are translated into `UIMessageChunk` deltas, coalesced once, sequenced onto IPC, and applied in the renderer. Full text crosses IPC only on the exception paths in Invariant 4. Behavioral guards live in `tests/streamingGuards.test.ts`, `tests/streamingConsistency.test.ts`, and `tests/streamingConsistencyRecovery.test.ts`.

## End-to-end flow

```text
Pi SDK session events (message_update / message_end / toolcall_* / …)
        │
        ▼
piTranslate/piTranslateUiMessageChunk.ts   translate → UIMessageChunk[] (deltas only)
        │
        ▼
piRuntimeTurnEvents.ts   resolveCoworkStreamMessageId (text-*/reasoning-* only, tool-* dropped)
                         O(segments) append check; delta-less cumulative updates → synthesized deltas;
                         snapshot only on non-prefix rewrite;
                         message_end: closing chunks first, then finalize
        │  uiStreamChunk (delta chunks) · uiStreamSnapshot (exception paths only)
        ▼
piUiForwarder.ts         UiMessageChunkCoalescer (16 ms / 32 ms / 2048 chars) → PiUiEventSequencer
                         → webContents.send(CoworkStreamIpc.UiEvent)
        │
        ▼
coworkStreamPipeline.ts  PiUiEventSequenceTracker → LiveTextStore (chunks applied on arrival);
(renderer)               sequence gap → resetSession → requestStreamResync → endSessionResync
        │
        ▼
LiveTextStore            base + ordered parts, held outside Redux
        │
        ▼
AssistantBubble / ThinkingItem (useLiveMessageText) → StreamingMarkdownResponse
                         stable committed blocks + plain tail (the only renderer throttle)
        │
        ▼
Redux / SQLite           final MessageUpdate / markFinalAnswer — once per message, not per token
```

## Stage by stage

### Translator — `src/main/libs/agentEngine/piTranslate/piTranslateUiMessageChunk.ts`

Stateful per turn; emits incremental `UIMessageChunk`s (`text-*`, `reasoning-*`, `tool-input-available`, `tool-output-available`, `tool-output-error`). The `ai` package is a **type-only** dependency (`import type { UIMessageChunk }`, `ai@^6`); `@ai-sdk/provider-utils` was removed, and JSON parsing uses a local `safeJsonParse` (semantics after fastify/secure-json-parse, BSD-3 — independent implementation).

### Turn bridge — `src/main/libs/agentEngine/piRuntimeTurnEvents.ts`

- `resolveCoworkStreamMessageId` maps only `text-*` / `reasoning-*` chunks onto the Cowork answer/thinking message; `tool-*` chunks are dropped here, so a tool-only turn never creates an empty answer row.
- Append detection reads **lengths only**: translate the event first, then require `text.length === prior.length + deltaLen` **and** `PiStreamAccumulator.lastUpdateAppendedOnly(kind, deltaLen)` — every segment except the last kept its index and length, and the last one grew by exactly `deltaLen` (or is a new trailing segment of that length). Cost is O(segment count). No character is read: the accumulated text is a V8 cons string, and any `charCodeAt` / `endsWith` / `startsWith` flattens it in O(N) per delta (measured: G3 ratio ≈ 40). The check is structural, not byte-exact — an equal-length rewrite inside one segment is not detected; Pi delta events are prior+delta by definition, real rewrites arrive as delta-less updates, and `message_end` corrects the final text.
- Delta-less cumulative `message_update` (older producers; no `assistantMessageEvent`): if the new text extends the prior one (`startsWith`, O(N) but only on these events), `synthesizeTextDeltaChunks` / `synthesizeReasoningDeltaChunks` emit ordinary start/delta chunks (part transitions mirror the translator) and advance `streamedAssistantText`; an unchanged text emits nothing; anything else is a non-prefix rewrite (C8).
- Non-prefix rewrite: emit `closeOpenTextAndReasoningParts(...)`, reseed the translator with `setStreamedAssistantText`, emit one `uiStreamSnapshot` with the full rewritten text, then drop this event's `text-start` / `text-delta` (likewise reasoning) so no content is sent twice.
- `message_end`: forward the translator's closing chunks **before** finalizing; `message_end` remains the final authority for the complete text.

### Coalescer — `src/main/streaming/uiMessageChunkCoalescer.ts` (+ `streamLimits.ts`)

The **single** merge point before IPC: consecutive deltas of the same stream part merge within a 16 ms window, bounded by a 32 ms max age and 2048 characters. Every direct emit in the forwarder flushes the coalescer first, so ordering against snapshots and terminal events is preserved.

### Gateway — `src/main/appBootstrap/piUiForwarder.ts`

- `PiUiEventSequencer` sequences events; `broadcastUiEvent` sends `CoworkStreamIpc.UiEvent` to all windows; `PiUiRuntimeSnapshots.observe` records runtime metadata only, never body text.
- 2M budget (`CoworkRunPolicy.MaximumContentCharacters`): `sentCharsByMessage` clips each delta to the remaining budget; `truncatedMessages` drops every later delta until finalize.
- `uiStreamSnapshot` becomes a `ContentPatch` (chunked via `snapshotToContentPatches` above 60k) with metadata **`isStreaming: true`** — a LiveTextStore **base**; the renderer never commits it to Redux.
- Terminal channel: only runtime `messageUpdate` with `metadata.isStreaming === false` is forwarded. Body ≤ `CoworkRunPolicy.ContentChunkCharacters` (60k) → one `MessageUpdate`; larger → `ContentPatch` fan-out; 2M truncation adds `contentTruncated`. A byte-identical repeat of the same final body degrades to a metadata-only `MessageUpdate` (empty content, `metadataOnly: true`).
- **All non-final `messageUpdate` emissions are dropped here.** The 200 ms leading+trailing throttle on the in-process bus (`piAssistantTranscript.ts`) exists for IM and the coding room only (`recordBuiltinEvent` no-ops via a negative cache for non-coding-lane sessionIds); it never reaches UI IPC, so it is **not** a second UI throttle (this corrects the old Invariant 3). IM and the coding room register per-session streaming-text interest resolvers on the adapter (`registerStreamingTextInterestResolver`); sessions with no subscriber skip the non-final full-text bus entirely, and final `messageUpdate` events are never gated. SQLite keeps only checkpoints of the streaming body (`piAssistantTranscript.ts`): a checkpoint fires when the body has grown past the last persisted length by `STREAM_CHECKPOINT_GROWTH_CHARS` (32 KiB) — or, for replies that never reach that threshold, at least every `STREAM_CHECKPOINT_MIN_INTERVAL_MS` (3 s) while the body keeps growing — so write count and total bytes per turn stay bounded and a crash mid-stream loses at most one interval of text; a rewrite that shrinks the body writes immediately. The finalize write is authoritative.
- `cowork:stream:resync` (`CoworkStreamIpc.StreamResync`): flush the coalescer, then send one base snapshot per still-streaming message via `PiRuntimeAdapter.getLiveStreamTexts(sessionId)`.
- `sessionStopped` / `complete` / `error` flush the coalescer and clear all per-message bookkeeping.

### Renderer — `src/renderer/services/coworkStreamPipeline.ts`

Wired from `coworkService.setupStreamListeners`: `PiUiEventSequenceTracker` → `LiveTextStore` (StreamPart chunks are applied on arrival — the main-process coalescer already batches them — and the store schedules one rAF notification per frame of updates); a lifecycle watermark drops stale events and `CoworkContentBuffer` reassembles `ContentPatch` fan-out. Finalized messages enter Redux once, committed by `RafMessageUpdateBatcher` (terminal commits only). Non-final full-text `MessageUpdate` is dropped with a warning. Metadata-only terminal updates merge metadata without touching the committed body. On a sequence gap: `resetSession` → `onSequenceGap` (session recovery) → `requestStreamResync` (main pushes the base snapshots before the call settles) → `endSessionResync`.

### Live text & render

- `LiveTextStore` keeps per message a `base` (last authoritative snapshot) plus `parts` in insertion order; cached text is capped at 2M, entries are capped (256), and `awaitingBase` drops increments until a resync base lands. Streaming text never lives in Redux.
- `AssistantBubble` and `TurnBlock`'s `ThinkingItem` subscribe via `useLiveMessageText`; a streaming answer with an empty body still renders (fully blank → `AssistantBubble` returns `null`).
- `StreamingMarkdownResponse` is the **only** renderer throttle: the segmenter scans only appended input and commits stable Markdown prefixes in 8192-character batches to one Streamdown context; the growing tail stays plain text, with 48 ms trailing DOM updates once it exceeds 32768 characters (short text and rewrites remain immediate). The full response is re-parsed once on finalize.

## Invariants

1. **Increments on the wire:** routine streaming uses `StreamPart` events with `text-delta` / `reasoning-delta`; per-event payload size must not grow with total message length (G1/G3).
2. **Merge once upstream:** only `UiMessageChunkCoalescer` may batch deltas before IPC.
3. **Throttle once downstream:** only the LiveTextStore rAF notification + `StreamingMarkdownResponse` reduce render frequency. The throttled in-process `messageUpdate` bus and the SQLite growth checkpoints are not on the UI IPC path and do not count as UI throttles.
4. **Snapshots are exceptional:** full text on IPC only for non-prefix rewrites, 2M truncation, gap/attach resync, and terminal state — never for ordinary token streaming. Streaming snapshots (`isStreaming: true`) are LiveTextStore bases, not Redux commits.
5. **Terminal text exactly once:** the final body reaches the renderer once per message; duplicates degrade to metadata-only updates.

## Removed in this PR (do not re-introduce)

- `PiUiStreamReplayBuffer` + `CoworkStreamIpc.UiEventReplay`, `piUiEventBatcher.ts` (a second batching layer), `streamCompactReplay.ts` (derivative of Cherry Studio `buildCompactReplay.ts`, AGPL-3.0), `TextWorkerKind.Content` prefix diff, and `piEvents.parseNativeEvent`.
- Full event replay after attach is deferred to a follow-up PR; when it lands, overflow must write a snapshot first — replaying holes is forbidden.
- `CoworkContentProjection` remains but only serves `coworkRunBridge`: chunking oversized `message` events into `ContentPatch`es (`snapshotToContentPatches`) on the sequenced UiEvent stream. It performs no prefix diff and is **not** on the live streaming body path; there is no replay and no side channel — recovery reloads content through the session read.

## Historical lessons (do not repeat)

| Issue | What happened | Reference |
| --- | --- | --- |
| 200 ms full-text `messageUpdate` driving the UI | Whole assistant text re-emitted on a timer for Cowork rendering — O(N²) bytes per turn, fighting the delta path. | Dropped from UI IPC; the throttle survives only on the in-process IM/coding-room bus (subscriber-gated), and SQLite writes became growth/interval checkpoints (`piAssistantTranscript.ts`). |
| Worker prefix diff on snapshots | Full snapshot strings were diffed to synthesize "deltas"; CPU grew with message length. | `TextWorkerKind.Content` deleted; append detection is the length/segment-structure check in `piRuntimeTurnEvents.ts` + `piStreamAccumulator.ts`. |
| PR #1115 full snapshot IPC | Complete message body sent on every update. | Replaced by `StreamPart` deltas plus the single coalescer. |
| Pre-fix #1119 replay stack | Replay buffer, compact replay, and a second batcher layered replay/merge onto the send path. | Deleted; recovery is now delta-sequence-based resync via `CoworkStreamIpc.StreamResync`. |

## Prohibitions (hard rules)

- **禁止**在发送端先拼全文再 diff 出增量（"拼全文 → diff → 假 delta"）。
- **禁止**在 `UiMessageChunkCoalescer` 之外增加第二层发送端节流/合并。
- **禁止**通过 IPC 把全文快照当作常规流式更新（非终态 `MessageUpdate` / 逐 token 大段 `ContentPatch`）。
- **禁止**把 runtime 非终态 `messageUpdate` 转发到 UI IPC（forwarder 必须丢弃）。
- **禁止**在渲染端对每个 token 全量重跑 Markdown/Shiki（稳定块 + plain tail 是唯一节流）。
- **禁止**放宽 G1–G4 / C1–C10 断言来掩盖回归；修链路，不修测试。

## Porting notes

| File | Origin |
| --- | --- |
| `piTranslate/piTranslateUiMessageChunk.ts` | **Ported & rewritten** from `packages/harness-pi/src/pi-translate.ts` (`@ai-sdk/harness-pi@1.0.156`, Apache-2.0). Deviations: emits `UIMessageChunk` (tool-call → `tool-input-available`; tool-result → `tool-output-available`; `isError` → `tool-output-error`); no `finish-step` / compaction (session layer owns lifecycle); `toolcall_end` emits no `tool-input-end` (renderer does not stream tool input; `tool-input-available` carries the full input); `nativeName` removed; `tool_result` carries `providerExecuted`; local `safeJsonParse`; added `closeOpenTextAndReasoningParts` / `setStreamedAssistantText`. |
| `piTranslate/piEvents.ts` · `piEvents.test.ts` | **Ported** from `packages/harness-pi/src/pi-events.ts` / `pi-events.test.ts` (same package tag, verified on GitHub). |
| `piTranslate/piTranslateUtils.ts` | **Ported** from `packages/harness-pi/src/pi-utils.ts`. |
| `piTranslate/piTranslateUiMessageChunk.test.ts` · `piTranslateUiMessageChunk.tools.test.ts` | **Ported & rewritten** from `packages/harness-pi/src/pi-translate.test.ts` (text/reasoning/toolcall cases; finish-step/usage/compaction excluded). |
| `src/main/streaming/uiMessageChunkCoalescer.ts` · `streamLimits.ts` | **New**; design reference Cherry Studio `WebContentsListener` (AGPL-3.0) — independent implementation, no code copied. |
| `liveTextStore.ts` · `coworkStreamPipeline.ts` · `piStreamChunkEmit.ts` · resync IPC · guard/consistency tests + harness | **New.** |

## Tests

All streaming tests are behavioral (no source-text scanning) and drive **production code** through `tests/helpers/streamingPipelineHarness.ts` (PiRuntimeAdapter testHarness → real forwarder → real renderer pipeline / LiveTextStore / Redux), ≥400 seeds in total. G3, C1–C7, C8 and C9 fail on the code before their respective fixes (C10 guards the rewrite path) and pass after this PR.

| File | Coverage |
| --- | --- |
| `tests/streamingGuards.test.ts` | G1: whole-turn IPC bytes ≤ 1.3× body + 400× events (the event count itself proves coalescing); G2: no `MessageUpdate`/`ContentPatch` on IPC before `message_end`, and runtime non-final `messageUpdate` never reaches IPC; G3: 10 KB vs 1 MB per-delta main-process CPU median ratio < 1.5; G4: 16 ms window merge upper/lower bounds |
| `tests/streamingConsistency.test.ts` | C1: terminal text, 120 seeds; C2: non-prefix rewrite; C3: interleaved thinking ×200; C4: 2M truncation; C8: delta-less cumulative updates stream as deltas (no `ContentPatch` before `message_end`), 20 seeds |
| `tests/streamingConsistencyRecovery.test.ts` | C5: gap resync / mid-stream attach; C6: duplicate & out-of-order delivery; C7: per-frame prefix property |
| `tests/streamingConsistencyDeltaless.test.ts` | C9: delta-less thinking + answer growth stays on deltas (no `ContentPatch`); C10: delta-less non-prefix rewrite sends only `isStreaming: true` base patches, then streams on |
| `src/main/libs/agentEngine/piTranslate/*.test.ts` | Ported translator cases |

## Bench

`bun run bench:stream [--render]` (virtual clock) compares A (main's pre-fix chain fixture) vs C (stage 1) vs D (stage 1+2) and writes JSON results (default `bench-results/stream-bench.json`, git-ignored) — see `scripts/bench/`. Group A is capped at 500 KB by default (`--a-max-size`) because its per-update full-text diff is quadratic. At low token rates D sends more IPC events and bytes than A (one sequenced event per token vs one 200 ms patch; the per-event envelope dominates), in exchange for ~30 ms instead of ~200 ms end-to-end latency and per-event cost independent of message length.

## Known limitations

- The append check is conservative: one event that grows the last segment **and** opens a new one is classified as a rewrite and sends a base snapshot (Pi's embedded session never does this; correctness is unaffected).
- Terminal de-duplication compares against the last forwarded final body only: an A → B → A sequence re-sends A.
- `ContentPatch` revisions still come from two generators (the forwarder and `CoworkContentProjection`); both ride the sequenced UiEvent stream and never share a messageId.
- Resync relies on Electron delivering the `webContents.send` events issued inside the `cowork:stream:resync` handler before the invoke reply; an explicit resync-done event would remove that dependency.

## Related IPC

- `CoworkStreamIpc.UiEvent` — sequenced streaming and lifecycle events
- `CoworkStreamIpc.StreamResync` — renderer-triggered base-snapshot resync
- `CoworkStreamIpc.RuntimeSnapshots` — runtime metadata snapshots (not the body stream)
