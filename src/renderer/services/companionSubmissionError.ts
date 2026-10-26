import { CompanionAttachmentIssue } from '../../shared/companion/constants';
import { CompanionImageIssue } from '../../shared/companion/images';

export function companionSubmissionError(failure: unknown, taskMode: boolean): string {
  const message = failure instanceof Error ? failure.message : '';
  if (message.includes(CompanionImageIssue.TooLarge)) return 'companionImageTooLarge';
  if (message.includes(CompanionImageIssue.Unsupported)) return 'companionAttachmentsWorkbench';
  if (message.includes(CompanionImageIssue.Invalid)) return 'companionImageInvalid';
  if (
    message.includes(CompanionAttachmentIssue.Unavailable) ||
    message.includes(CompanionImageIssue.Unavailable)
  )
    return 'companionFileUnavailable';
  return taskMode ? 'companionTaskSubmitFailed' : 'companionSendFailed';
}
