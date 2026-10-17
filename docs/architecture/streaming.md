# Cowork assistant streaming (Pi → renderer)

Read this document **before** changing any file on the streaming path listed below. The design intentionally avoids re-sending full message text on every token; regressions are guarded by behavioral tests in `tests/streamingGuards.test.ts` and `tests/streamingConsistency.test.ts`.

## End-to-end flow

```text
Pi SDK session events (text_delta, thinking_delta, toolcall_*, …)
        │
        ▼
piTranslateUiMessageChunk.ts   translatePiSessionEventToUiChunks → UIMessageChunk[]
        │
        ▼
piRuntimeTurnEvents.ts         resolveCoworkStreamMessageId; emit uiStreamChunk / uiStreamSnapshot*
        │
        ▼
piUiForwarder.ts               UiMessageChunkCoalescer (main-process, once)
        │
        ▼
PiUiEventSequencer + PiUiStreamReplayBuffer
        │
        ▼
IPC CoworkStreamIpc.UiEvent (PiUiEventType.StreamPart | ContentPatch*)
        │
        ▼
Renderer cowork.ts             rAF batch StreamPart → LiveTextStore.applyChunk
        │
        ▼
StreamingMarkdownResponse.tsx  stable committed blocks + plain-text tail (renderer throttle, once)
        │
        ▼
Redux / SQLite                 final messageUpdate on turn complete (not per token)
```

\* `uiStreamSnapshot` / `ContentPatch` are **exception** paths only (see invariants).

## Layer responsibilities

| Layer | Location | Responsibility |
| --- | --- | --- |
| Translator | `src/main/libs/agentEngine/piTranslate/piTranslateUiMessageChunk.ts` | Map Pi 1.3.x session events to **`UIMessageChunk`** (`ai` package). Stateful per turn; emits **incremental** chunks only. |
| Turn bridge | `src/main/libs/agentEngine/piRuntimeTurnEvents.ts` | Attach Cowork message ids; forward chunks to the IPC forwarder; emit snapshot patches only on non-prefix accumulator jumps. |
| Coalescer | `src/main/streaming/uiMessageChunkCoalescer.ts` | Merge consecutive deltas of the same stream part within time/size bounds (**single merge point before IPC**). |
| Gateway | `src/main/appBootstrap/piUiForwarder.ts` | Sequence events, ring buffer for replay, broadcast `StreamPart` to renderer. |
| Live text | `src/renderer/services/liveTextStore.ts` | Hold in-flight text **outside Redux**; apply `text-delta` / `reasoning-delta` incrementally. |
| Render | `src/renderer/components/cowork/components/StreamingMarkdownResponse.tsx` | **Single** render-side throttle: parse stable prefix once; tail as plain text until finalize. |

## Invariants

1. **Increments on the wire:** Routine assistant streaming uses `PiUiEventType.StreamPart` with delta chunks (`text-delta`, `reasoning-delta`, …). Payload size per event must not grow with total message length (see guard tests).
2. **Merge once upstream:** Only `UiMessageChunkCoalescer` may batch deltas before IPC. Do not add a second coalescer/throttle on the main process send path.
3. **Throttle once downstream:** Only the renderer pair `rafStreamPartBatcher` + `StreamingMarkdownResponse` may reduce render frequency. Do not re-introduce main-process `messageUpdate` throttling for the Cowork UI path.
4. **Snapshots are exceptional:** Full-text `ContentPatch` / `uiStreamSnapshot` is for **non-append** text (accumulator reset), **truncation**, **attach/replay recovery**, or **finalize** alignment—not for ordinary token streaming.
5. **IM / legacy:** `messageUpdate` may still carry full text for non-Cowork consumers; that must not become the primary Cowork renderer IPC path again.

## Historical lessons (do not repeat)

| Issue | What happened | Reference |
| --- | --- | --- |
| 200 ms full-text `messageUpdate` throttle | Main process emitted entire assistant text on a timer; wasted bandwidth and fought Pi deltas. | Removed in streaming Phase 1/2 (`piAssistantTranscript.ts`); commit `1915c318`. |
| Worker prefix diff on snapshots | Compared full snapshot strings to synthesize “deltas”; fragile and CPU-heavy. | Removed from `coworkContentProjection.ts`; snapshot patches only via `snapshotToContentPatches`. |
| PR #1115 full snapshot IPC | Sending complete message body on every update → **O(N²)** total bytes over a turn. | Rejected approach; this PR replaces with `StreamPart` + coalescer. |

## Prohibitions (hard rules)

- **禁止**在发送端先累积全文再计算增量（“拼全文 → diff → 假 delta”）。
- **禁止**在 coalescer 之外再增加第二层发送端节流/合并（含重新引入 200 ms 全文 `messageUpdate` 驱动 UI）。
- **禁止**通过 IPC 把全文快照当作常规流式更新（`MessageUpdate` / 大段 `ContentPatch` 逐 token 推送）。
- **禁止**在渲染端对每个 token 全量重跑 Markdown/Shiki（见 `StreamingMarkdownResponse` 稳定块 + plain tail）。

## Porting notes

- Translator logic is ported from Vercel `packages/harness-pi/src/pi-translate.ts` (`@ai-sdk/harness-pi@1.0.156`, Apache-2.0); see file headers under `piTranslate/`.
- Coalescer/replay limits follow Cherry Studio `WebContentsListener` **design only** (AGPL-3.0 — no code copy); see headers under `src/main/streaming/`.

## Tests

| File | Purpose |
| --- | --- |
| `tests/streamingGuards.test.ts` | IPC byte linearity, no snapshot on monotonic streams, constant per-delta work |
| `tests/streamingConsistency.test.ts` | ≥420 random streams; prefix/snapshot step consistency |
| `src/main/streaming/*.test.ts` | Coalescer/replay unit tests |
| `src/main/libs/agentEngine/piTranslate/*.test.ts` | Translator parity (ported cases) |

Do **not** weaken guard assertions to greenwash a regression; fix the pipeline instead.

## Related IPC

- `CoworkStreamIpc.UiEvent` — live sequenced events
- `CoworkStreamIpc.UiEventReplay` — ring buffer replay after attach
- `CoworkStreamIpc.RuntimeSnapshots` — runtime metadata snapshots (not assistant text streaming)
