/**
 * One-time cleanup of credentials persisted by retired sign-in flows.
 *
 * The in-app GitHub Copilot device-flow sign-in was removed in favor of the
 * model gateway's subscription sign-in. Its stored GitHub OAuth token is a
 * credential nothing reads anymore, so drop it from the KV store at startup.
 */

/** KV store key the retired Copilot device flow used for the GitHub OAuth token. */
export const LEGACY_COPILOT_GITHUB_TOKEN_KEY = 'github_copilot_github_token';

interface KvStoreLike {
  get(key: string): unknown;
  delete(key: string): void;
}

/**
 * Delete the legacy stored GitHub token if present. Safe to call on every
 * startup: absent keys are left alone and no error is surfaced — the token is
 * unreadable either way once the flow that consumed it is gone.
 */
export function cleanupLegacyCopilotStoredToken(store: KvStoreLike): void {
  if (store.get(LEGACY_COPILOT_GITHUB_TOKEN_KEY) === undefined) return;
  store.delete(LEGACY_COPILOT_GITHUB_TOKEN_KEY);
  console.log('[LegacyCredentialCleanup] removed stored Copilot GitHub token');
}
