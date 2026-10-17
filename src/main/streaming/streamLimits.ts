/** IPC coalescing limits (aligned with Cherry Studio WebContentsListener design). */
export const StreamCoalesceLimits = {
  WindowMs: 16,
  MaxAgeMs: 32,
  MaxChars: 2048,
} as const;
