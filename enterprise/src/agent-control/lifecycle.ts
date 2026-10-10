import type {
  ZhiyuanPasswordSession,
  ZhiyuanSessionSnapshot,
} from '../session/password-session.js';

export interface AgentControlLifecycleBackend {
  start(): void;
  stop(): Promise<void>;
  close(): Promise<void>;
}

export class ZhiyuanAgentControlLifecycle {
  readonly #backend: AgentControlLifecycleBackend;
  readonly #unsubscribe: () => void;
  #transitionTail: Promise<void> = Promise.resolve();
  #disposePromise: Promise<void> | null = null;
  #disposed = false;

  constructor(session: ZhiyuanPasswordSession, backend: AgentControlLifecycleBackend) {
    this.#backend = backend;
    this.#unsubscribe = session.onDidChange(() => this.#transition(session.snapshot()));
  }

  dispose(): Promise<void> {
    if (this.#disposePromise) return this.#disposePromise;
    this.#disposed = true;
    this.#unsubscribe();
    this.#disposePromise = this.#transitionTail
      .catch(() => undefined)
      .then(() => this.#backend.close());
    return this.#disposePromise;
  }

  #transition(snapshot: ZhiyuanSessionSnapshot): Promise<void> {
    const transition = this.#transitionTail.then(async () => {
      if (this.#disposed) return;
      if (snapshot.status === 'authenticated') {
        this.#backend.start();
      } else {
        await this.#backend.stop();
      }
    });
    this.#transitionTail = transition.catch(() => undefined);
    return transition;
  }
}
