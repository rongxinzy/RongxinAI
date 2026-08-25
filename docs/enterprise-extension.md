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

API v1 is deliberately limited to lifecycle and explicit versioned capabilities. Skill reconciliation and control-event operations must be added as further capabilities rather than importing renderer state or private application internals.

### Session capability v1

The API v1 context exposes an optional, independently versioned `capabilities.session` object. An enterprise extension may register one password-session provider and must unregister it during disposal. Community builds expose the same fixed renderer surface but return `UNAVAILABLE` when no provider is registered.

The preload bridge permits only `snapshot`, `login`, `changePassword`, and `logout`. Main-process validation copies bounded input fields, normalizes identity snapshots, never returns tokens, and replaces provider exceptions with a generic error before crossing into the renderer. The bridge does not expose arbitrary extension methods or IPC channel names.

### External model capability v1

The optional `capabilities.models` object accepts providers whose IDs use the reserved `external.*` namespace. A provider supplies a bounded model list, resolves a connection for one selected model, and may signal that its list changed. API v1 supports only OpenAI-compatible endpoints. The host validates provider identity, unique model IDs, model metadata, HTTP(S) endpoints, and connection fields before they reach the renderer or runtime.

The renderer receives model metadata only; base URLs and API keys remain in the main process. The runtime resolves a connection immediately before a model is first used and refreshes it on each following conversation turn. This makes short-lived credentials and authorization revocation effective without persisting secrets in the public application's configuration or database. A provider failure is isolated from other providers and logged without including the provider exception.
