# Vendored SoL-Pi local patches (relative to the pinned upstream revision)

The vendor tree (`vendor/sol-pi/`, pin in `vendor/UPSTREAM_COMMIT`, upstream
commit `22277b7e`) is **not** byte-identical to upstream anymore. This file is
the authoritative record of every local divergence, why it exists, and who owns
the maintenance of the divergence. Attribution files (`LICENSE.MIT`,
`THIRD_PARTY_NOTICES.md`, `UPSTREAM_COMMIT`) remain untouched upstream copies.

When re-vendoring a newer upstream revision, re-apply these patches or drop
them deliberately; never overwrite the tree blindly.

## 1. `runtime-paths.ts` — stable per-session runtime root

- **Upstream:** `runtimeRoot(ctx)` = `join(sessionDir, "sol-pi", sessionId)`,
  where `sessionId` is the Pi session's own id.
- **Local:** `join(sessionDir, "sol-pi")` (the Pi session-id component and its
  validation were removed).
- **Why:** this app runs Pi sessions with an in-memory SessionManager whose id
  is a fresh uuid per incarnation. With the upstream shape, every
  stop/continue/rebuild of the same cowork session re-archived identical
  content into a brand-new subtree (unbounded duplication; deep-acceptance
  finding d4-f2). The app-owned wrapper (`solPiSessionScope.ts`) already scopes
  `sessionDir` per cowork session, so the extra component only duplicated
  data. Objects are content addressed, so the stable root deduplicates them
  across incarnations.
- **Interacts with:** nothing upstream depends on the removed component; the
  archived path shape is internal to the extension.

## 2. `extensions/observation-pack/index.ts` — projection cache + archive budget

- **Upstream:** on every provider request (`pi.on("context")`), every pure-text
  tool result is re-hashed (two sha256 per message) and its archived object is
  re-verified with a whole-file read + hash on EEXIST. Measured ~9.6ms per 1MiB
  archived observation per request on the Electron main-process agent-stream
  path, linear in total archived bytes (finding d4-f1); archives were also
  unbounded (d4-f2).
- **Local:** per-extension-instance projection cache (WeakMap by message object
  plus a tool-call-id map with a cheap UTF-16-length reuse guard, 1024-entry
  FIFO cap, no full text retained); hashing/archiving runs once per observation
  per extension instance — i.e. per Pi-session incarnation, so the first
  provider request after an in-process session rebuild (app restart, stop,
  topology-change recreation) re-pays the EEXIST verify once per archived
  observation instead of on every request. The reuse guard compares only the
  text's UTF-16 unit total: a same-length content change under a reused
  tool-call id would be served the old projection. That is accepted because
  the Pi SDK mints a fresh tool-call id per provider tool_use and nothing
  rewrites an archived toolResult's content in place; if a future extension
  does mutate tool results via the message_end replacement hook, the guard
  must be strengthened (e.g. key the cache by content hash). New archives are
  bounded by a per-runtime-root byte budget (`DEFAULT_ARCHIVE_BUDGET_BYTES`
  = 256 MiB, overridable via options); when the budget is reached, new large
  results simply stay in full context (fail-open, one warn per root,
  referenced archives are never deleted).
- **Measured:** steady state per provider request (10 x 1MiB archived results)
  went from 99.19ms / ~20MiB re-hashed / 2 object reads per message to 0
  hashed bytes and 0 object reads; extension cost under the real runner
  (which clones messages per request) is ~0.85ms plus the runner's own clone.
  First-sight hashing (~10ms/MiB) remains, once per observation per process —
  see `reports/` remediation logs for the probe.
- **API surface:** `createObservationPackExtension(options?)` /
  `registerObservationPack(pi, options?)` gained an optional
  `ObservationPackOptions { archiveBudgetBytes? }` (additive, defaults keep
  upstream behavior except the cap).

## 3. `extensions/observation-pack/observation.ts` — helpers for the above

- **Local additions:** exported `textFromResult` (was module-private), and new
  `objectSize(path)` / `archiveBytes(root)` async helpers (lstat/readdir only,
  no recursion beyond the objects directory) used by the cache and budget
  accounting. `ensureStored` itself is unchanged.

## 4. `index.ts` (vendor root) — runtime options plumbing

- **Local:** `SolPiRuntimeOptions { archiveBudgetBytes?, bashOptions?,
  prepareObservation?, hashBuffer?, fileHash? }` (compute hooks added by
  patches 6/9) and optional `options` parameters on
  `createSolPiExtension(loadConfig?, options?)` and
  `registerConfiguredFeatures(pi, config, options?)`, threaded to the
  observation-pack and action-fusion registrars.
