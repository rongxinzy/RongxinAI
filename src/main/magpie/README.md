# Bundled local CLI management

The host executes the unchanged pinned Magpie binary described by
`resources/magpie/upstream.json`. Its MIT notice ships with the resource.

## Explicit enablement

Creating `MagpieManager` and requesting `status()` do not start a process.
The product must explain that upstream startup synchronizes previously managed
CLI configuration (`agent.SyncCatalog`) and that `/api/state` may follow/apply
configuration (`a.Follow`). Only the user's **Enable local CLI management**
action calls `start()`. Do not label `agents()` a read-only scan.

Production retains HOME/USERPROFILE for real local CLI management, while
XDG_CONFIG_HOME puts Magpie's own files below the supplied app-private directory.
Account discovery defaults off via MAGPIE_NO_ACCOUNTS=1; telemetry is disabled by
DO_NOT_TRACK=1 and upstream settings. The gateway and Web UI bind to loopback.
The host does not copy application provider credentials into Magpie. Its ephemeral
Web key remains in Main and the separate in-memory management-window cookie jar.
This window has no application preload, cannot open other windows, and denies
external navigation and permission requests. External OAuth opens only through the controlled active-flow gate described below.

The host verifies source pin/platform/version and the packaged binary SHA256 in
a cancellable worker before spawning. macOS and Windows manifests include the
post-signing binary digest; build provenance retains the pre-signing digest. Missing or changed
resources fail closed. Start is single-flight; quit first requests upstream's
POST /api/window/quit, then terminates only the process it owns if needed.
No Windows Job Object or descendant cleanup is claimed for this Go process.

## Narrow renderer contract

`src/shared/magpie/types.ts` defines status/start/stop/models/agents/setModel and
openManagement. The IPC registrar requires the application's existing trusted
main-frame predicate. It does not provide a generic URL or HTTP proxy.

- models: official GET /v1/models, projected id/owned_by only
- agents: official GET /api/state + GET /api/agents/cli, projected identity,
  missing-CLI flag, connection flag, versions and model fields only
- setModel: explicit user apply action, official POST /api/set with Agent/Field/Value
- openManagement: sandboxed official local Web UI, only after explicit start

The caller registers `registerMagpieIpc` once and awaits its returned disposer
before application shutdown. The shared MagpieApi is exposed as
window.electron.magpie. Do not persist an auto-start flag.

## Verification

`bun x vitest run src/main/magpie` covers process ownership, explicit enablement,
credential omission, trusted manifest, safe projection and cancellation.
After building the target binary, run
`ZHIYUAN_MAGPIE_SMOKE=1 bun x vitest run src/main/magpie`.
The opt-in smoke creates a temporary HOME/.codex/config.toml, discovers its model,
sets a different model through the real API, verifies the configuration file and
stops the real process. It never uses a real account or API key.

Linux x64 runtime and emitted SHA worker were exercised locally. The other five
cross-built targets still require native platform CI execution/signing checks.

## Unified model source

Magpie is now the only user-configurable Provider/credential/catalog/router source.
`modelService.ts` holds only the application's selected model id and projects the
live gateway catalog. Main supplies selection persistence, the enterprise access
predicate, and `beforeCatalog` to synchronize host-managed enterprise/GPU sources.
`installMagpieModelService()` connects the same source to Pi Durable. A session's
model id is the exact gateway id, not a second provider-prefixed application id.
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
start the service. Native auth refreshes the owned gateway URL after a restart,
while retaining the exact selected model and rechecking revocation each request.

Native endpoints, context/output limits, reasoning levels and image capability
are projected from `/v1/models`. Responses and Anthropic-native models keep their
native wire protocol; routing groups without a native endpoint use Chat through
upstream's translation. Unknown context/output limits use conservative 32K/4K
values. Gateway catalog pricing and full Pi cache hints are not provided, so this
adapter does not claim precise cost estimates or complete vendor-feature parity.
The configured model and policy are revalidated before each native request.

`syncHostProviders()` accepts only reserved `zhiyuan-host-*` ids with loopback
URLs. The enterprise bridge retains its short-lived upstream tokens; Magpie sees
only the host's local capability. GPU bindings describe a running llama-server;
Magpie does not own downloads, GPU allocation or model loading. Reserved entries
absent from the authoritative host snapshot are disabled. The official management
window blocks editing these host entries. Private management responses are never
forwarded to the main application renderer.

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
The official window cannot independently change this host-owned privacy choice.

`oauthPolicy.ts` allows the fixed upstream's Codex, public GitHub Copilot, Gemini,
Antigravity, and current Claude authorization route. An external URL must match
an observed sign-in id belonging to the current explicitly started flow, read
back from the authenticated upstream API, still be waiting, and pass exact HTTPS
origin/path, client, PKCE and callback checks. Cancellation, expiry, disabling
subscriptions or closing the management window invalidates pending opens. OAuth
state/callback validation and token exchange remain upstream-owned. No arbitrary
external links, credentials, callback codes or URLs enter application renderer IPC.

Coverage boundaries: enterprise/custom GitHub domains, older Claude authorization
domains, plugin login flows, and flows which require installing another CLI are
not enabled by this bridge. Claude requires an already installed Claude Code CLI
and the current official authorization route. Other management-window external
links remain blocked. These are explicit unsupported cases, not successful logins.

Validation uses fake flows and disposable HOME with invalid, non-credential
fixtures and no executable discovery. The real pinned binary passed default-off,
explicit opt-in/restart, opt-out/restart and account-file-preservation checks.
Real account sign-in and OS-browser/desktop callback acceptance are not exercised
by these tests and still require user-driven platform acceptance.
