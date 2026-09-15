/** Minimal expert snapshot shape needed to build a coding session prompt. */
export interface CodingExpertPromptSnapshot {
  promptSnapshot: string;
}

export interface CodingExpertSelection {
  /** Experts the turn runs with; an empty list clears the selection. */
  expertIds: string[];
  /** Expert prompt text, or an empty string when the selection is cleared. */
  systemPrompt: string;
}

/**
 * The built-in coding agent runs with Pi's own coding prompt, and the runtime
 * appends a custom `systemPrompt` instead of replacing that base prompt, so an
 * expert contributes its preset snapshot on top of the coding instructions.
 * The expert id additionally loads the expert package's bundled skills.
 *
 * A stale selection (the expert was deleted after the lane advertised it) makes
 * the resolver throw. That failure is left to the caller on purpose: running the
 * turn without the expert the user asked for is worse than a visible error.
 */
export const resolveCodingExpertSelection = (input: {
  expertIds: readonly string[];
  resolveSnapshots: (expertIds: string[]) => readonly CodingExpertPromptSnapshot[];
}): CodingExpertSelection => {
  if (input.expertIds.length === 0) return { expertIds: [], systemPrompt: '' };
  const snapshots = input.resolveSnapshots([...input.expertIds]);
  return {
    expertIds: [...input.expertIds],
    systemPrompt: snapshots
      .map(snapshot => snapshot.promptSnapshot.trim())
      .filter(Boolean)
      .join('\n\n'),
  };
};
