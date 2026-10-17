import { useCallback, useState } from 'react';
import { useDispatch } from 'react-redux';

import { i18nService } from '../../../services/i18n';
import { addDraftAttachment, setDraftAttachments } from '../../../store/slices/coworkSlice';
import type { Model } from '../../../store/slices/modelSlice';
import { getFileNameFromPath, isImageMimeType, isImagePath } from './promptInputUtils';
import type { CoworkAttachment } from './types';

interface UsePromptAttachmentsParams {
  draftKey: string;
  attachments: CoworkAttachment[];
  disabled: boolean;
  isStreaming: boolean;
  workingDirectory: string;
  modelSupportsImage: boolean;
  effectiveSelectedModel: Model | null;
  setImageVisionHint: (hint: boolean) => void;
}

/**
 * Attachment intake for the composer: turns picked, dropped and pasted files
 * into draft attachments. Path-based images preview via localfile://, so
 * Redux stays free of base64 dataUrls; clipboard/browser images are staged
 * to disk and only kept in memory when staging fails.
 */
export function usePromptAttachments({
  draftKey,
  attachments,
  disabled,
  isStreaming,
  workingDirectory,
  modelSupportsImage,
  effectiveSelectedModel,
  setImageVisionHint,
}: UsePromptAttachmentsParams) {
  const dispatch = useDispatch();
  const [isAddingFile, setIsAddingFile] = useState(false);

  const addAttachment = useCallback(
    (filePath: string, imageInfo?: { isImage: boolean; dataUrl?: string }) => {
      if (!filePath) return;
      dispatch(
        addDraftAttachment({
          draftKey,
          attachment: {
            path: filePath,
            name: getFileNameFromPath(filePath),
            isImage: imageInfo?.isImage,
            dataUrl: imageInfo?.dataUrl,
          },
        }),
      );
    },
    [dispatch, draftKey],
  );

  const addImageAttachmentFromDataUrl = useCallback(
    (name: string, dataUrl: string) => {
      // Use the dataUrl as the unique key (no file path for inline images)
      const pseudoPath = `inline:${name}:${Date.now()}`;
      dispatch(
        addDraftAttachment({
          draftKey,
          attachment: {
            path: pseudoPath,
            name,
            isImage: true,
            dataUrl,
          },
        }),
      );
    },
    [dispatch, draftKey],
  );

  const fileToDataUrl = useCallback((file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result;
        if (typeof result !== 'string') {
          reject(new Error('Failed to read file'));
          return;
        }
        resolve(result);
      };
      reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  }, []);

  const fileToBase64 = useCallback((file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result;
        if (typeof result !== 'string') {
          reject(new Error('Failed to read file'));
          return;
        }
        const commaIndex = result.indexOf(',');
        resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
      };
      reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  }, []);

  const getNativeFilePath = useCallback((file: File): string | null => {
    const maybePath = (file as File & { path?: string }).path;
    if (typeof maybePath === 'string' && maybePath.trim()) {
      return maybePath;
    }
    return null;
  }, []);

  const saveInlineFile = useCallback(
    async (file: File): Promise<string | null> => {
      try {
        const dataBase64 = await fileToBase64(file);
        if (!dataBase64) {
          return null;
        }
        const result = await window.electron.dialog.saveInlineFile({
          dataBase64,
          fileName: file.name,
          mimeType: file.type,
          cwd: workingDirectory,
        });
        if (result.success && result.path) {
          return result.path;
        }
        return null;
      } catch (error) {
        console.error('Failed to save inline file:', error);
        return null;
      }
    },
    [fileToBase64, workingDirectory],
  );

  const handleIncomingFiles = useCallback(
    async (fileList: FileList | File[]) => {
      if (disabled || isStreaming) return;
      const files = Array.from(fileList ?? []);
      if (files.length === 0) return;

      let hasImageWithoutVision = false;
      for (const file of files) {
        const nativePath = getNativeFilePath(file);

        // Check if this is an image file and model supports images
        const fileIsImage = nativePath ? isImagePath(nativePath) : isImageMimeType(file.type);

        console.log('[CoworkPromptInput] handleIncomingFiles: processing file', {
          name: file.name,
          type: file.type,
          size: file.size,
          nativePath,
          fileIsImage,
          modelSupportsImage,
          effectiveModelId: effectiveSelectedModel?.id ?? null,
          effectiveModelSupportsImage: effectiveSelectedModel?.supportsImage ?? null,
        });

        if (fileIsImage) {
          if (modelSupportsImage) {
            // Path-based images preview via localfile:// — keep Redux free of base64 dataUrls.
            if (nativePath) {
              addAttachment(nativePath, { isImage: true });
            } else {
              // Clipboard/browser drag: stage to disk when possible; only keep dataUrl
              // for true in-memory fallbacks with no path.
              let dataUrl: string | null = null;
              try {
                dataUrl = await fileToDataUrl(file);
                console.log('[CoworkPromptInput] handleIncomingFiles: clipboard fileToDataUrl OK', {
                  dataUrlLength: dataUrl?.length ?? 0,
                });
              } catch (error) {
                console.error(
                  '[CoworkPromptInput] handleIncomingFiles: clipboard fileToDataUrl FAILED:',
                  error,
                );
              }

              const stagedPath = await saveInlineFile(file);
              console.log(
                '[CoworkPromptInput] handleIncomingFiles: clipboard saveInlineFile result',
                { stagedPath, hasDataUrl: !!dataUrl },
              );

              if (stagedPath) {
                addAttachment(stagedPath, { isImage: true });
              } else if (dataUrl) {
                console.warn('Clipboard image saved only in memory (disk save failed)');
                addImageAttachmentFromDataUrl(file.name, dataUrl);
              } else {
                console.error(
                  'Failed to process clipboard image: both dataUrl and disk save failed',
                );
              }
            }
            continue;
          }
          // Model doesn't support image input — add as file path and show hint
          console.warn(
            '[CoworkPromptInput] handleIncomingFiles: image skipped vision path because modelSupportsImage=false',
            {
              fileName: file.name,
              effectiveModelId: effectiveSelectedModel?.id ?? null,
              effectiveModelSupportsImage: effectiveSelectedModel?.supportsImage ?? null,
            },
          );
          hasImageWithoutVision = true;
        }

        // Non-image file or model doesn't support images: use original flow
        if (nativePath) {
          addAttachment(nativePath, fileIsImage ? { isImage: true } : undefined);
          continue;
        }

        const stagedPath = await saveInlineFile(file);
        if (stagedPath) {
          addAttachment(stagedPath, fileIsImage ? { isImage: true } : undefined);
        }
      }
      if (hasImageWithoutVision) {
        setImageVisionHint(true);
      }
    },
    [
      addAttachment,
      addImageAttachmentFromDataUrl,
      disabled,
      effectiveSelectedModel,
      fileToDataUrl,
      getNativeFilePath,
      isStreaming,
      modelSupportsImage,
      saveInlineFile,
      setImageVisionHint,
    ],
  );

  const handleAddFile = useCallback(async () => {
    if (isAddingFile || disabled || isStreaming) return;
    setIsAddingFile(true);
    try {
      const result = await window.electron.dialog.selectFiles({
        title: i18nService.t('coworkAddFile'),
      });
      if (!result.success || result.paths.length === 0) return;
      let hasImageWithoutVision = false;
      for (const filePath of result.paths) {
        if (isImagePath(filePath)) {
          if (!modelSupportsImage) {
            console.warn(
              '[CoworkPromptInput] handleAddFile: image skipped vision path because modelSupportsImage=false',
              {
                filePath,
                effectiveModelId: effectiveSelectedModel?.id ?? null,
              },
            );
            hasImageWithoutVision = true;
          }
          addAttachment(filePath, { isImage: true });
          continue;
        }
        addAttachment(filePath);
      }
      if (hasImageWithoutVision) {
        setImageVisionHint(true);
      }
    } catch (error) {
      console.error('Failed to select file:', error);
    } finally {
      setIsAddingFile(false);
    }
  }, [
    addAttachment,
    effectiveSelectedModel,
    isAddingFile,
    disabled,
    isStreaming,
    modelSupportsImage,
    setImageVisionHint,
  ]);

  const handleRemoveAttachment = useCallback(
    (path: string) => {
      dispatch(
        setDraftAttachments({
          draftKey,
          attachments: attachments.filter(attachment => attachment.path !== path),
        }),
      );
    },
    [attachments, dispatch, draftKey],
  );

  return {
    isAddingFile,
    handleIncomingFiles,
    handleAddFile,
    handleRemoveAttachment,
  };
}
