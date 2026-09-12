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

/**
 * Suffix that turns a fused edit/write tool call id into the synthetic id of
 * its embedded `then_run` bash approval. Must stay in lockstep with the vendor
 * literal in `vendor/sol-pi/extensions/action-fusion/then-run.ts` (the id the
 * inner bash tool runs under); the drift is pinned by test.
 */
export const SOLPI_THEN_RUN_ID_SUFFIX = ':then_run';

/** Synthetic tool call id under which a fused then_run command is authorized. */
export function buildSolPiThenRunToolCallId(toolCallId: string): string {
  return `${toolCallId}${SOLPI_THEN_RUN_ID_SUFFIX}`;
}
