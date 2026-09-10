import type { OfficialIntegrationManifest } from './mcpIntegrationManifest';

export const IntegrationOperation = {
  Provision: 'provision',
  Authenticate: 'authenticate',
  Verify: 'verify',
  Repair: 'repair',
  Uninstall: 'uninstall',
} as const;
export type IntegrationOperation = (typeof IntegrationOperation)[keyof typeof IntegrationOperation];

export const IntegrationRuntimePhase = {
  NotInstalled: 'not-installed',
  Installing: 'installing',
  NeedsAuthorization: 'needs-authorization',
  Authorizing: 'authorizing',
  Verifying: 'verifying',
  Ready: 'ready',
  NeedsRepair: 'needs-repair',
  Uninstalling: 'uninstalling',
} as const;
export type IntegrationRuntimePhase =
  (typeof IntegrationRuntimePhase)[keyof typeof IntegrationRuntimePhase];

export interface IntegrationRuntimeStatus {
  integrationId: string;
  phase: IntegrationRuntimePhase;
  lastSuccessAt?: number;
  error?: string;
  nextOperation?: IntegrationOperation;
}

export interface OfficialConnector {
  manifest: OfficialIntegrationManifest;
  provision(signal?: AbortSignal): Promise<void>;
  authenticate(signal?: AbortSignal): Promise<void>;
  verify(signal?: AbortSignal): Promise<void>;
  repair(signal?: AbortSignal): Promise<void>;
  uninstall(signal?: AbortSignal): Promise<void>;
}

const getRunningPhase = (operation: IntegrationOperation): IntegrationRuntimePhase => {
  switch (operation) {
    case IntegrationOperation.Provision:
    case IntegrationOperation.Repair:
      return IntegrationRuntimePhase.Installing;
    case IntegrationOperation.Authenticate:
      return IntegrationRuntimePhase.Authorizing;
    case IntegrationOperation.Verify:
      return IntegrationRuntimePhase.Verifying;
    case IntegrationOperation.Uninstall:
      return IntegrationRuntimePhase.Uninstalling;
  }
};

const getFailureStatus = (
  integrationId: string,
  operation: IntegrationOperation,
  error: unknown,
): IntegrationRuntimeStatus => ({
  integrationId,
  phase:
    operation === IntegrationOperation.Authenticate
      ? IntegrationRuntimePhase.NeedsAuthorization
      : IntegrationRuntimePhase.NeedsRepair,
  error: error instanceof Error ? error.message : String(error),
  nextOperation:
    operation === IntegrationOperation.Authenticate
      ? IntegrationOperation.Authenticate
      : IntegrationOperation.Repair,
});

/** Main-process owner of official connector lifecycle and diagnostics. */
export class McpIntegrationRuntime {
  private readonly connectors = new Map<string, OfficialConnector>();
  private readonly statuses = new Map<string, IntegrationRuntimeStatus>();
  private readonly operations = new Map<string, Promise<IntegrationRuntimeStatus>>();

  register(connector: OfficialConnector): void {
    this.connectors.set(connector.manifest.id, connector);
    this.statuses.set(connector.manifest.id, {
      integrationId: connector.manifest.id,
      phase: IntegrationRuntimePhase.NotInstalled,
      nextOperation: IntegrationOperation.Provision,
    });
  }

  getStatus(integrationId: string): IntegrationRuntimeStatus | undefined {
    const status = this.statuses.get(integrationId);
    return status ? { ...status } : undefined;
  }

  async run(
    integrationId: string,
    operation: IntegrationOperation,
    signal?: AbortSignal,
  ): Promise<IntegrationRuntimeStatus> {
    const connector = this.connectors.get(integrationId);
    if (!connector) throw new Error(`Official integration "${integrationId}" is not registered.`);
    const running = this.operations.get(integrationId);
    if (running) return running;

    const task = this.runOperation(connector, operation, signal).finally(() => {
      this.operations.delete(integrationId);
    });
    this.operations.set(integrationId, task);
    return task;
  }

  private async runOperation(
    connector: OfficialConnector,
    operation: IntegrationOperation,
    signal?: AbortSignal,
  ): Promise<IntegrationRuntimeStatus> {
    const integrationId = connector.manifest.id;
    this.statuses.set(integrationId, {
      integrationId,
      phase: getRunningPhase(operation),
    });
    try {
      await connector[operation](signal);
      const status: IntegrationRuntimeStatus =
        operation === IntegrationOperation.Uninstall
          ? {
              integrationId,
              phase: IntegrationRuntimePhase.NotInstalled,
              nextOperation: IntegrationOperation.Provision,
            }
          : {
              integrationId,
              phase:
                operation === IntegrationOperation.Provision
                  ? IntegrationRuntimePhase.NeedsAuthorization
                  : IntegrationRuntimePhase.Ready,
              lastSuccessAt: Date.now(),
              nextOperation:
                operation === IntegrationOperation.Provision
                  ? IntegrationOperation.Authenticate
                  : undefined,
            };
      this.statuses.set(integrationId, status);
      return { ...status };
    } catch (error) {
      const status = getFailureStatus(integrationId, operation, error);
      this.statuses.set(integrationId, status);
      return { ...status };
    }
  }
}
