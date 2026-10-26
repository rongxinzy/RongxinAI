# Zhiyuan Enterprise Extension Host

[简体中文](enterprise-extension.zh-CN.md)

Zhiyuan community builds and closed enterprise modules remain in separate repositories. The public application loads an optional, versioned main-process extension from a fixed packaged resource and does not contain AEP endpoints, tenant configuration, customer policy, or private implementation code.

## API v1

An enterprise build places a standalone CommonJS bundle at:

```text
resources/zhiyuan-enterprise/extension.cjs
```

The bundle exports `createZhiyuanEnterpriseExtension`. The returned object declares `apiVersion: 1`, a stable lowercase ID, and asynchronous `initialize` and `dispose` lifecycle methods. Initialization receives a frozen context containing the Zhiyuan version, platform, packaging state, resource path, and user-data path.

Community packages omit the resource and continue startup without loading an extension. A packaged application never accepts an environment-controlled module path. Development builds may set `ZHIYUAN_ENTERPRISE_EXTENSION_DEV_PATH` to an absolute bundle path.

An extension that is present but invalid or incompatible fails closed and prevents the remainder of application initialization. Shutdown invokes `dispose` exactly once so private services can stop polling and release local state before the application database closes.

## Build Boundary

The private repository owns the extension bundle, enterprise tests, release manifest, signing inputs, and Electron Builder overlay. It must pin an exact Zhiyuan tag and commit. It must not copy files over `src/`, patch the public application during packaging, or depend on an unversioned branch.

API v1 is deliberately limited to lifecycle and non-secret host context. Authentication IPC, managed model projection, Skill reconciliation, and control-event operations must be added as explicit versioned capabilities rather than importing renderer state or private application internals.

### Session capability v1

The API v1 context exposes an optional, independently versioned `capabilities.session` object. An enterprise extension may register one password-session provider and must unregister it during disposal. Community builds expose the same fixed renderer surface but return `UNAVAILABLE` when no provider is registered.

The preload bridge permits only `snapshot`, `login`, `changePassword`, and `logout`. Main-process validation copies bounded input fields, normalizes identity snapshots, never returns tokens, and replaces provider exceptions with a generic error before crossing into the renderer. The bridge does not expose arbitrary extension methods or IPC channel names.

### Settings and managed provider capabilities v1

An extension may register multiple settings pages with stable IDs. Zhiyuan renders each page as an independent settings-sidebar entry; account and model management therefore remain separate destinations even when they share one renderer bundle.

`capabilities.managedProvider` accepts one managed configuration source. The source must use the existing `custom_` provider namespace and return the public application's standard `ProviderConfig`. The host synchronizes that configuration into `app_config.providers`, so model selection, OpenAI-compatible transport, capability checks, reasoning compatibility, and Pi runtime all use the same code path as a user-created custom provider. An exclusive source hides editable provider and local-inference entry points without introducing a second model runtime.

## Generic Windows enterprise installer

The `Build Zhiyuan Enterprise Windows package (manual)` entry point validates `version` (for example `v1.0.0`) and a `source_ref` reachable from main, then calls the ordinary `build-windows-release.yml` with `enterprise-extension: true`. No AEP address is required. Both products share runtime preparation, signing, the WebView2 installer, and installation acceptance; the enterprise option only builds and adds `enterprise/` through `electron-builder.enterprise.cjs` and selects its independent product identity. The local entry point `bun run dist:win:enterprise` uses the same `scripts/build-windows.cjs` as ordinary offline/signed builds. Prepare the pinned Go toolchain, run `bun run magpie:build -- --target win32-x64`, and install the .NET 8 SDK first.

Users enter the AEP address at login and can change it after signing out. The main process validates and atomically saves it to the enterprise user data directory at `zhiyuan-enterprise/connection.json`. It survives logout, restart, and upgrade and prefills the login form, including when a valid server is temporarily offline. Passwords never enter this file; refresh tokens use system-protected storage scoped by server address. Split agent-control endpoints are discovered from service metadata and persisted; changing servers clears the previous deployment's endpoint. The packaged configuration has no default server address.

The older `Sign Zhiyuan Enterprise Windows package` entry point still validates the unsigned private-repository run and its version, then calls the same generic packaging workflow. That source commit records handoff provenance only. Client code comes from this repository's exact main commit at dispatch time, rather than rebuilding the old private client or injecting a server address.

The shared acceptance action checks signatures, runtimes, NSIS installation/upgrade, the actual WebView2 installer, and native uninstall before upload; enterprise asset and version checks are additional gates. The WebView2 installer (`ZhiYuanAgent-Setup-<version>.exe`), the independently named NSIS updater, `SHA256SUMS.txt`, and evidence are retained for 14 days. Signing reuses the Certum credentials of this repository's `release` environment. Product executable names, installation directories and registry identities are generated from the same configuration for both installer engines.
