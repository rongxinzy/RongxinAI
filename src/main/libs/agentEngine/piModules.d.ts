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

  export class SettingsManager {
    static create(cwd: string, agentDir?: string): SettingsManager;
    applyOverrides(overrides: { shellPath?: string }): void;
    getShellPath(): string | undefined;
  }

  export function getAgentDir(): string;

  export const ModelRuntime: {
    create(): Promise<{
      registerProvider(provider: string, config: Record<string, unknown>): void;
      setRuntimeApiKey(provider: string, apiKey: string): Promise<void>;
      getModel(provider: string, modelId: string): unknown;
      completeSimple(
        model: unknown,
        context: { messages: Array<{ role: string; content: string }> },
      ): Promise<{ content: Array<{ text: string }> }>;
    }>;
  };
  export function createAgentSession(options?: Record<string, unknown>): Promise<{
    session: {
      prompt(text: string): Promise<void>;
      sendUserMessage(
        content:
          | string
          | Array<
              { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }
            >,
        options?: { deliverAs?: 'steer' | 'followUp' },
      ): Promise<void>;
      steer(text: string): Promise<void>;
      abort(): Promise<void>;
      reload(): Promise<void>;
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
