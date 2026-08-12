interface CoworkContinuationSkillInput {
  activeSkillIds: string[] | undefined;
  expertSkillIds: string[];
  savedSkillIds: string[] | undefined;
}

export interface CoworkContinuationSkillState {
  runtimeSkillIds: string[];
  sessionSkillIds: string[] | undefined;
}

export const resolveCoworkContinuationSkillState = ({
  activeSkillIds,
  expertSkillIds,
  savedSkillIds,
}: CoworkContinuationSkillInput): CoworkContinuationSkillState => {
  const sessionSkillIds = activeSkillIds === undefined ? undefined : [...activeSkillIds];
  const runtimeSkillIds = [
    ...new Set([...(sessionSkillIds ?? savedSkillIds ?? []), ...expertSkillIds]),
  ];

  return { runtimeSkillIds, sessionSkillIds };
};
