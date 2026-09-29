/** Check visibility without stripping meaningful characters from the submitted text. */
export function hasVisiblePromptContent(prompt: string): boolean {
  return /[^\p{White_Space}\p{Default_Ignorable_Code_Point}\p{Cc}]/u.test(prompt);
}

interface SubmissionContent {
  prompt: string;
  imageAttachments?: ReadonlyArray<{
    mimeType: string;
    base64Data?: string;
    path?: string;
  }>;
}

/** Files must already be represented by their paths in the prompt, as in the composer. */
export function hasCoworkSubmissionContent(input: SubmissionContent): boolean {
  return (
    hasVisiblePromptContent(input.prompt) ||
    Boolean(
      input.imageAttachments?.some(
        image =>
          image.mimeType.startsWith('image/') &&
          (Boolean(image.base64Data?.trim()) ||
            (hasVisiblePromptContent(image.path ?? '') &&
              !image.path?.trim().startsWith('inline:'))),
      ),
    )
  );
}

export function assertCoworkSubmissionContent(input: SubmissionContent): void {
  if (!hasCoworkSubmissionContent(input)) throw new Error('Prompt is required.');
}
