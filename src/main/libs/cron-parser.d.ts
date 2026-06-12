/**
 * Minimal type declarations for cron-parser (MIT)
 * Used by openclawEngineManager.ts to enumerate missed cron job run boundaries.
 */
declare module 'cron-parser' {
  export const CronExpressionParser: {
    parse(expr: string, options?: {
      currentDate?: Date;
      tz?: string;
    }): CronParserInterval;
  };

  export interface CronParserInterval {
    hasNext(): boolean;
    next(): CronDate;
  }

  export interface CronDate {
    getTime(): number;
    toISOString(): string;
  }
}
