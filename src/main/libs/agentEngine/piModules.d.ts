/**
 * Type declarations for Pi ESM-only packages.
 *
 * These packages use package.json "exports" with only an "import" condition
 * (no "require"), which TypeScript's CommonJS moduleResolution cannot resolve.
 * This shim provides the types for tsc --noEmit while Vite/esbuild handles the
 * actual module resolution at build time.
 */

declare module '@earendil-works/pi-coding-agent' {
  export class DefaultResourceLoader {
    constructor(options: {
      cwd: string;
      agentDir: string;
      systemPromptOverride?: (base: string | undefined) => string | undefined;
      appendSystemPromptOverride?: (base: string[]) => string[];
    });
    reload(): Promise<void>;
  }

  export function getAgentDir(): string;

  export const AuthStorage: {
    inMemory(): {
      setRuntimeApiKey(provider: string, apiKey: string): void;
    };
  };
  export function createAgentSession(options?: Record<string, unknown>): Promise<{
    session: {
      prompt(text: string): Promise<void>;
      abort(): Promise<void>;
      setModel(model: unknown): Promise<void>;
      subscribe(
        listener: (event: {
          type: string;
          message?: {
            id?: string;
            role: string;
            content: string | Array<{ type: string; text?: string; textDelta?: string }>;
            stopReason?: string;
            errorMessage?: string;
          };
        }) => void,
      ): () => void;
    };
  }>;
}

declare module '@earendil-works/pi-ai/compat' {
  export function getModel(provider: string, modelId: string): unknown;
  export function completeSimple(
    model: unknown,
    context: { messages: Array<{ role: string; content: string }> },
    options?: { apiKey?: string },
  ): Promise<{ content: Array<{ text: string }> }>;
}
