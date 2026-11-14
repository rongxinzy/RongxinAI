/** Structural host contracts consumed by @sigrun/memory-markdown 0.3.1.
 * No Sigrun server implementation is supplied or loaded by this declaration. */
export interface SettingsDeclaration { readonly schema: Readonly<Record<string, unknown>> }
export interface DeclaredSettings<S, U = Record<string, never>> {
  get(user?: string): Promise<S>;
  readonly userSettings?: U;
}
export interface CurationRunResult { readonly status: string; readonly text: string }
export interface MaintenanceBudget {
  readonly runs: number;
  readonly deadline: number;
  run(input: string, tools: readonly string[]): Promise<CurationRunResult>;
}
export interface CurationTarget {
  readonly name: string;
  readonly tools: readonly string[];
  guidance(user: string): readonly string[] | Promise<readonly string[]>;
  undo(user: string, changeId: string, context: unknown): Promise<void>;
  maintain(user: string, context: unknown, budget: MaintenanceBudget): Promise<{
    readonly changes: readonly { readonly changeId: string; readonly summary: string }[];
    readonly more: boolean;
  }>;
}
