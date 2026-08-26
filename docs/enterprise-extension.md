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
