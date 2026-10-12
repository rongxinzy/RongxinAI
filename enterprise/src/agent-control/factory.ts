import { AgentControlRuntime, type AgentControlRuntimeOptions } from './runtime.js';
import { ManagedSkillReconciler } from './skills.js';
import { AgentControlState } from './state.js';
import type { AgentControlClient } from './types.js';

export interface ZhiyuanAgentControlBackendOptions {
  readonly client: AgentControlClient;
  readonly databasePath: string;
  readonly skillRoot: string;
  readonly agentVersion: string;
  readonly platform: 'windows' | 'macos' | 'linux';
  readonly retryDelayMs?: number;
  readonly onError?: (error: unknown) => void;
  readonly onSkillsChanged?: () => void;
}

export class ZhiyuanAgentControlBackend {
  readonly runtime: AgentControlRuntime;
  readonly #state: AgentControlState;
  #closed = false;

  constructor(options: ZhiyuanAgentControlBackendOptions) {
    this.#state = new AgentControlState(options.databasePath);
    const reconciler = new ManagedSkillReconciler(
      options.client,
      this.#state,
      options.skillRoot,
      options.onSkillsChanged,
    );
    const runtimeOptions: AgentControlRuntimeOptions = {
      client: options.client,
      state: this.#state,
      reconciler,
      agentVersion: options.agentVersion,
      platform: options.platform,
      ...(options.retryDelayMs === undefined ? {} : { retryDelayMs: options.retryDelayMs }),
      ...(options.onError === undefined ? {} : { onError: options.onError }),
    };
    this.runtime = new AgentControlRuntime(runtimeOptions);
  }

  start(): void {
    this.#assertOpen();
    this.runtime.start();
  }

  async runOnce(): Promise<number> {
    this.#assertOpen();
    return this.runtime.runOnce();
  }

  async stop(): Promise<void> {
    if (this.#closed) return;
    await this.runtime.stop();
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    await this.runtime.stop();
    this.#state.close();
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error('Zhiyuan Agent control backend is closed.');
  }
}

export function createZhiyuanAgentControlBackend(
  options: ZhiyuanAgentControlBackendOptions,
): ZhiyuanAgentControlBackend {
  return new ZhiyuanAgentControlBackend(options);
}
