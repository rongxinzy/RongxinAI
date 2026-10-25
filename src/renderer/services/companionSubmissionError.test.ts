import { expect, test } from 'vitest';
import { CompanionImageIssue } from '../../shared/companion/images';
import { CompanionAttachmentIssue } from '../../shared/companion/constants';
import { companionSubmissionError } from './companionSubmissionError';

test('image errors distinguish format, corruption, size and lost references without exposing paths', () => {
  for (const [issue, key] of [
    [CompanionImageIssue.Unsupported, 'companionAttachmentsWorkbench'],
    [CompanionImageIssue.Invalid, 'companionImageInvalid'],
    [CompanionImageIssue.TooLarge, 'companionImageTooLarge'],
    [CompanionImageIssue.Unavailable, 'companionFileUnavailable'],
    [CompanionAttachmentIssue.Unavailable, 'companionFileUnavailable'],
  ])
    expect(
      companionSubmissionError(new Error(`Remote error: ${issue}: /private/photo.png`), false),
    ).toBe(key);
  expect(companionSubmissionError(new Error('/private/upstream-details'), false)).toBe(
    'companionSendFailed',
  );
  expect(companionSubmissionError(undefined, true)).toBe('companionTaskSubmitFailed');
});
