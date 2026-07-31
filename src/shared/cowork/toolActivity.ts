export const CoworkToolActivityPhase = {
  Preparing: 'preparing',
  Running: 'running',
} as const;

export type CoworkToolActivityPhase =
  (typeof CoworkToolActivityPhase)[keyof typeof CoworkToolActivityPhase];

export const CoworkToolActivityEventType = {
  Upsert: 'upsert',
  Remove: 'remove',
  Clear: 'clear',
} as const;

export type CoworkToolActivity = {
  toolCallId: string;
  phase: CoworkToolActivityPhase;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  updatedAt: number;
};

export type CoworkToolActivityEvent =
  | {
      type: typeof CoworkToolActivityEventType.Upsert;
      activity: CoworkToolActivity;
    }
  | {
      type: typeof CoworkToolActivityEventType.Remove;
      toolCallId: string;
    }
  | {
      type: typeof CoworkToolActivityEventType.Clear;
    };
