# ZhiYuan Agent Engine Modernization (`@earendil-works/pi-*` Native Integration)

## Architecture Overview

`src/main/libs/agentEngine/` serves as the core execution kernel of ZhiYuan Agent (知远智能体), driving Work, Chat, Channel, and Cron modes. This modernization transitions the engine from ambient type shims, loopback HTTP proxies, and redundant outer state machines to native `@earendil-works/pi-*` (v1.5.2) capabilities across three milestones (P0, P1, P2).

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           ZhiYuan Main Process Shell                            │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│   [Cowork / Chat Sessions]             [Enterprise Managed Models]              │
│               │                                      │                          │
│               ▼                                      ▼                          │
│   ┌────────────────────────┐         ┌──────────────────────────────────────┐   │
│   │   piRuntimeAdapter     │         │ enterpriseExtension / ProviderBridge │   │
│   └───────────┬────────────┘         └──────────────────┬───────────────────┘   │
│               │                                         │                       │
│               ▼                                         ▼                       │
│   ┌─────────────────────────────────────────────────────────────────────────┐   │
│   │                 Pi Coding Agent (v1.5.2 Native Kernel)                  │   │
│   │                                                                         │   │
│   │  • AgentSession (sendUserMessage, clearQueue, navigateTree, reload)     │   │
│   │  • Extension API (before_provider_headers, before_provider_request)     │   │
│   │  • Dynamic MCP (registerMcpServer, unregisterMcpServer, session.reload) │   │
│   │  • Tool Engine (ToolDefinition: annotations, outputSchema, onUpdate)    │   │
│   │  • System Prompt Engine (structured XML: tools, rules, skills, cwd)     │   │
│   │  • SessionManager (appendContextEdit, getSessionStats)                  │   │
│   └─────────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Feature & Milestone Summary

| Milestone | Scope | Status |
| --- | --- | --- |
| **P0** | Remove `piModules.d.ts` ambient type shim for full `NodeNext` native Pi types; fix English harness `<preamble>` & `<docs>` leakage in `piPromptOverrides.ts`; preserve `<tools>`/`<rules>`/`<cwd>` via `ensureNativeSystemPromptSections()`; de-duplicate `piSystemPromptContributions.ts`. | DONE |
| **P1** | Add native `ToolAnnotations` and TypeBox `outputSchema` to custom tools; refactor `riskClassifier.ts` from hardcoded tool-name lists to `annotations`; enable read-only tools (`grep`/`find`/`ls`) on demand; stream `tool_execution_update` & subagent `parentToolCallId` tree; unlock subagent MCP & `codemode`; use `session.reload()` for dynamic MCP hot-reload. | DONE |
| **P2** | Retire `piOpenAICompatProxy.ts` loopback HTTP server via native `piEnterpriseProviderExtension.ts` lifecycle hooks (`before_provider_headers`, `before_provider_request`, `after_provider_response`); thin `piRuntimeQueueController.ts` to delegate steering/follow-up to Pi; integrate `appendContextEdit()`, `navigateTree()`, and `getSessionStats()`; modernize `piDocumentReaderTool.ts`. | DONE |

---

## Key Interface Contracts

### P0: System Prompt Preamble & Structured XML Sections
- `getZhiyuanProductPreamble()` in `src/main/libs/agentEngine/piPromptOverrides.ts` provides the Chinese product preamble via `systemPromptOverride`.
- `ensureNativeSystemPromptSections()` in `src/main/libs/agentEngine/piRuntimeResourceLoader.ts` keeps `<tools>` and `<rules>` XML sections rendered natively when `customPrompt` is set, without injecting Pi's default English preamble or `<docs>`.

### P1: Tool Definitions, Streaming Updates & Dynamic MCP
- Custom tools declare native `annotations` (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) and TypeBox `outputSchema`.
- `CoworkToolActivity` (`src/shared/cowork/toolActivity.ts`) carries `parentToolCallId` and `partialResult` for `tool_execution_update` and nested subagent tool trees.
- Active idle sessions reload MCP changes via `await active.piSession.reload()` instead of disposing and recreating the session.

### P2: Enterprise Lifecycle Hooks & Queue Thinning
- `src/main/enterpriseExtension/piEnterpriseProviderExtension.ts` hooks `before_provider_headers`, `before_provider_request`, and `after_provider_response` directly in memory.
- `piRuntimeQueueController.ts` delegates live steering/follow-up delivery to `session.sendUserMessage(prompt, { deliverAs })` and `session.clearQueue()`, while `piRuntimeAdapter.ts` exposes `appendContextEdit()`, `navigateSessionTree()`, and `getSessionStats()`.

---

## Code Layout

- `src/main/libs/agentEngine/`
  - `piRuntimeAdapter.ts`: Main entry point, lifecycle coordinator, and native session stats/context-edit/tree-navigation wrappers.
  - `piRuntimeSessionState.ts`: Session state and Pi module bindings.
  - `piPromptOverrides.ts`: Product preamble and prompt override creation.
  - `piRuntimeResourceLoader.ts`: Resource loader, extension runner wiring, and `ensureNativeSystemPromptSections()`.
  - `piSystemPromptContributions.ts`: Deduplicated system prompt contributions.
  - `piRuntimeSessionCustomTools.ts`: Custom tool assembly and subagent tool policy.
  - `piRuntimeTurnEvents.ts`: Turn event routing and `tool_execution_update` streaming.
  - `piSubagentTool.ts` & `piSubagentExecution.ts`: Subagent tool definition and nested execution runner.
  - `piRuntimeSessionContinuation.ts`: Continuation and dynamic MCP reload logic.
  - `piRuntimeQueueController.ts`: Outer queue controller thinned to delegate to Pi.
  - `piDocumentReaderTool.ts`: Document reader tool (annotated and modernized).
- `src/main/enterpriseExtension/`
  - `piEnterpriseProviderExtension.ts`: Native Pi lifecycle extension for enterprise auth headers and role remapping.
  - `managedProviderBridge.ts`: Enterprise provider registration and coalesced token refresh.
- `src/main/workbenchTask/`
  - `riskClassifier.ts`: Annotation-based risk classification.
- `src/shared/cowork/`
  - `toolActivity.ts`: Shared tool activity interface with `partialResult` and `parentToolCallId`.
