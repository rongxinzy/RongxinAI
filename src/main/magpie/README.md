# Bundled local CLI management

The host executes the Magpie binary built from the pinned upstream source and
Work caller patch in `resources/magpie/`. Its MIT notice ships with the resource.

## Explicit enablement

Creating `MagpieManager` and requesting `status()` do not start a process.
The product must explain that upstream startup synchronizes previously managed
CLI configuration (`agent.SyncCatalog`) and that `/api/state` may follow/apply
configuration (`a.Follow`). Only the user's **Enable local CLI management**
action calls `start()`. Do not label `agents()` a read-only scan.
Host startup reapply runs against that gateway instance. CLI edits wait for it to
settle. Quit cancels the remaining startup work and drains requests already sent.

Production retains HOME/USERPROFILE for real local CLI management, while
XDG_CONFIG_HOME puts Magpie's own files below the supplied app-private directory.
Account discovery defaults off via MAGPIE_NO_ACCOUNTS=1. Upstream PostHog telemetry
stays off through `DO_NOT_TRACK=1` and persisted `noStats` / `noUsageStats` (those
flags are not the local usage ledger; `usage.jsonl` is still written). The gateway
and Web UI bind to loopback.
The host does not copy application provider credentials into Magpie. Its ephemeral
Web key remains in Main; renderer IPC receives only projected preferences and
provider summaries, never the key or the full upstream settings document.

The host verifies source pin/platform/version and the packaged binary SHA256 in
a cancellable worker before spawning. macOS and Windows manifests include the
post-signing binary digest; build provenance retains the pre-signing digest. Missing or changed
resources fail closed. Concurrent starts share a single launch. If CLI restoration on
quit is enabled, it runs within the time available before the gateway stop. Shutdown
requests upstream's POST /api/window/quit and terminates the owned process if needed. On Windows,
the bundled job runner assigns Magpie to a Job Object before it executes.
The job runner terminates its descendants when the desktop or Magpie exits.
Magpie cannot launch on Windows without the job runner.

## Narrow renderer contract

`src/shared/magpie/types.ts` defines status/start/stop/models/agents/setModel,
providers CRUD and preferences. `src/shared/magpie/preferences.ts` defines the
renderer-safe preference projection and patch. The IPC registrar requires the
application's existing trusted main-frame predicate. It does not provide a
generic URL or HTTP proxy.

- models: official GET /v1/models, projected id/owned_by only
- agents: official GET /api/state + GET /api/agents/cli, projected identity,
  missing-CLI flag, connection flag, versions and model fields only
- setModel: explicit user apply action, official POST /api/set with Agent/Field/Value
- preferences: official GET /api/settings projected to non-secret fields
- updatePreferences: merge from a fresh document in Main for POST /api/settings.
  Bare model IDs and disabled models use their dedicated native settings routes.
- routing groups / usage: official `/api/groups*`, `/api/usage*`, `/api/usage/quotas`,
  and budget fields on `/api/settings`, projected by `MagpieRoutingUsageService`
  (owned by `MagpieManager`, registered alongside model IPC)

The composition root closes IPC admission at quit and drains active settings
requests before restoring CLI configuration if the quit budget permits.
`window.electron.magpie` derives its methods and types from the shared channels
and contract. Do not persist an auto-start flag.

## Verification

`bun x vitest run src/main/magpie` covers process ownership, explicit enablement,
credential omission, trusted manifest, safe projection and cancellation.
After building the target binary, run
`ZHIYUAN_MAGPIE_SMOKE=1 bun x vitest run src/main/magpie`.
The opt-in smoke uses a temporary HOME to exercise local CLI configuration and
native inference. It covers Companion history recovery, Work streaming through
direct models and routing groups, and rejection before upstream on denied Work.
It uses disposable model endpoints and credentials.

The patched runtime passed native tests on macOS arm64. Linux and Windows still
require native execution and applicable signing checks for this pin.

## Unified model source

Magpie is now the only user-configurable Provider/credential/catalog/router source.
`modelService.ts` holds only the application's selected model id and projects the
live gateway catalog. Main supplies selection persistence, the enterprise access
predicate, and `beforeCatalog` to synchronize host-managed enterprise/GPU sources.
Catalog models, routing groups and provider metadata are published together.
Refreshes belong to the current gateway process even when its port is reused,
and an older refresh cannot replace a newer completed read.
The session runtime receives this model service during startup. Cowork and
Companion use it through Pi and select models by their exact gateway id.
Pi gets protocol compatibility from the catalog model's provider identity,
including when the selected gateway id is a bare alias. Routing groups keep
their own gateway model metadata.
There is no legacy AppConfig credential import, old-provider fallback, or implicit
selection of the first model.

`catalog()` is read-only while stopped and never starts a process. The existing
explicit enable action must explain the upstream CLI synchronization side effects.
`start()` persists explicit service enablement separately from subscription consent.
Actual Work/Chat/Cron execution may call `ensureRunning()` to lazily start or recover
the owned process only after that consent, with concurrent starts coalesced. Failed
startup surfaces an actionable error without another provider fallback. `shutdown()`
stops the process on normal application exit without clearing consent; only the UI
`stop()` action persists disabled. Catalog/history reads never implicitly enable or
start the service. Enterprise execution uses the same Pi-to-Magpie path and a
main-process credential transport bound to the enterprise extension.

