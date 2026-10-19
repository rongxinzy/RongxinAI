import { BaselineJob, CiEvent, HeavyJob, JobResult, PathJob } from './constants.ts';

export type GatePlan = Record<(typeof HeavyJob)[keyof typeof HeavyJob], boolean>;
export type PathPlan = Record<(typeof PathJob)[keyof typeof PathJob], boolean>;

// Packaging inputs and main-process changes require real platform verification.
// Non-packaging scripts, docs and pure presentational UI remain on baseline checks.
const packaging =
  /^(?:package\.json$|bun\.lock$|electron-builder[^/]*$|(?:electron-)?tsconfig[^/]*$|vite\.config\.|\.github\/(?:workflows\/(?:ci\.ya?ml$|linux-install|windows-installer|release|promote|sign-).*|actions\/)|patches\/|build\/|resources\/|vendor\/|scripts\/(?:build|dist|package|installer|release|electron-builder|setup-python|prepare-signing|patch-windows|rebuild-electron).*|SKILLs\/|MCPs\/|skills\.config\.json$|src\/main\/|src\/shared\/(?:llamacpp|channelRuntime)\/)/;
const memory =
  /^(?:scripts\/ci\/memory-leak|\.github\/workflows\/memory-regression\.yml$|src\/main\/|src\/renderer\/(?:App\.tsx$|main\.tsx$|hooks\/|store\/|services\/|components\/cowork\/(?:hooks\/|CoworkView\.tsx$|CoworkSessionViewport\.tsx$))|src\/shared\/components\/ai-elements\/)/;
// Same paths the enterprise job used to detect before checking out the toolchain.
const enterpriseChange =
  /^(?:\.github\/workflows\/enterprise-windows\.yml$|enterprise\/|src\/main\/enterpriseExtension|package\.json|bun\.lock|electron-builder)/;

const channelRuntimeChange =
  /^(?:package\.json$|scripts\/channel-runtime-|scripts\/download-channel-runtime\.cjs|src\/main\/im\/|src\/main\/libs\/ccConnect|src\/scheduledTask\/ccConnect|\.github\/workflows\/channel-runtime-smoke\.ya?ml$)/;
const pythonRuntimeChange =
  /^(?:src\/main\/pythonRuntime\/|src\/main\/libs\/agentEngine\/piPythonTools|scripts\/python-runtime\/|\.github\/workflows\/python-runtime\.ya?ml$)/;
const installerPreviewChange =
  /^(?:scripts\/installer-shell\/preview\/|scripts\/installer-shell\/preview-ui\.test\.ts$|scripts\/ci\/installer-style-preview\.py$|\.github\/workflows\/installer-style-preview\.ya?ml$)/;
const browserPreviewChange =
  /^(?:src\/renderer\/|src\/shared\/|vite\.config\.browser\.ts$|scripts\/preview\/)/;

// Workflows are executable inputs. Never suppress ownership because a diff is CI-only.
const ciMetaOnly = /^(?:AGENTS\.md$|DEVOPS\.md$|CLAUDE\.md$)/;

export function enterpriseRequired(paths: string[], event: string): boolean {
  if (event === CiEvent.Manual) return true;
  if (event !== CiEvent.PullRequest && event !== CiEvent.Push) return true;
  return paths.some(file => !ciMetaOnly.test(file) && enterpriseChange.test(file));
}

function pathJobSelected(
  paths: string[],
  event: string,
  matcher: (file: string) => boolean,
): boolean {
  const full = event === CiEvent.Manual;
  const unknown =
    event !== CiEvent.PullRequest && event !== CiEvent.Push && event !== CiEvent.Manual;
  return full || unknown || paths.some(file => !ciMetaOnly.test(file) && matcher(file));
}

