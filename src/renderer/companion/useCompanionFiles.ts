import { useRef, useState } from 'react';
import type { CompanionWindowApi } from '../../shared/companion/types';
import { CompanionAttachmentIssue } from '../../shared/companion/constants';
import {
  CompanionImageIssue,
  isCompanionImageFile,
  isCompanionImageName,
} from '../../shared/companion/images';
import {
  COMPANION_MAX_ATTACHMENTS,
  COMPANION_MAX_ATTACHMENT_BYTES,
  type CompanionAttachment,
} from '../../shared/companion/attachments';

interface Options {
  api?: CompanionWindowApi;
  disabled: boolean;
  imagesOnly?: boolean;
  activePetId(): string | null;
  attachments(): readonly CompanionAttachment[];
  onChange(files: CompanionAttachment[]): void;
  onError(key: string | null): void;
  onFocus(): void;
}

function readFile(file: File): Promise<Uint8Array<ArrayBuffer>> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error ?? new Error('File could not be read'));
    reader.onabort = () => reject(new Error('File reading was cancelled'));
    reader.readAsArrayBuffer(file);
  });
}

/** Picker, drop and paste share a lock and merge into the latest owning draft. */
export function useCompanionFiles(options: Options) {
  const [choosingFiles, setChoosingFiles] = useState(false);
  const locked = useRef(false);
  const run = async (operation: (petId: string, api: CompanionWindowApi) => Promise<void>) => {
    const petId = options.activePetId();
    if (!petId || options.disabled || locked.current || !options.api) return;
    locked.current = true;
    setChoosingFiles(true);
    try {
      await operation(petId, options.api);
      if (options.activePetId() === petId) options.onFocus();
    } catch (failure) {
      if (options.activePetId() !== petId) return;
      const message = failure instanceof Error ? failure.message : '';
      options.onError(
        message.includes(CompanionImageIssue.Unsupported)
          ? 'companionAttachmentsWorkbench'
          : message.includes(CompanionAttachmentIssue.TooLarge)
            ? 'companionFileTooLarge'
            : message.includes(CompanionAttachmentIssue.TooMany)
              ? 'companionFilesLimit'
              : 'companionFilesFailed',
      );
    } finally {
      locked.current = false;
      setChoosingFiles(false);
    }
  };
  const merge = (petId: string, selected: CompanionAttachment[]) => {
    if (options.activePetId() !== petId || !selected.length) return;
    const attachments = [...options.attachments(), ...selected];
    if (attachments.length > COMPANION_MAX_ATTACHMENTS)
      throw new Error(CompanionAttachmentIssue.TooMany);
    options.onChange(attachments);
    options.onError(null);
  };
  const chooseFiles = () =>
    run(async (petId, api) => {
      const selected = await api.chooseFiles(petId);
      if (options.imagesOnly && selected.some(file => !isCompanionImageName(file.name)))
        throw new Error(CompanionImageIssue.Unsupported);
      merge(petId, selected);
    });
  const addFiles = (incoming: FileList | File[]) =>
    run(async (petId, api) => {
      const files = Array.from(incoming);
      if (options.imagesOnly && files.some(file => !isCompanionImageFile(file)))
        throw new Error(CompanionImageIssue.Unsupported);
      if (options.attachments().length + files.length > COMPANION_MAX_ATTACHMENTS)
        throw new Error(CompanionAttachmentIssue.TooMany);
      if (files.some(file => file.size > COMPANION_MAX_ATTACHMENT_BYTES))
        throw new Error(CompanionAttachmentIssue.TooLarge);
      // One file in flight bounds binary IPC; acknowledged files survive a later read failure.
      for (const file of files) {
        if (options.activePetId() !== petId) return;
        const data = await readFile(file);
        if (options.activePetId() !== petId) return;
        const selected = await api.stageFile(petId, { name: file.name, mimeType: file.type, data });
        merge(petId, [selected]);
      }
    });
  return { choosingFiles, chooseFiles, addFiles };
}
