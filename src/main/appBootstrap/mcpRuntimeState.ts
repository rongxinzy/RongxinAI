import type { McpIntegrationRuntime } from '../libs/mcpIntegrationRuntime';
import type { McpServerManager } from '../libs/mcpServerManager';
import type { McpStore } from '../mcpStore';

/**
 * MCP domain state carved out of the shared `rt` locator (work package I.1):
 * one typed container per domain instead of a flat 58-field service locator.
 * Initialized lazily by the owning bootstrap module; `activeAuthorizations`
 * is always present (OAuth cancellations must be recorded even before init).
 */
export interface McpRuntimeState {
  store: McpStore | null;
  serverManager: McpServerManager | null;
  activeAuthorizations: Map<string, AbortController>;
  integrationRuntime: McpIntegrationRuntime | null;
  bridgeRefreshPromise: Promise<{ tools: number; error?: string }> | null;
  bridgeRefreshPending: boolean;
}

export const mcpRuntime: McpRuntimeState = {
  store: null,
  serverManager: null,
  activeAuthorizations: new Map<string, AbortController>(),
  integrationRuntime: null,
  bridgeRefreshPromise: null,
  bridgeRefreshPending: false,
};

/** Accessors for the active MCP OAuth authorization controllers. */
export const getActiveMcpAuthorizations = (): Map<string, AbortController> | undefined =>
  mcpRuntime.activeAuthorizations;
export const setActiveMcpAuthorizations = (
  value: Map<string, AbortController> | undefined,
): void => {
  mcpRuntime.activeAuthorizations = value ?? new Map<string, AbortController>();
};
