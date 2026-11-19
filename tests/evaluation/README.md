# Live Pi harness comparisons

The comparisons are opt-in. Both arms use the installed Pi SDK and the same OpenAI-compatible endpoint, model, context window and output cap. Use the office endpoint with `PI_AB_USE_ZHIYUAN_INTRANET=1`, the public guest route with `PI_AB_USE_ZHIYUAN_FREE=1`, or set `PI_AB_BASE_URL` and `PI_AB_MODEL` for another endpoint. If required, set `PI_AB_API_KEY` in the environment. The default model window and output cap are 65,536 and 4,096 respectively, configurable with `PI_AB_CONTEXT_WINDOW` and `PI_AB_MAX_OUTPUT`.

```sh
PI_AB=1 PI_AB_USE_ZHIYUAN_INTRANET=1 bunx --no-install vitest run --maxWorkers=1 tests/evaluation/piNativeAB.test.ts
PI_ABLATION=1 PI_AB_USE_ZHIYUAN_INTRANET=1 bunx --no-install vitest run --maxWorkers=1 tests/evaluation/piWorkAblation.test.ts
```

Run the ablation in `factor` mode on the baseline source. In the CSV comparison, `prompt-only` removes just the baseline schedule and checkpoint prose before forwarding the request. `tools-only` keeps the assembled prompt and drops Work-only tool schemas from the outbound request, providing an attribution bound without changing runtime registration. In `candidate` mode the same tasks use the candidate's actual Work prompt and tools. Set `PI_ABLATION_PROFILE=candidate` on the candidate checkout. `PI_ABLATION_GROUP=csv|scheduled|memory|probe` selects one group. `PI_ABLATION_CSV_REPEATS=2` repeats each CSV fixture, reversing order on the second pass.

To compare against a commit that predates this evaluator, use a detached worktree at that commit and restore only `tests/evaluation` from the candidate ref before running `factor`. Run `candidate` with the evaluator and product code from the candidate ref. Put a fresh output path in `PI_ABLATION_REPORT` or `PI_AB_REPORT` to append one JSON line per case. `PI_AB_ARM=native` selects the native arm alone.

The tests exercise the real Work adapter, bundled default prompt and isolated SQLite/native session files under an Electron test shim. The CSV fixture has an empty Skill selection and does not start project memory, channel, history or optional MCP services. The scheduled fixture installs an in-memory recipient for the real `scheduled_task` tool, and validates the normalized schedule and payload. The memory fixture registers the same service and tool in both arms, with either an empty source or a synthetic remembered fact. Inputs and permitted tool actions stay inside the disposable fixture. The live model receives only synthetic fixtures.

The checker compares the CSV-task and memory-task JSON artifacts and the scheduled tool receipt. It emits each CSV outcome, including mismatches, and checks scheduled and memory semantics independently. Output includes provider usage, request statuses, first-request byte attribution, wall time and CPU time in the test process. Usage totals cover successful responses with usage, and the report keeps failed attempts for diagnosis. Interpret elapsed time in light of upstream retries and shared load. The one-token probes vary components of the captured synthetic first request and observe provider input tokens. Report rows contain numeric metrics and synthetic fixture scores.
