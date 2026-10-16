import { useCallback, useRef } from 'react';
import { useDispatch } from 'react-redux';

import {
  hasCoworkSubmissionContent,
  hasVisiblePromptContent,
} from '../../../../shared/cowork/submissionContent';
import { showAppToast } from '../../../services/appToast';
import { i18nService } from '../../../services/i18n';
import {
  clearDraftAttachments,
  setDraftAttachments,
  setDraftPrompt,
} from '../../../store/slices/coworkSlice';
import { clearSelection } from '../../../store/slices/quickActionSlice';
import { activateSkill, clearActiveSkills } from '../../../store/slices/skillSlice';
import type { Model } from '../../../store/slices/modelSlice';
import type { Skill } from '../../../types/skill';
import type { CoworkFileAttachment, CoworkImageAttachment } from '../../../types/cowork';
import { parseCoworkSlashSubmission } from '../coworkSlashCommands';
import { extractBase64FromDataUrl, isImagePath } from './promptInputUtils';
import type { CoworkAttachment, CoworkPromptInputProps } from './types';

interface UseCoworkPromptSubmissionParams {
  onSubmit: CoworkPromptInputProps['onSubmit'];
  value: string;
  setValue: (value: string) => void;
  attachments: CoworkAttachment[];
  draftKey: string;
  sessionId?: string;
  disabled: boolean;
  sessionContextPending: boolean;
  isStreaming: boolean;
  canQueueWhileStreaming: boolean;
  isPatchingModel: boolean;
  hasUnavailableLlamaCppModel: boolean;
  resumeTaskActive: boolean;
  showFolderSelector: boolean;
  workingDirectory: string;
  setShowFolderRequiredWarning: (value: boolean) => void;
  effectiveSelectedModel: Model | null;
  modelSupportsImage: boolean;
  selectedExpertIds: string[];
  goalMode: boolean;
  activeSkillIds: string[];
  slashEnabledSkills: Skill[];
  findSlashSkill: (skillId: string) => Skill | undefined;
  runSlashCompact: () => Promise<void>;
  setImageVisionHint: (hint: boolean) => void;
}

/**
 * The composer's submit pipeline: folder-required guard, slash-command
 * resolution, attachment-to-image/file conversion, prompt assembly and the
 * post-submit state transitions (draft clearing and restore-on-reject).
 */
