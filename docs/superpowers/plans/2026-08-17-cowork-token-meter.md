# Cowork Token Meter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add DeepSeek Harness-style context details and durable session statistics to the shared Cowork prompt input for both Work and direct chat.

**Architecture:** Store normalized per-message timing and usage metadata, then fold the session's messages into a renderer-only statistics snapshot. A focused `ContextUsageIndicator` presents the latest reliable context reading and estimates its composition; a separate `SessionStatsLine` renders optional statistics groups without owning transport behavior.

**Tech Stack:** TypeScript, React, Redux selectors, shadcn/ui `Popover`, `Tooltip`, `Progress`, Vitest, Tailwind CSS v4.

---

## File Structure

- Create `src/renderer/components/cowork/sessionStats.ts`: pure metadata validation, aggregation, compact formatting, cache-hit calculation, and context composition estimation.
- Create `src/renderer/components/cowork/sessionStats.test.ts`: test the aggregation and every unavailable-data rule.
- Create `src/renderer/components/cowork/SessionStatsLine.tsx`: one-line renderer, clipping detection, and tooltip.
- Create `src/renderer/components/cowork/SessionStatsLine.test.tsx`: test visible groups and clipped-tooltip behavior.
- Modify `src/renderer/types/cowork.ts`: add optional per-message timing metadata.
- Modify `src/main/coworkStore.ts`: preserve the matching persisted timing metadata shape.
- Modify `src/main/libs/agentEngine/piRuntimeAdapter.ts`: record Work request timing, first visible text time, and tool duration into message metadata.
- Modify `src/renderer/services/chatChatTransport.ts`: emit a normalized direct-chat metrics chunk from local request boundaries.
- Modify `src/renderer/components/cowork/CoworkView.tsx`: retain direct-chat metrics beside its existing context chunk.
- Modify `src/renderer/components/cowork/ContextUsageIndicator.tsx`: consume the shared fold and present a shadcn Popover.
- Modify `src/renderer/components/cowork/CoworkPromptInput.tsx`: mount the one shared statistics line below the existing input in both layouts.
- Modify `src/renderer/services/i18n.ts`: add Chinese and English labels.

### Task 1: Define And Test Session Statistics Fold

**Files:**
- Create: `src/renderer/components/cowork/sessionStats.test.ts`
- Create: `src/renderer/components/cowork/sessionStats.ts`

- [ ] **Step 1: Write failing aggregation tests**

```ts
test('aggregates verified usage and complete metrics from assistant and tool messages', () => {
  expect(getSessionStats(messages)).toMatchObject({
    turns: 2, steps: 3, inputTokens: 120, outputTokens: 40,
    cacheReadTokens: 30, llmDurationMs: 4_000, toolDurationMs: 900,
    ttftAverageMs: 400, throughputTokensPerSecond: 20,
  });
});

test('omits cache, throughput, and TTFT when their provider data is unavailable', () => {
  expect(getSessionStats(messages)).toMatchObject({ cacheHitPercent: null, ttftAverageMs: null });
});
```

- [ ] **Step 2: Verify the test fails**

Run: `npm test -- sessionStats`

Expected: FAIL because `sessionStats.ts` does not exist.

- [ ] **Step 3: Add the minimal pure fold**

```ts
export function getSessionStats(messages: CoworkMessage[]): SessionStats {
  // Count user-owned turns, valid assistant steps and tool pairs; sum only
  // finite non-negative metadata. Return null for a value with no samples.
}
```

Use `input + cacheRead + cacheWrite` as billed input and calculate cache hit as `cacheRead / billedInput`. Derive throughput only from assistant messages with both `outputTokens` and a complete decode span.

- [ ] **Step 4: Verify the focused test passes**

Run: `npm test -- sessionStats`

Expected: PASS.

- [ ] **Step 5: Commit the fold**

```bash
git add src/renderer/components/cowork/sessionStats.ts src/renderer/components/cowork/sessionStats.test.ts
git commit -m "feat(cowork): aggregate session usage metrics"
```

