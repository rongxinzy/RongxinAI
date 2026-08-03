# Headless production runtime

This module exposes production-owned resources and orchestration to the Inspect-owned Headless Pi Bridge without importing Electron, desktop credentials, or UI state. The desktop `PiRuntimeAdapter` and this adapter share `createPiWorkLoop`.

Build the candidate-local ESM module before an evaluation:

```powershell
npm run build:eval-policy
```

Then set `ZHIYUAN_CANDIDATE_POLICY_MODULE` to `dist-eval/zhiyuan-evaluation-policy.mjs`.

The execute track loads `resources/SYSTEM_PROMPT.md`, app-managed `SKILLs`, Inspect-owned sandbox tools, `production_loop`, and `agent_loop`. Capture-only model controls are deliberately bypassed and cannot be reported as Agent capability tests.

Interactive approval UI, AskUserQuestion, MCP, and subagent execution remain uncovered. The local profile has one model, so review degrades to a same-model, read-only transcript critic and emits `evaluation_critic_degraded`; reports must not describe it as independent review.