export function useCoworkPromptSubmission({
  onSubmit,
  value,
  setValue,
  attachments,
  draftKey,
  sessionId,
  disabled,
  sessionContextPending,
  isStreaming,
  canQueueWhileStreaming,
  isPatchingModel,
  hasUnavailableLlamaCppModel,
  resumeTaskActive,
  showFolderSelector,
  workingDirectory,
  setShowFolderRequiredWarning,
  effectiveSelectedModel,
  modelSupportsImage,
  selectedExpertIds,
  goalMode,
  activeSkillIds,
  slashEnabledSkills,
  findSlashSkill,
  runSlashCompact,
  setImageVisionHint,
}: UseCoworkPromptSubmissionParams) {
  const dispatch = useDispatch();
  const warningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cancel a pending folder-warning auto-hide timer (e.g. when the input
  // re-targets another session). Clearing an already-fired handle is a
  // no-op, so nulling the ref keeps this equivalent to the previous inline
  // `if (t) clearTimeout(t)` cleanup.
  const cancelFolderWarningTimer = useCallback(() => {
    if (warningTimerRef.current) {
      clearTimeout(warningTimerRef.current);
      warningTimerRef.current = null;
    }
  }, []);

  const submitPrompt = useCallback(async () => {
    if (showFolderSelector && !workingDirectory?.trim()) {
      setShowFolderRequiredWarning(true);
      if (warningTimerRef.current) clearTimeout(warningTimerRef.current);
      warningTimerRef.current = setTimeout(() => {
        setShowFolderRequiredWarning(false);
        warningTimerRef.current = null;
      }, 3000);
      return;
    }

    const trimmedValue = hasVisiblePromptContent(value) ? value.trim() : '';

    // Slash commands are resolved before the normal submission guards: a
    // control command (`/compact`) and a bare selection (`/skill <id>`)
    // never become model input, and a selection with a body replaces the
    // prompt text with that body. Unknown slash text falls through
    // unchanged so it still reaches the model.
    let promptText = trimmedValue;
    if (trimmedValue) {
      const slashSubmission = parseCoworkSlashSubmission(trimmedValue, {
        skillIds: slashEnabledSkills.map(skill => skill.id),
        compactAvailable: !!sessionId,
      });
      if (slashSubmission.kind === 'compact') {
        if (disabled || sessionContextPending) return;
        setValue('');
        dispatch(setDraftPrompt({ sessionId: draftKey, draft: '' }));
        void runSlashCompact();
        return;
      }
      if (slashSubmission.kind === 'skill') {
        const skill = findSlashSkill(slashSubmission.skillId);
        if (skill) {
          dispatch(activateSkill(skill.id));
          if (!slashSubmission.body) {
            setValue('');
            dispatch(setDraftPrompt({ sessionId: draftKey, draft: '' }));
            showAppToast(
              `${i18nService.t('coworkSlashSkillActivated')}: ${skill.displayName || skill.name}`,
            );
            return;
          }
          promptText = slashSubmission.body;
        }
      }
    }

    if (
      (!trimmedValue && attachments.length === 0 && !resumeTaskActive) ||
      (isStreaming && !canQueueWhileStreaming) ||
      disabled ||
      sessionContextPending ||
      isPatchingModel
    )
      return;
    if (hasUnavailableLlamaCppModel) {
      window.dispatchEvent(
        new CustomEvent('app:showToast', {
          detail: i18nService.t('agentLlamaCppModelNotRunningBlocked'),
        }),
      );
      return;
    }
    setShowFolderRequiredWarning(false);

    // Skills stay visible to the model through the session's capability set
    // (Pi renders them into the system prompt from their directories), so the
    // submission never inlines skill text.

    // Extract image attachments (with base64 data) for vision-capable models
    console.log('[CoworkPromptInput] handleSubmit: attachment diagnosis', {
      totalAttachments: attachments.length,
      modelSupportsImage,
      effectiveModelId: effectiveSelectedModel?.id ?? null,
      attachmentDetails: attachments.map(a => ({
        path: a.path,
        name: a.name,
        isImage: a.isImage,
        hasDataUrl: !!a.dataUrl,
        dataUrlLength: a.dataUrl?.length ?? 0,
      })),
    });
    const imageAtts: CoworkImageAttachment[] = [];
    const fileAtts: CoworkFileAttachment[] = [];
    for (const attachment of attachments) {
      if (attachment.isImage && attachment.dataUrl) {
        const extracted = extractBase64FromDataUrl(attachment.dataUrl);
        if (extracted) {
          imageAtts.push({
            name: attachment.name,
            mimeType: extracted.mimeType,
            base64Data: extracted.base64Data,
            // 保留真实磁盘路径,气泡侧才能把正文里的「输入文件: 路径」行与
            // 该图片识别为同一附件,避免一张图渲染成两张(inline: 伪路径除外)。
            ...(attachment.path && !attachment.path.startsWith('inline:')
              ? { path: attachment.path }
              : {}),
          });
        } else {
          console.warn('[CoworkPromptInput] handleSubmit: extractBase64FromDataUrl returned null', {
            name: attachment.name,
            dataUrlPrefix: attachment.dataUrl.slice(0, 60),
          });
        }
      } else if (attachment.isImage && attachment.path && !attachment.path.startsWith('inline:')) {
        const readResult = await window.electron?.dialog?.readFileAsDataUrl(attachment.path);
        const extracted =
          readResult?.success && readResult.dataUrl
            ? extractBase64FromDataUrl(readResult.dataUrl)
            : null;
        if (extracted) {
          imageAtts.push({
            name: attachment.name,
            mimeType: extracted.mimeType,
            base64Data: extracted.base64Data,
            path: attachment.path,
          });
        } else {
          const dotIndex = attachment.name.lastIndexOf('.');
          fileAtts.push({
            name: attachment.name,
            path: attachment.path,
            extension: dotIndex >= 0 ? attachment.name.slice(dotIndex + 1).toUpperCase() : 'FILE',
            isImage: true,
          });
        }
      } else if (attachment.isImage) {
        console.warn('[CoworkPromptInput] handleSubmit: image attachment missing dataUrl', {
          path: attachment.path,
          name: attachment.name,
          isImage: attachment.isImage,
          hasDataUrl: !!attachment.dataUrl,
        });
        const dotIndex = attachment.name.lastIndexOf('.');
        fileAtts.push({
          name: attachment.name,
          path: attachment.path,
          extension: dotIndex >= 0 ? attachment.name.slice(dotIndex + 1).toUpperCase() : 'FILE',
          isImage: true,
        });
      } else {
        const dotIndex = attachment.name.lastIndexOf('.');
        fileAtts.push({
          name: attachment.name,
          path: attachment.path,
          extension: dotIndex >= 0 ? attachment.name.slice(dotIndex + 1).toUpperCase() : 'FILE',
        });
      }
    }

    // Build prompt with ALL attachments that have real file paths (both regular files and images).
    // Image attachments also need their file paths in the prompt so the model knows
    // where the original files are located (e.g., for skills like seedream that need --image <path>).
    // Note: inline/clipboard images have pseudo-paths starting with 'inline:' and are excluded.
    // Note: image attachments that already carry base64 data are excluded — their content
    // is delivered via the attachments parameter of chat.send. Including the file path
    // would trigger native image-path detection, which rejects paths outside allowed
    // directories and can drop the base64 image during sanitization (macOS-only bug).
    const attachmentLines = attachments
      .filter(
        a =>
          hasVisiblePromptContent(a.path) &&
          !a.path.startsWith('inline:') &&
          !(a.isImage && a.dataUrl),
      )
      .map(attachment => `${i18nService.t('inputFileLabel')}: ${attachment.path}`)
      .join('\n');
    const finalPrompt = promptText
      ? attachmentLines
        ? `${attachmentLines}\n\n${promptText}`
        : promptText
      : attachmentLines;

    if (
      !resumeTaskActive &&
      !hasCoworkSubmissionContent({ prompt: finalPrompt, imageAttachments: imageAtts })
    ) {
      // 2026/09/28 之前这里是静默 return：按钮看起来可用，点下去却什么都不发生。
      const unusableImage = attachments.some(a => a.isImage || isImagePath(a.path));
      window.dispatchEvent(
        new CustomEvent('app:showToast', {
          detail: {
            message: i18nService.t(unusableImage ? 'imageReadError' : 'coworkSubmitEmptyContent'),
            isError: true,
          },
        }),
      );
      return;
    }

    if (imageAtts.length > 0) {
      console.log('[CoworkPromptInput] handleSubmit: passing imageAtts to onSubmit', {
        count: imageAtts.length,
        names: imageAtts.map(a => a.name),
        base64Lengths: imageAtts.map(a => a.base64Data?.length ?? 0),
      });
    } else if (attachments.some(a => a.isImage || isImagePath(a.path))) {
      console.warn(
        '[CoworkPromptInput] handleSubmit: has image-like attachments but imageAtts is EMPTY — images will NOT be sent as base64',
        {
          imageAttachments: attachments
            .filter(a => a.isImage || isImagePath(a.path))
            .map(a => ({
              path: a.path,
              isImage: a.isImage,
              hasDataUrl: !!a.dataUrl,
            })),
        },
      );
    }
    // Clear input immediately; don't wait for the AI response.
    setValue('');
    dispatch(setDraftPrompt({ sessionId: draftKey, draft: '' }));
    dispatch(clearDraftAttachments(draftKey));
    setImageVisionHint(false);
    const result = await onSubmit(
      finalPrompt,
      imageAtts.length > 0 ? imageAtts : undefined,
      fileAtts.length > 0 ? fileAtts : undefined,
      selectedExpertIds,
      goalMode,
    );
    if (result === false) {
      // Submission rejected — restore the prompt so the user can retry.
      setValue(finalPrompt);
      dispatch(setDraftPrompt({ sessionId: draftKey, draft: finalPrompt }));
      dispatch(setDraftAttachments({ draftKey, attachments }));
    } else if (activeSkillIds.length > 0) {
      // Keyed on the selection itself: an id that no longer resolves to a
      // loaded skill would otherwise keep the selection alive for the next turn.
      // Skills describe this one input only. Clear their selection after a
      // successful send so the next message starts with a clean context.
      dispatch(clearActiveSkills());
      dispatch(clearSelection());
    }
  }, [
    value,
    isStreaming,
    disabled,
    sessionContextPending,
    isPatchingModel,
    hasUnavailableLlamaCppModel,
    onSubmit,
    activeSkillIds,
    attachments,
    showFolderSelector,
    workingDirectory,
    dispatch,
    draftKey,
    effectiveSelectedModel?.id,
    modelSupportsImage,
    selectedExpertIds,
    goalMode,
    canQueueWhileStreaming,
    resumeTaskActive,
    sessionId,
    setImageVisionHint,
    setShowFolderRequiredWarning,
    setValue,
    slashEnabledSkills,
    findSlashSkill,
    runSlashCompact,
  ]);

  return { submitPrompt, cancelFolderWarningTimer };
}