### Task 2: Persist Work-Mode Timing Metadata

**Files:**
- Modify: `src/renderer/types/cowork.ts`
- Modify: `src/main/coworkStore.ts`
- Modify: `src/main/libs/agentEngine/piRuntimeAdapter.ts`
- Test: `src/main/libs/agentEngine/piRuntimeAdapter.test.ts`

- [ ] **Step 1: Write failing adapter tests**

```ts
expect(assistant.metadata?.metrics).toEqual({
  requestStartedAt: 1_000,
  firstVisibleTextAt: 1_250,
  completedAt: 2_000,
});
expect(toolResult.metadata?.metrics?.toolDurationMs).toBe(600);
```

- [ ] **Step 2: Verify the adapter test fails**

Run: `npm test -- piRuntimeAdapter`

Expected: FAIL because the metadata has no `metrics` field.

- [ ] **Step 3: Add a normalized optional `metrics` field**

Define `requestStartedAt`, `firstVisibleTextAt`, `completedAt`, and `toolDurationMs` as optional non-negative numeric metadata. In the adapter, capture request start at `message_start`, first visible text at the first non-empty `text_delta`, complete the assistant record at `message_end`, and map each tool-call id to its start time until `tool_execution_end`.

- [ ] **Step 4: Verify adapter tests pass**

Run: `npm test -- piRuntimeAdapter`

Expected: PASS.

- [ ] **Step 5: Commit Work instrumentation**

```bash
git add src/renderer/types/cowork.ts src/main/coworkStore.ts src/main/libs/agentEngine/piRuntimeAdapter.ts src/main/libs/agentEngine/piRuntimeAdapter.test.ts
git commit -m "feat(cowork): persist work session timing metrics"
```

### Task 3: Emit And Retain Direct-Chat Metrics

**Files:**
- Modify: `src/renderer/services/chatChatTransport.ts`
- Modify: `src/renderer/components/cowork/CoworkView.tsx`
- Test: `src/renderer/services/chatChatTransport.test.ts`

- [ ] **Step 1: Write failing transport test**

```ts
expect(chunks).toContainEqual({
  type: 'data-session-metrics',
  data: { requestStartedAt: 1_000, firstVisibleTextAt: 1_200, completedAt: 2_000 },
});
```

- [ ] **Step 2: Verify the test fails**

Run: `npm test -- chatChatTransport`

Expected: FAIL because the stream emits no metrics chunk.

- [ ] **Step 3: Emit metrics and merge them with the direct assistant snapshot**

Record `Date.now()` at request construction, set first-visible time at the first text delta, emit the metrics data chunk before `finish`, and attach validated metrics to the corresponding direct-chat assistant message in `CoworkView` alongside existing `data-context` usage.

- [ ] **Step 4: Verify direct-chat tests pass**

Run: `npm test -- chatChatTransport directChatSnapshot`

Expected: PASS.

- [ ] **Step 5: Commit direct-chat instrumentation**

```bash
git add src/renderer/services/chatChatTransport.ts src/renderer/services/chatChatTransport.test.ts src/renderer/components/cowork/CoworkView.tsx src/renderer/components/cowork/directChatSnapshot.test.ts
git commit -m "feat(cowork): measure direct chat session timing"
```

### Task 4: Build The Shadcn Context Popover

**Files:**
- Modify: `src/renderer/components/cowork/ContextUsageIndicator.tsx`
- Modify: `src/renderer/services/i18n.ts`
- Test: `src/renderer/components/cowork/ContextUsageIndicator.test.tsx`

- [ ] **Step 1: Write failing UI tests**

```tsx
fireEvent.click(screen.getByRole('button', { name: /context used/i }));
expect(screen.getByRole('dialog')).toHaveTextContent('~32K / 128K');
expect(screen.getByText(/system prompt/i)).toBeVisible();
```

- [ ] **Step 2: Verify the test fails**