- **Why:** the embedding app must pass app-owned settings into the vendored
  extensions; upstream only discovers config from `sol-pi.json` files, which
  this app deliberately bypasses. `bashOptions` carries the app's resolved
  shell (Windows PortableGit git-bash) into Action Fusion's fused `then_run`
  commands so they agree with plain `bash` tool calls (finding d2-f1).

## 5. `extensions/action-fusion/index.ts` — options-aware registrar

- **Local:** `registerActionFusion(pi, options = {})` forwards `options` to
  `createActionFusionExtension(options)` (the factory already accepted
  `bashOptions` upstream; only the registrar dropped it).

## Patch provenance

Authored in the solpi-dynamic-remediation round (2026-09-12) from the
deep-acceptance findings d2-f1/d4-f1/d4-f2; recorded per repo policy that
vendored trees carry an explicit divergence ledger instead of silent edits.

## 6. `extensions/observation-pack/index.ts` — off-thread compute + ledger batching/rotation + budget release

- **Local:** `ObservationPackOptions` gained additive `prepareObservation?`,
  `hashBuffer?` and `ledgerMaxBytes?`. When `prepareObservation` is present,
  the first-sight `createObservation` + `placeholderFor` move off the
  embedding app's event loop (a bounded worker pool loads the same vendored
  module via jiti, so ids/hashes/excerpts stay byte-identical); returning
  `null` fails open exactly like the archive budget. `hashBuffer` moves the
  EEXIST content re-hash off-thread. The per-request ledger writes are
  collected and appended in ONE call (previously one append per archived
  observation per request), and the ledger rotates at `ledgerMaxBytes`
  (default 1 MiB, one `.1` generation). Both ledger call sites (the batched
  projection append and the recall record) fail open: the ledger is
  diagnostics-only, so an append error is logged and must never fail the
  projection or the recall. `releaseArchiveBudget(root)` drops
  the module-level budget entry so a recreated session root re-measures from
  disk (session teardown calls it through the app's storage scope).
- **Why:** the repository's Main Process / Worker Boundary rules forbid
  whole-file hashing/CPU-bound transforms on the agent-stream path
  (cross-review P2-2), and the unbounded, unbudgeted per-request ledger
  growth was P2-3. Rotation loses no references: the ledger is
  diagnostics-only — recall reads objects, never the ledger.
- **Boundaries:** crash between projection and the batched append loses that
  request's diagnostic lines only. Worker unavailability keeps the vendored
  in-process defaults (behavior-identical, just on the main thread).

## 7. `extensions/observation-pack/observation.ts` — injectable verify hash

- **Local:** `ensureStored(observation, verifyHash?)` optionally routes the
  EEXIST whole-file re-hash through the caller's (worker-backed) hash;
  defaults keep the local sync hash.

## 8. `extensions/observation-pack/ledger.ts` — memoized mkdir, batched append, rotation, chain resilience

- **Local:** the ledger closure memoizes its directory creation, accepts one
  entry or an array (single appendFile per call), serializes writes, tracks
  bytes and rotates at the ceiling (see patch 6). The serialization chain is
  failure-isolated: the awaiting caller observes its own append's error, but
  the chain itself continues from a settled state, so one transient append
  failure (ENOSPC, vanished directory) cannot poison every later append for
  the rest of the session.

## 9. `extensions/action-fusion/then-run.ts` + `index.ts` — injectable interference hash

- **Local:** `assertUnchangedBeforeCommand(path, yield?, hashFile?)` and
  `executeMutationThenRun({..., fileHash?})` / `ActionFusionOptions.fileHash`
  optionally route the two interference hashes through the caller's
  (worker-backed) sha256; defaults keep the local implementation. The double
  read stays — it IS the interference check (cross-review P2-2 asked for it
  to leave the main thread, not to disappear).

## Patch provenance (continued)

Patches 6-9 authored in the pr762-claude-fix round (2026-09-12) from
cross-review findings P2-2/P2-3; the ledger chain-resilience and fail-open
call-site guards (patches 6/8) were added in the pr762-claude-verify round the
same day after adversarial re-review found a single failed append could poison
the serialized chain for the session. Options stay additive and absent options
keep the previous compute paths, with one deliberate behavioral change: the
ledger now batches appends and rotates by default (patch 8) — the previous
unbounded per-observation append shape is intentionally not reproducible.
