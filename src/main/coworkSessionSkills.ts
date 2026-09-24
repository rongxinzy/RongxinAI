interface CoworkContinuationSkillInput {
  /** Skills the user attached to this one input. Empty means "nothing picked this turn". */
  activeSkillIds: string[] | undefined;
  expertSkillIds: string[];
  /** The session's capability set persisted so far. */
  savedSkillIds: string[] | undefined;
}

export interface CoworkContinuationSkillState {
  /** Capability set after this turn: previously available skills plus this input's picks. */
  sessionSkillIds: string[];
  /** What the runtime loads for this turn: the capability set plus the expert preset bundle. */
  runtimeSkillIds: string[];
}

/**
 * Skills are a session-level capability, not a per-message attachment: attaching
 * one adds it to the session's set, and the set never shrinks on its own. Callers
 * that mean "no skills this turn" pass an empty array and the session set simply
 * stays as it was; removing a skill is an explicit session edit.
 *
 * The expert preset bundle rides alongside the capability set and is never
 * persisted as a user selection.
 */
export const resolveCoworkContinuationSkillState = ({
  activeSkillIds,
  expertSkillIds,
  savedSkillIds,
}: CoworkContinuationSkillInput): CoworkContinuationSkillState => {
  const sessionSkillIds = [...new Set([...(savedSkillIds ?? []), ...(activeSkillIds ?? [])])];
  const runtimeSkillIds = [...new Set([...sessionSkillIds, ...expertSkillIds])];

  return { sessionSkillIds, runtimeSkillIds };
};
