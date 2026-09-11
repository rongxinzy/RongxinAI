/**
 * String constants owned by the SoL-Pi integration module.
 *
 * Per the repository's string-literal contract, discriminants compared in
 * multiple places live in one `as const` object; consumers import both the
 * value object and the derived type.
 */

/** Outcome of extracting `then_run` from a fused edit/write tool call input. */
export const SolPiThenRunStatus = {
  Absent: 'absent',
  Malformed: 'malformed',
  Present: 'present',
} as const;
export type SolPiThenRunStatus = (typeof SolPiThenRunStatus)[keyof typeof SolPiThenRunStatus];
