import { useState } from 'react';
import type { CompanionWindowApi } from '../../shared/companion/types';
import { CompanionAttachmentIssue } from '../../shared/companion/constants';
import {
  COMPANION_MAX_ATTACHMENTS,
  type CompanionAttachment,
} from '../../shared/companion/attachments';

interface Options {
  api?: CompanionWindowApi;
  disabled: boolean;
  activePetId(): string | null;
  attachments(): readonly CompanionAttachment[];
  onChange(files: CompanionAttachment[]): void;
  onError(key: string | null): void;
  onFocus(): void;
}

/** Native dialog results merge into the latest draft, never the profile that replaced it. */
export function useCompanionFiles(options: Options) {
  const [choosingFiles, setChoosingFiles] = useState(false);
  const chooseFiles = async () => {
    const petId = options.activePetId();
    if (!petId || options.disabled || choosingFiles || !options.api) return;
    setChoosingFiles(true);
    try {
      const selected = await options.api.chooseFiles(petId);
      if (options.activePetId() !== petId || !selected.length) return;
      const attachments = [...options.attachments(), ...selected];
      if (attachments.length > COMPANION_MAX_ATTACHMENTS) {
        options.onError('companionFilesLimit');
        return;
      }
      options.onChange(attachments);
      options.onError(null);
      options.onFocus();
    } catch (failure) {
      if (options.activePetId() !== petId) return;
      const message = failure instanceof Error ? failure.message : '';
      options.onError(
        message.includes(CompanionAttachmentIssue.TooLarge)
          ? 'companionFileTooLarge'
          : message.includes(CompanionAttachmentIssue.TooMany)
            ? 'companionFilesLimit'
            : 'companionFilesFailed',
      );
    } finally {
      setChoosingFiles(false);
    }
  };
  return { choosingFiles, chooseFiles };
}
