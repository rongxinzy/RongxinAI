/** IPC coalescing limits (aligned with Cherry Studio WebContentsListener design). */
export const StreamCoalesceLimits = {
  WindowMs: 16,
  MaxAgeMs: 32,
  MaxChars: 2048,
  ReplayMaxChunks: 10_000,
  ReplayMaxDeltaBytes: 16_384,
  ReplayMaxBytes: 32_000_000,
} as const;
