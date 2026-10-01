# Headless native runtime evaluation

This module supplies product resources to the Inspect-owned Headless Pi Bridge without Electron, desktop credentials, or UI state. It leaves tool execution and completion to native Pi, with no production controller or forced reviewer.

Build with `npm run build:eval-policy`, then set `ZHIYUAN_CANDIDATE_POLICY_MODULE` to `dist-eval/zhiyuan-evaluation-policy.mjs`. The exported policy factory is asynchronous; callers must await it.

The execute track loads `resources/SYSTEM_PROMPT.md` asynchronously and advertises `SKILLs`. Commands and file effects use Inspect sandbox tools. Capture-only model controls bypass product resources and cannot be reported as agent capability tests.

Desktop approvals, SQLite task persistence, UI behavior, and domain-specific workflows remain outside this evaluation. Benchmark scoring must check actual results independently of normal model termination.
