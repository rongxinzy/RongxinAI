# Python Runtime

Standalone, workspace-isolated Python execution and package management for ZhiYuan Agent.

## Runtime and environment versions

The app-owned storage root contains `runtimes/<manifest-id>/<platform>` and `workspaces/<sha256(real-workspace-path)>`. Workspace symlink aliases resolve to the same identity. Each workspace has its own venv and `current.json` record with the runtime ID, environment ID and exact frozen requirements. Environments are never reused across workspaces.

An install creates a fresh candidate venv, installs pinned wheel requirements, freezes resolved dependencies, then atomically switches the pointer. Failed installs leave the current environment untouched. Old successful environment directories remain for recovery; no cleanup purges user history. An explicit `rebuild: true` creates a fresh environment from the frozen requirements. A runtime version mismatch rejects execution until an explicit rebuild; startup does not upgrade anything.

The initial compatibility contract is Python 3.12, exact PyPI pins (`name==version`), wheels only, and no custom indexes, local paths or VCS sources. The Linux x64 smoke matrix covers `packaging==25.0` (pure Python) and `numpy==2.2.6` (compiled native wheel), including a real array calculation inside the venv. Additional native-extension packages and all additional platforms must be added to the compatibility test matrix before changing the pinned runtime. Updating the manifest requires reviewing every source/hash and running the corresponding platform tests.

## Invocation and lifecycle

`PythonRuntimeService({storageRoot, runnerPath, jobRunnerPath?})` exposes `execute`, `install`, and `shutdown`. Package operations for one canonical workspace are serialized. Each operation forks the bundled `runner.ts` entry using `ELECTRON_RUN_AS_NODE=1`; the main process does no download, extraction, package resolution, or script execution.

`buildPiPythonTools({service, workspace})` exposes the product interfaces `python.execute` and `python.install` as native Pi tools named `python_execute` and `python_install`. OpenAI/Anthropic function names reject dots, and Pi transmits tool names verbatim; the underscore wire names keep these interfaces portable. Authorization runs before the Runner starts. No workspace path, runtime URL or shell command can be supplied by the model beyond the host-bound workspace and Python source / pinned package list.

The Runner launches executables directly with `shell:false`. Script cwd is the workspace. stdout/stderr are capped together at 1 MiB; results report truncation and the real exit code. Execution timeout defaults to 60 seconds; install defaults to five minutes; both are capped at ten minutes. Cancellation and application shutdown terminate active work. App credentials and Python path overrides are not inherited by scripts. Network proxy/CA configuration reaches only the trusted downloader and uv.

On Linux/macOS a small independent supervisor owns each subprocess group. It watches the Runner IPC connection and kills the group on Runner death, including SIGKILL, as well as on completion/cancellation. The supervisor reuses the bundled Runner entry and needs no system shell or additional dependency. On Windows, `job-runner.exe` creates the child suspended, assigns it to a Job Object configured with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, then resumes it. The helper also waits on the Runner process handle. Missing helper, assignment failure or missing parent fails closed. No taskkill or plain child-PID fallback exists.

## Build and tests

Bundle `src/main/pythonRuntime/runner.ts` as a separate CommonJS entry named `dist-electron/python-runtime-runner.js`. On Windows compile `scripts/python-runtime/job-runner.cpp` using `build-job-runner.ps1` in the MSVC developer environment and package `resources/python-runtime/job-runner.exe` as an unpacked resource.

Unit/native authorization tests: `bunx vitest run src/main/pythonRuntime src/main/libs/agentEngine/piPythonTools.test.ts`.

Real integration tests require explicit opt-in and official downloads: build the Runner, set `PYTHON_RUNTIME_INTEGRATION=1` and `PYTHON_RUNTIME_RUNNER` to its output, then run `runtime.integration.test.ts`. `PYTHON_RUNTIME_TEST_CACHE` optionally reuses already verified runtime assets for tests only. Windows tests additionally set `PYTHON_RUNTIME_JOB_HELPER`.

`.github/workflows/python-runtime.yml` builds and exercises the real Windows helper, including child/grandchild cancellation, parent-death cleanup and Unicode/quoted argv. It does not require signing or install anything into a user's Python environment.
