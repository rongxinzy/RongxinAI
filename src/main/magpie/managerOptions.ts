import type { spawn } from 'node:child_process';
import type { verifyMagpieBinary } from './integrity';
import type { parseMagpieCatalog } from './catalogReader';
import type { MagpieGatewayPortStore } from './gatewayPort';

export interface MagpieManagerOptions {
  resourcesRoot: string;
  privateHome: string;
  /** Tests must supply temporary HOME and USERPROFILE; production retains the real CLI home. */
  environment?: NodeJS.ProcessEnv;
  verify?: typeof verifyMagpieBinary;
  spawn?: typeof spawn;
  fetch?: typeof fetch;
  port?: () => Promise<number>;
  gatewayPort?: MagpieGatewayPortStore;
  startupTimeoutMs?: number;
  recoveryRetryDelayMs?: number;
  platform?: NodeJS.Platform;
  jobRunnerPath?: string | false;
  killProcessTree?: (pid: number) => Promise<void>;
  parseCatalog?: typeof parseMagpieCatalog;
  serviceEnabled?: { read(): boolean; write(enabled: boolean): void };
  subscriptionAccounts?: { read(): boolean; write(enabled: boolean): void | Promise<void> };
  /**
   * Local-inference LAN access: when on, the gateway binds 0.0.0.0 (non-loopback
   * requests then require a gateway key) and the LAN token is imported as the
   * `zhiyuan-lan` key after each start. `enabled` alone must not run the service.
   */
  lanAccess?: { read(): { enabled: boolean; lanToken: string | null } };
}
