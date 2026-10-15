import { BaselineJob, CiEvent, HeavyJob, JobResult } from './constants.ts';

export type GatePlan = Record<(typeof HeavyJob)[keyof typeof HeavyJob], boolean>;

// Packaging inputs and main-process changes require real platform verification.
// Non-packaging scripts, docs and pure presentational UI remain on baseline checks.
const packaging =
  /^(?:package\.json$|bun\.lock$|electron-builder[^/]*$|(?:electron-)?tsconfig[^/]*$|vite\.config\.|\.github\/(?:workflows\/(?:ci\.ya?ml$|build-platforms|linux-install|windows-installer|daily-release|release-candidate|sign-).*|actions\/)|patches\/|build\/|resources\/|vendor\/|scripts\/(?:build|dist|package|installer|release|electron-builder|setup-python|prepare-signing|patch-windows|rebuild-electron).*|SKILLs\/|MCPs\/|skills\.config\.json$|src\/main\/|src\/shared\/(?:llamacpp|channelRuntime)\/)/;
const memory =
  /^(?:src\/main\/|src\/renderer\/(?:App\.tsx$|main\.tsx$|hooks\/|store\/|services\/|components\/cowork\/(?:hooks\/|CoworkView\.tsx$|CoworkSessionViewport\.tsx$))|src\/shared\/components\/ai-elements\/)/;

export function planGates(paths: string[], event: string, ref: string): GatePlan {
  // Manual runs are the escape hatch for risks not captured by path ownership.
  const full = event === CiEvent.Manual;
  // main pushes repeat fast checks; PRs already own the expensive install checks.
  // Unknown events run everything rather than silently weakening the gate.
  const unknown =
    event !== CiEvent.PullRequest && event !== CiEvent.Push && event !== CiEvent.Manual;
  const relevant = paths.some(
    file =>
      packaging.test(file) ||
      /^(?:scripts\/nsis[^/]*|scripts\/ci\/(?:windows-(?:installer|shell)|gates\/)|tests\/nsis-installer\.test\.ts$)/.test(
        file,
      ),
  );
  const installations = event === CiEvent.PullRequest && relevant;
  return {
    [HeavyJob.Linux]: full || unknown || installations,
    [HeavyJob.Windows]: full || unknown || installations,
    [HeavyJob.Memory]:
      full ||
      unknown ||
      ref.startsWith('refs/tags/') ||
      (event === CiEvent.PullRequest && (relevant || paths.some(file => memory.test(file)))),
  };
}

export function verifyGateResults(
  plan: GatePlan,
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
}
