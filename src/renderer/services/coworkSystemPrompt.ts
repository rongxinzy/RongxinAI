/** Join the explicitly selected skill prompt with the mode's base prompt. */
export const buildCoworkSystemPrompt = (
  skillPrompt: string | undefined,
  baseSystemPrompt: string | undefined,
): string | undefined =>
  [skillPrompt, baseSystemPrompt].filter(part => part?.trim()).join('\n\n') || undefined;
