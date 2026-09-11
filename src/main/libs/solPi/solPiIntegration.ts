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
import type { SolPiSessionManagerLike } from './solPiSessionScope';
import {
  createSolPiSessionManager,
  solPiSessionStorageDir,
  solPiStorageRoot,
} from './solPiSessionScope';
import { conservativeSolPiConfig, SolPiProfile, type SolPiProfile as SolPiProfileType } from './solPiProfile';
import {
  createSolPiThenRunGuardExtensionFactory,
  type SolPiThenRunAuthorization,
  type SolPiThenRunAuthorizationContext,
  type SolPiThenRunCommand,
} from './solPiThenRunGuard';
import { loadSolPiVendor } from './solPiVendor';

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
  const solPiFactory = vendor.createSolPiExtension(() => config);

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
