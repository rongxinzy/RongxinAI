export const shouldShowPresetExpertProfession = (
  displayName: string,
  profession: string,
): boolean => {
  const normalizedProfession = profession.trim();
  return normalizedProfession.length > 0 && normalizedProfession !== displayName.trim();
};