Run: `npm test -- ContextUsageIndicator`

Expected: FAIL because the current hover card has no click-open dialog or composition rows.

- [ ] **Step 3: Replace the hover card with shadcn primitives**

Use `Popover`, `PopoverTrigger`, `PopoverContent`, `Button`, `Progress`, and `Tooltip`. Display the trigger's SVG ring, a popover header, a 4px progress indicator, and `~`-prefixed estimated composition rows. Omit unavailable rows and fall back to one progress color. Add both `zh` and `en` translation keys.

- [ ] **Step 4: Verify UI tests pass**

Run: `npm test -- ContextUsageIndicator`

Expected: PASS.

- [ ] **Step 5: Commit the context popover**

```bash
git add src/renderer/components/cowork/ContextUsageIndicator.tsx src/renderer/components/cowork/ContextUsageIndicator.test.tsx src/renderer/services/i18n.ts
git commit -m "feat(cowork): add context usage popover"
```

### Task 5: Render And Test The Shared Statistics Line

**Files:**
- Create: `src/renderer/components/cowork/SessionStatsLine.tsx`
- Create: `src/renderer/components/cowork/SessionStatsLine.test.tsx`
- Modify: `src/renderer/components/cowork/CoworkPromptInput.tsx`

- [ ] **Step 1: Write failing line tests**

```tsx
expect(screen.getByText(/2 turns.*3 steps.*cache hit 20%/i)).toBeVisible();
expect(screen.queryByText(/input/i)).toBeNull(); // usage is unavailable
```

- [ ] **Step 2: Verify the test fails**

Run: `npm test -- SessionStatsLine`

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the line and mount it below both prompt layouts**

Use the pure fold, a no-wrap `text-xs` line, `ResizeObserver` clipping detection, and a disabled-until-clipped shadcn `Tooltip`. Mount one `SessionStatsLine` after the prompt footer rather than duplicating it in either toolbar branch.

- [ ] **Step 4: Verify focused UI tests pass**

Run: `npm test -- SessionStatsLine CoworkPromptInput`

Expected: PASS.

- [ ] **Step 5: Commit the shared renderer**

```bash
git add src/renderer/components/cowork/SessionStatsLine.tsx src/renderer/components/cowork/SessionStatsLine.test.tsx src/renderer/components/cowork/CoworkPromptInput.tsx
git commit -m "feat(cowork): show shared session statistics"
```

### Task 6: Verify The Completed Feature

**Files:**
- Modify only if failures require a narrow correction.

- [ ] **Step 1: Run static and focused checks**

Run:

```bash
git diff --check
npm test -- sessionStats piRuntimeAdapter chatChatTransport ContextUsageIndicator SessionStatsLine
npm run lint
```

Expected: all commands exit 0.

- [ ] **Step 2: Run Electron manual verification**

Run: `npm run electron:dev`

Verify both Work and direct chat show the same context trigger, the click-open details close correctly, missing provider usage suppresses only token-dependent groups, and the stats line behaves correctly in light, dark, and narrow layouts.

- [ ] **Step 3: Commit final corrections**

```bash
git add src/renderer/components/cowork/sessionStats.ts src/renderer/components/cowork/sessionStats.test.ts src/renderer/components/cowork/SessionStatsLine.tsx src/renderer/components/cowork/SessionStatsLine.test.tsx src/renderer/components/cowork/ContextUsageIndicator.tsx src/renderer/components/cowork/ContextUsageIndicator.test.tsx src/renderer/components/cowork/CoworkPromptInput.tsx src/renderer/components/cowork/CoworkView.tsx src/renderer/services/chatChatTransport.ts src/renderer/services/chatChatTransport.test.ts src/renderer/services/i18n.ts src/renderer/types/cowork.ts src/main/coworkStore.ts src/main/libs/agentEngine/piRuntimeAdapter.ts src/main/libs/agentEngine/piRuntimeAdapter.test.ts
git commit -m "fix(cowork): polish token meter behavior"
```
