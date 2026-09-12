/**
 * SoL-Pi integration entry (experiment, default off).
 *
 * When the conservative profile is enabled, this module assembles:
 *  - the vendored SoL-Pi extension factory with an app-owned config loader
 *    (upstream's project/global `sol-pi.json` discovery is bypassed, so a
 *    user-level global Pi config can never silently enable mechanisms here);
 *  - the then_run approval guard, so fused bash commands go through the same
 *    authorization as plain `bash` tool calls;
 *  - an app-owned wrapped in-memory SessionManager so ObservationPack
 *    archives land under `<userData>/solPi/sessions/<sessionId>/` instead of
 *    a Pi session directory.
 *
 * The reducer and online context compaction are never enabled by this module.
 */
import type { PiExtensionFactory } from '../agentEngine/piExtensionTypes';
import { resolveGitBashPathForPi } from '../coworkUtil';
import type { SolPiSessionManagerLike } from './solPiSessionScope';
import {
  createSolPiSessionManager,
  solPiSessionStorageDir,
  solPiStorageRoot,
} from './solPiSessionScope';
import {
  conservativeSolPiConfig,
  SolPiProfile,
  type SolPiProfile as SolPiProfileType,
} from './solPiProfile';
import {
  createSolPiThenRunGuardExtensionFactory,
  type SolPiThenRunAuthorization,
  type SolPiThenRunAuthorizationContext,
  type SolPiThenRunCommand,
} from './solPiThenRunGuard';
import { loadSolPiVendor, type SolPiVendorOptions } from './solPiVendor';
import { getSolPiCompute } from './solPiComputePool';

export type AuthorizeSolPiThenRun = (
  thenRun: SolPiThenRunCommand,
  context: SolPiThenRunAuthorizationContext,
) => Promise<SolPiThenRunAuthorization>;

export interface SolPiRuntimeParts {
  /** Extension factories to append to the resource loader's factory list. */
  extensionFactories: PiExtensionFactory[];
  /** Wrapped in-memory session manager exposing the app-owned storage dir. */
  sessionManager: SolPiSessionManagerLike;
  /** App-owned per-session storage directory (for diagnostics/cleanup). */
  storageDir: string;
}

export interface BuildSolPiRuntimeOptions {
  profile: SolPiProfileType;
  /** Structural access to Pi's SessionManager.inMemory factory. */
  createInMemorySessionManager: (cwd: string) => SolPiSessionManagerLike & Record<string, unknown>;
  cwd: string;
  sessionId: string;
  /** Application data directory (app.getPath('userData')). */
  userDataPath: string;
  authorizeThenRun: AuthorizeSolPiThenRun;
  /**
   * Bash overrides for Action Fusion's fused follow-up commands. Without this,
   * the fused `then_run` commands would build their bash tool from defaults
   * while the app's plain `bash` calls run through the resolved shell — on
   * Windows that means the bundled PortableGit git-bash. See
   * {@link resolveEffectiveBashOptions} for the win32 default.
   */
  bashOptions?: { shellPath?: string; commandPrefix?: string };
}

/**
 * Resolve the bash options the vendored extension should run fused commands
 * with. An explicit caller value always wins. Otherwise, on Windows only, the
 * app's git-bash resolution (same source the real Pi session's settings
 * override uses) becomes the default, so fused commands and plain `bash` calls
 * agree on one shell. Non-Windows platforms get no default override.
 */
function resolveEffectiveBashOptions(
  bashOptions: BuildSolPiRuntimeOptions['bashOptions'],
): { shellPath?: string; commandPrefix?: string } | undefined {
  if (bashOptions) return bashOptions;
  if (process.platform === 'win32') {
    const shellPath = resolveGitBashPathForPi();
    if (shellPath) return { shellPath };
  }
  return undefined;
}

/**
 * Assemble the SoL-Pi runtime parts for one session, or `null` when the
 * profile is off (the default) — in that case callers must not change any
 * session behavior.
 */
export async function buildSolPiRuntime(
  options: BuildSolPiRuntimeOptions,
): Promise<SolPiRuntimeParts | null> {
  if (options.profile === SolPiProfile.Off) return null;

  const vendor = await loadSolPiVendor();
  const config = conservativeSolPiConfig();
  const effectiveBashOptions = resolveEffectiveBashOptions(options.bashOptions);
  // Move the vendored extensions' blocking CPU work (first-sight observation
  // hashing/splitting, EEXIST verify, fused-command interference hashes) onto
  // the bounded compute pool. When no worker bundle is available (source-mode
  // execution), the hooks stay undefined and the vendored in-process default
  // applies — behavior-identical, just on the main thread.
  const compute = getSolPiCompute();
  const vendorOptions: SolPiVendorOptions | undefined =
    effectiveBashOptions || compute
      ? {
          ...(effectiveBashOptions ? { bashOptions: effectiveBashOptions } : {}),
          ...(compute
            ? {
                prepareObservation: compute.prepareObservation as SolPiVendorOptions['prepareObservation'],
                hashBuffer: compute.hashBuffer,
                fileHash: compute.fileHash,
              }
            : {}),
        }
      : undefined;
  const solPiFactory = vendor.createSolPiExtension(() => config, vendorOptions);

  const storageRoot = solPiStorageRoot(options.userDataPath);
  const storageDir = solPiSessionStorageDir(storageRoot, options.sessionId);
  const sessionManager = createSolPiSessionManager(
    options.createInMemorySessionManager(options.cwd),
    storageRoot,
    options.sessionId,
  );

  const extensionFactories: PiExtensionFactory[] = [
    createSolPiThenRunGuardExtensionFactory(options.authorizeThenRun),
    solPiFactory,
  ];
  return { extensionFactories, sessionManager, storageDir };
}
