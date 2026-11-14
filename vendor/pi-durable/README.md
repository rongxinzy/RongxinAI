# Native compaction patch

`context-pressure.patch` applies to the npm `@earendil-works/pi-durable@1.5.2` distribution through Bun `patchedDependencies`. It changes native compaction only: account for dense CJK text in estimates and choose the latest legal boundary when the preferred cut cannot summarize any history. Tool pairing boundaries remain native.

The original dependency is pinned in `bun.lock`. A frozen Bun install applies this patch before compilation. `patch-package` separately applies the retained `pi-ai` request-budget patch; it does not process this directory.

Regression coverage lives in `piContextPressure.test.ts`, `piOversizedResume.test.ts`, `durableContextPressure.test.ts`, and `piNativeLongTask.integration.test.ts`. See `docs/architecture/durable-core.zh-CN.md` for the current failure boundary.