export function planPathJobs(paths: string[], event: string): PathPlan {
  const channel = pathJobSelected(paths, event, file => channelRuntimeChange.test(file));
  const python = pathJobSelected(paths, event, file => pythonRuntimeChange.test(file));
  const installer = pathJobSelected(paths, event, file => installerPreviewChange.test(file));
  const browserPreview = pathJobSelected(paths, event, file => browserPreviewChange.test(file));
  return {
    [PathJob.Enterprise]: enterpriseRequired(paths, event),
    [PathJob.StreamingMutations]: pathJobSelected(paths, event, file =>
      /^(?:src\/main\/(?:libs\/agentEngine\/|streaming\/|appBootstrap\/piUi|workbenchTask\/)|src\/renderer\/(?:services\/|store\/|components\/cowork\/)|src\/shared\/|tests\/streaming|scripts\/ci\/run-streaming|\.github\/workflows\/ci\.yml$|scripts\/ci\/gates\/|package\.json$|bun\.lock$|vitest\.config\.)/.test(
        file,
      ),
    ),
    [PathJob.WindowsScripts]: pathJobSelected(paths, event, file =>
      /^(?:scripts\/ci\/.*(?:windows|installer-budget)|scripts\/installer-shell\/|\.github\/workflows\/(?:ci|build-inference-editions|windows-installer-pr)\.yml$)/.test(
        file,
      ),
    ),
    [PathJob.BuildVerification]:
      (event === CiEvent.PullRequest || event === CiEvent.Push) &&
      pathJobSelected(paths, event, file =>
        /^(?:electron-builder|(?:electron-)?tsconfig|vite\.config\.|resources\/|vendor\/|SKILLs\/|MCPs\/|build\/|patches\/|scripts\/(?:electron-builder|windows-resource|setup-|ensure-build-version|installer-shell\/|packaging\/|ci\/(?:build-checkpoint|compression-qualification|prepare-windows-components|runtime-tree-integrity|windows-|collect-windows)|.*llamacpp)|\.github\/(?:workflows\/(?:build-inference-editions|release|build-platforms|windows-installer-pr|linux-install-pr)\.yml$|actions\/)|package\.json$|bun\.lock$)/.test(
          file,
        ),
      ),
    [PathJob.ChannelRuntime]: channel,
    [PathJob.PythonRuntimeLinux]: python,
    [PathJob.PythonRuntimeWindows]: python,
    [PathJob.InstallerPreview]: installer,
    [PathJob.BrowserPreview]: browserPreview,
  };
}

export function planGates(paths: string[], event: string, ref: string): GatePlan {
  // Manual runs are the escape hatch for risks not captured by path ownership.
  const full = event === CiEvent.Manual;
  // Unknown events run everything rather than silently weakening the gate.
  const unknown =
    event !== CiEvent.PullRequest && event !== CiEvent.Push && event !== CiEvent.Manual;
  const isRelease = ref.startsWith('refs/tags/');
  const relevant = paths.some(
    file =>
      !ciMetaOnly.test(file) &&
      (packaging.test(file) ||
        /^(?:scripts\/nsis[^/]*|scripts\/ci\/windows-(?:installer|shell)|tests\/nsis-installer\.test\.ts$)/.test(
          file,
        )),
  );
  // PRs no longer run expensive install checks; only release tags, manual runs, and unknown events trigger install checks.
  const installations = full || unknown || isRelease;
  return {
    [HeavyJob.Linux]: installations,
    [HeavyJob.Windows]: installations,
    [HeavyJob.Memory]:
      full ||
      unknown ||
      isRelease ||
      (event === CiEvent.PullRequest &&
        paths.some(file => !ciMetaOnly.test(file) && (relevant || memory.test(file)))),
  };
}

export function verifyGateResults(
  plan: GatePlan,
  pathPlan: PathPlan,
  results: Record<string, { result: string }>,
): void {
  for (const name of Object.values(BaselineJob)) {
    if (results[name]?.result !== JobResult.Success) {
      throw new Error(`Required check ${name} did not succeed`);
    }
  }
  for (const name of Object.values(HeavyJob)) {
    if (typeof plan[name] !== 'boolean') throw new Error(`Missing decision for ${name}`);
    const expected = plan[name] ? JobResult.Success : JobResult.Skipped;
    if (results[name]?.result !== expected) {
      throw new Error(`Check ${name} must be ${expected}, received ${results[name]?.result}`);
    }
  }
  for (const name of Object.values(PathJob)) {
    if (typeof pathPlan[name] !== 'boolean') throw new Error(`Missing path decision for ${name}`);
    const expected = pathPlan[name] ? JobResult.Success : JobResult.Skipped;
    if (results[name]?.result !== expected) {
      throw new Error(`Check ${name} must be ${expected}, received ${results[name]?.result}`);
    }
  }
}
