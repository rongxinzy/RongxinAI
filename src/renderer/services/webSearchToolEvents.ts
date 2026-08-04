export const WebSearchToolEventType = {
  Start: 'start',
  Complete: 'complete',
  Error: 'error',
} as const;

export type WebSearchToolEvent =
  | {
      type: typeof WebSearchToolEventType.Start;
      toolCallId: string;
      input: Record<string, unknown>;
    }
  | {
      type: typeof WebSearchToolEventType.Complete;
      toolCallId: string;
      output: unknown;
    }
  | {
      type: typeof WebSearchToolEventType.Error;
      toolCallId: string;
      error: string;
    };

export type WebSearchToolEventHandler = (event: WebSearchToolEvent) => void;