Native endpoints, context/output limits, reasoning levels and image capability
are projected from `/v1/models`. Responses and Anthropic-native models keep their
native wire protocol; routing groups without a native endpoint use Chat through
upstream's translation. Unknown context/output limits use conservative 32K/4K
values. Gateway catalog pricing and full Pi cache hints are not provided, so this
adapter does not claim precise cost estimates or complete vendor-feature parity.
Work uses a per-process credential resolved by Pi at request time. Magpie receives
its SHA-256 fingerprint and checks each request's exact permitted model IDs
against the current native group and fallback candidates before forwarding it.
Work validates local GPU eligibility at startup and idle continuation. Each
request also checks local candidates against the current host GPU binding.
Gateway-selected routing classifiers, image description, search and titles use
their own configured selection rules.

`syncHostProviders()` accepts only reserved `zhiyuan-host-*` ids with loopback
URLs. Each running gateway owns its write queue and signature cache. Stopping
the process cancels its in-flight requests and prevents queued writes from
crossing into the next process even if the ports are reused.
Provider list reads and edits from settings stay with the same process through
key lookup, mutation and any delete fallback.
Preference writes and LAN key imports each run in order within the owning process.
LAN key import reuses the matching key if a restart interrupted cleanup.
Enterprise Chat and Work use Magpie's desktop-only scoped caller credential.
Magpie can dispatch an enterprise request only to the current host-owned loopback
origin. The transport exchanges the local capabilities for the current upstream
credential and streams the native protocol. It does not expose upstream tokens
to Pi, Magpie, LAN callers, or external CLI callers. Source revocation rejects
new requests and cancels affected streams. Refreshing an unchanged model's token
keeps its existing streams running.
GPU bindings are read from an already running llama-server or daemon. The local
inference service owns downloads, GPU allocation and model loading. Startup
disables retired host-managed providers before publishing the gateway as ready.
Providers explicitly added in settings keep their configured endpoints. Reserved
entries absent from the authoritative host snapshot are disabled. Main rejects
editing these host entries before calling upstream. Private upstream settings and
provider responses are never forwarded to the application renderer.

Public model response reads are capped at 2 MB before JSON parsing; parsing and
projection run in one cancellable worker, with concurrent reads coalesced. A
10,000-model emitted-worker smoke processed the catalog in 15 ms while the host
continued servicing its event loop (71 timer ticks across a 95 ms invocation).
The equivalent synchronous parse/projection blocked for 18 ms with zero ticks.
This is a synthetic responsiveness check, not a production benchmark.

## Subscription opt-in and controlled OAuth

Subscription accounts remain off by default. The host UI must explain that enabling
this switch permits discovery/reading of existing Claude Code, Codex, Copilot and
other local login files/credential-store entries, as well as new OAuth sign-ins.
The same confirmation must explain that the owned service restarts and in-flight
model requests may be interrupted (task records remain). Only that explicit action
calls `setSubscriptionAccounts(true)`; opening settings or a catalog never does.

The unchanged upstream combines discovery, new sign-in and subscription serving
under one switch; it cannot safely enable new OAuth while ignoring existing
accounts in the same real HOME. The host applies the official
`POST /api/settings/account-discovery` with `{ off: !enabled }`, verifies its state,
persists the explicit preference, then restarts its process with the corresponding
`MAGPIE_NO_ACCOUNTS` setting. Disabling forgets upstream account caches and stops
subscription access but never deletes login files. A failed stop retains process
ownership and reports a failed state instead of pretending the process stopped.
The host-owned switch
cannot be changed independently by the upstream Web UI.

`oauthPolicy.ts` allows the fixed upstream's Codex, public GitHub Copilot, Gemini,
Antigravity, and current Claude authorization route. An external URL must match
an observed sign-in id belonging to the current explicitly started flow, read
back from the authenticated upstream API, still be waiting, and pass exact HTTPS
origin/path, client, PKCE and callback checks. Cancellation, expiry, disabling
subscriptions or ending the flow invalidates pending opens. OAuth
state/callback validation and token exchange remain upstream-owned. No arbitrary
external links, credentials, callback codes or URLs enter application renderer IPC.

Coverage boundaries: enterprise/custom GitHub domains, older Claude authorization
domains, plugin login flows, and flows which require installing another CLI are
not enabled by this bridge. Claude requires an already installed Claude Code CLI
and the current official authorization route. Other external links remain blocked.
These are explicit unsupported cases, not successful logins.

Validation uses fake flows and disposable HOME with invalid, non-credential
fixtures and no executable discovery. The real pinned binary passed default-off,
explicit opt-in/restart, opt-out/restart and account-file-preservation checks.
Real account sign-in and OS-browser/desktop callback acceptance are not exercised
by these tests and still require user-driven platform acceptance.
