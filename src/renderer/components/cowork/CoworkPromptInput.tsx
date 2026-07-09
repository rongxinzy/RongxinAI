import { ModelSelectorLogo, ModelSelectorName } from '@shared/components/ai-elements/model-selector';
import { Popover, PopoverContent, PopoverTrigger } from '@shared/components/ui/popover';
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from '@shared/components/ui/command';
import {
  PromptInput,
  PromptInputBody,
  PromptInputButton,
  PromptInputFooter,
  PromptInputProvider,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  usePromptInputController,
} from '@shared/components/ai-elements/prompt-input';
import { Button } from '@shared/components/ui/button';
import { cn } from '@shared/lib/utils';
import { Folder, Paperclip, TriangleAlert, X } from 'lucide-react';
import React, { useCallback,useEffect, useRef, useState } from 'react';
import { useDispatch,useSelector } from 'react-redux';

import { agentService } from '../../services/agent';
import { configService } from '../../services/config';
import { coworkService } from '../../services/cowork';
import { i18nService } from '../../services/i18n';
import { skillService } from '../../services/skill';
import { RootState } from '../../store';
import { selectDraftPrompts } from '../../store/selectors/coworkSelectors';
import {
  addDraftAttachment,
  clearDraftAttachments,
  type DraftAttachment,
  setDraftAttachments,
  setDraftPrompt,
  updateCurrentSessionModelOverride,
} from '../../store/slices/coworkSlice';
import type { Model } from '../../store/slices/modelSlice';
import { setSkills, toggleActiveSkill } from '../../store/slices/skillSlice';
import { CoworkImageAttachment } from '../../types/cowork';
import { Skill } from '../../types/skill';
import { toOpenClawModelRef } from '../../utils/openclawModelRef';
import { getCompactFolderName } from '../../utils/path';
import { ActiveSkillBadge,SkillsButton } from '../skills';
import { resolveAgentModelSelection, resolveEffectiveModel, useAgentSelectedModel } from './agentModelSelection';
import AttachmentCard from './AttachmentCard';
import FolderSelectorPopover from './FolderSelectorPopover';
import { usePersistAgentModelSelection } from './usePersistAgentModelSelection';

// CoworkAttachment is aliased from the Redux-persisted DraftAttachment type
// so that attachment state survives view switches (cowork ↔ skills, etc.)
type CoworkAttachment = DraftAttachment;

// Stable empty array reference to avoid unnecessary re-renders from useSelector
// returning a new [] on every call (when draftAttachments[draftKey] is undefined).
const EMPTY_ATTACHMENTS: DraftAttachment[] = [];

/** Skills available in Chat mode (no local filesystem access) */
const CHAT_SKILL_IDS = new Set(['docx', 'xlsx', 'pptx']);

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.tiff', '.tif', '.ico', '.avif']);

const isImagePath = (filePath: string): boolean => {
  const dotIndex = filePath.lastIndexOf('.');
  if (dotIndex === -1) return false;
  const ext = filePath.slice(dotIndex).toLowerCase();
  return IMAGE_EXTENSIONS.has(ext);
};

const isImageMimeType = (mimeType: string): boolean => {
  return mimeType.startsWith('image/');
};

const extractBase64FromDataUrl = (dataUrl: string): { mimeType: string; base64Data: string } | null => {
  const match = /^data:(.+);base64,(.*)$/.exec(dataUrl);
  if (!match) return null;
  return { mimeType: match[1], base64Data: match[2] };
};

const getFileNameFromPath = (path: string): string => {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || path;
};

const getSkillDirectoryFromPath = (skillPath: string): string => {
  const normalized = skillPath.trim().replace(/\\/g, '/');
  return normalized.replace(/\/SKILL\.md$/i, '') || normalized;
};

const buildInlinedSkillPrompt = (skill: Skill): string => {
  const skillDirectory = getSkillDirectoryFromPath(skill.skillPath);
  return [
    `## Skill: ${skill.name}`,
    '<skill_context>',
    `  <location>${skill.skillPath}</location>`,
    `  <directory>${skillDirectory}</directory>`,
    '  <path_rules>',
    '    Resolve relative file references from this skill against <directory>.',
    '    Do not assume skills are under the current workspace directory.',
    '  </path_rules>',
    '</skill_context>',
    '',
    skill.prompt,
  ].join('\n');
};

const isMacPlatform = navigator.platform.includes('Mac');

export interface CoworkPromptInputRef {
  /** 设置输入框值 */
  setValue: (value: string) => void;
  /** 设置图片附件（用于重新编辑消息时还原图片） */
  setImageAttachments: (images: CoworkImageAttachment[]) => void;
  /** 聚焦输入框 */
  focus: () => void;
}

interface CoworkPromptInputProps {
  onSubmit: (prompt: string, skillPrompt?: string, imageAttachments?: CoworkImageAttachment[]) => boolean | void | Promise<boolean | void>;
  onStop?: () => void;
  isStreaming?: boolean;
  placeholder?: string;
  disabled?: boolean;
  size?: 'normal' | 'large';
  workingDirectory?: string;
  onWorkingDirectoryChange?: (dir: string) => void;
  showFolderSelector?: boolean;
  showModelSelector?: boolean;
  onManageSkills?: () => void;
  sessionId?: string;
  /** When true, hides attachment/skill buttons but keeps the input box visible (disabled) */
  remoteManaged?: boolean;
}

const CoworkPromptInputInner = React.forwardRef<CoworkPromptInputRef, CoworkPromptInputProps>(
  (props, ref) => {
    const {
      onSubmit,
      onStop,
      isStreaming = false,
      placeholder = 'Enter your task...',
      disabled = false,
      size = 'normal',
      workingDirectory = '',
      onWorkingDirectoryChange,
      showFolderSelector = false,
      showModelSelector = false,
      onManageSkills,
      sessionId,
      remoteManaged = false,
    } = props;
    const dispatch = useDispatch();
    const controller = usePromptInputController();

    const draftKey = sessionId || '__home__';
    const draftPrompt = useSelector((state: RootState) => selectDraftPrompts(state)[draftKey] || '');

    const attachments = (useSelector((state: RootState) => state.cowork.draftAttachments[draftKey]) || EMPTY_ATTACHMENTS) as CoworkAttachment[];
    const currentAgentId = useSelector((state: RootState) => state.agent.currentAgentId);
    const agents = useSelector((state: RootState) => state.agent.agents);
    const coworkAgentEngine = useSelector((state: RootState) => state.cowork.config.agentEngine);
    const availableModels = useSelector((state: RootState) => state.model.availableModels);
    const currentSession = useSelector((state: RootState) => state.cowork.currentSession);
    const [value, setValue] = useState(draftPrompt);

    // Keep a stable ref to the controller to avoid [controller] dep in the sync effect.
    // Without this, every controller reference change triggers a re-render cascade
    // which can cause OOM when switching to sessions with large message histories.
    const controllerRef = useRef(controller);
    controllerRef.current = controller;

    // Sync local value to PromptInputTextarea's controller on all changes
    // (clear on submit, external setValue, session switch, etc.)
    useEffect(() => {
      const ctrl = controllerRef.current;
      if (ctrl.textInput.value !== value) {
        ctrl.textInput.setInput(value);
      }
    }, [value]);

    const [showFolderRequiredWarning, setShowFolderRequiredWarning] = useState(false);
    const [isDraggingFiles, setIsDraggingFiles] = useState(false);
    const [isAddingFile, setIsAddingFile] = useState(false);
    const [imageVisionHint, setImageVisionHint] = useState(false);
    const [isPatchingModel, setIsPatchingModel] = useState(false);
    const [modelSelectorOpen, setModelSelectorOpen] = useState(false);

    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const dragDepthRef = useRef(0);
    const warningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const modelPatchRequestIdRef = useRef(0);

  // 暴露方法给父组件
  React.useImperativeHandle(ref, () => ({
    setValue: (newValue: string) => {
      setValue(newValue);
      // 触发自动调整高度
      requestAnimationFrame(() => {
        const textarea = textareaRef.current;
        if (textarea) {
          textarea.style.height = 'auto';
          textarea.style.height = `${Math.min(Math.max(textarea.scrollHeight, minHeight), maxHeight)}px`;
        }
      });
    },
    setImageAttachments: (images: CoworkImageAttachment[]) => {
      const newAttachments: CoworkAttachment[] = images.map((img, idx) => ({
        path: `inline:${img.name}:reedit-${Date.now()}-${idx}`,
        name: img.name,
        isImage: true,
        dataUrl: `data:${img.mimeType};base64,${img.base64Data}`,
      }));
      dispatch(setDraftAttachments({ draftKey, attachments: newAttachments }));
    },
    focus: () => {
      textareaRef.current?.focus();
    },
  }));

  const activeSkillIds = useSelector((state: RootState) => state.skill.activeSkillIds);
  const skills = useSelector((state: RootState) => state.skill.skills);
  const currentAgent = agents.find((agent) => agent.id === currentAgentId);
  const currentAgentSelectedModel = useAgentSelectedModel(currentAgentId, currentAgent?.model ?? '');
  const {
    isPersistingAgentModel,
    persistAgentModelSelection,
  } = usePersistAgentModelSelection({
    agentId: currentAgentId,
    syncDefaultModel: currentAgentId === 'main' || currentAgent?.isDefault === true,
  });

  const {
    selectedModel: agentSelectedModel,
    hasInvalidExplicitModel: agentModelIsInvalid,
    hasUnavailableLlamaCppModel,
  } = resolveAgentModelSelection({
    sessionModel: currentSession && currentSession.id === sessionId ? currentSession.modelOverride : '',
    agentModel: currentAgent?.model ?? '',
    availableModels,
    fallbackModel: currentAgentSelectedModel,
    engine: coworkAgentEngine,
  });

  const handleModelSelect = useCallback(async (nextModel: Model) => {
    if (isPatchingModel || isPersistingAgentModel) return;
    const modelRef = toOpenClawModelRef(nextModel);
    if (sessionId) {
      const reqId = modelPatchRequestIdRef.current + 1;
      modelPatchRequestIdRef.current = reqId;
      const prev = currentSession?.id === sessionId ? currentSession.modelOverride : '';
      setIsPatchingModel(true);
      dispatch(updateCurrentSessionModelOverride({ sessionId, modelOverride: modelRef }));
      try {
        const ok = await coworkService.patchSession(sessionId, { model: modelRef });
        if (reqId !== modelPatchRequestIdRef.current) return;
        if (!ok) {
          dispatch(updateCurrentSessionModelOverride({ sessionId, modelOverride: prev }));
          window.dispatchEvent(new CustomEvent('app:showToast', { detail: i18nService.t('coworkModelSwitchFailed') }));
        } else if (currentAgent && agentModelIsInvalid) {
          void agentService.updateAgent(currentAgent.id, { model: modelRef });
        }
      } catch {
        if (reqId === modelPatchRequestIdRef.current)
          dispatch(updateCurrentSessionModelOverride({ sessionId, modelOverride: prev }));
      } finally {
        if (reqId === modelPatchRequestIdRef.current) setIsPatchingModel(false);
      }
      return;
    }
    await persistAgentModelSelection(nextModel);
  }, [isPatchingModel, isPersistingAgentModel, sessionId, currentSession, dispatch, currentAgent, agentModelIsInvalid, persistAgentModelSelection]);

  const isLarge = size === 'large';
  const minHeight = isLarge ? 60 : 24;
  const maxHeight = isLarge ? 200 : 200;

  const effectiveSelectedModel = resolveEffectiveModel({
    sessionId,
    agentSelectedModel,
    globalSelectedModel: currentAgentSelectedModel,
  });
  const modelSupportsImage = !!effectiveSelectedModel?.supportsImage;

  // Load skills on mount
  useEffect(() => {
    const loadSkills = async () => {
      const loadedSkills = await skillService.loadSkills();
      const workMode = configService.getConfig().workMode ?? 'work';
      dispatch(setSkills(
        workMode === 'chat'
          ? loadedSkills.filter(s => CHAT_SKILL_IDS.has(s.id))
          : loadedSkills
      ));
    };
    loadSkills();
  }, [dispatch]);

  useEffect(() => {
    const unsubscribe = skillService.onSkillsChanged(async () => {
      const loadedSkills = await skillService.loadSkills();
      const workMode = configService.getConfig().workMode ?? 'work';
      dispatch(setSkills(
        workMode === 'chat'
          ? loadedSkills.filter(s => CHAT_SKILL_IDS.has(s.id))
          : loadedSkills
      ));
    });
    return () => {
      unsubscribe();
    };
  }, [dispatch]);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(Math.max(textarea.scrollHeight, minHeight), maxHeight)}px`;
    }
  }, [value, minHeight, maxHeight]);

  useEffect(() => {
    const handleFocusInput = (event: Event) => {
      const detail = (event as CustomEvent<{ clear?: boolean; text?: string }>).detail;
      const shouldClear = detail?.clear ?? true;
      if (detail?.text !== undefined) {
        setValue(detail.text);
        dispatch(clearDraftAttachments(draftKey));
        setImageVisionHint(false);
      } else if (shouldClear) {
        setValue('');
        dispatch(clearDraftAttachments(draftKey));
        setImageVisionHint(false);
      }
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
      });
    };
    window.addEventListener('cowork:focus-input', handleFocusInput);
    return () => {
      window.removeEventListener('cowork:focus-input', handleFocusInput);
      if (warningTimerRef.current) clearTimeout(warningTimerRef.current);
    };
  }, [dispatch, draftKey]);

  useEffect(() => {
    if (workingDirectory?.trim()) {
      setShowFolderRequiredWarning(false);
    }
  }, [workingDirectory]);

  useEffect(() => {
    modelPatchRequestIdRef.current += 1;
    setIsPatchingModel(false);
  }, [sessionId]);

  // Sync value from draft when sessionId changes
  useEffect(() => {
    setValue(draftPrompt);
    // Re-derive imageVisionHint from the new session's draft attachments
    const hasImageWithoutVision = !modelSupportsImage && attachments.some(a => a.isImage || isImagePath(a.path));
    setImageVisionHint(hasImageWithoutVision);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]); // intentionally omit other deps to only trigger on session switch

  useEffect(() => {
    if (value !== draftPrompt) {
      const timer = setTimeout(() => {
        dispatch(setDraftPrompt({ sessionId: draftKey, draft: value }));
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [value, draftPrompt, dispatch, draftKey]);

  const handleSubmit = useCallback(async () => {
    if (showFolderSelector && !workingDirectory?.trim()) {
      setShowFolderRequiredWarning(true);
      if (warningTimerRef.current) clearTimeout(warningTimerRef.current);
      warningTimerRef.current = setTimeout(() => {
        setShowFolderRequiredWarning(false);
        warningTimerRef.current = null;
      }, 3000);
      return;
    }

    const trimmedValue = value.trim();
    if ((!trimmedValue && attachments.length === 0) || isStreaming || disabled || isPatchingModel) return;
    if (hasUnavailableLlamaCppModel) {
      window.dispatchEvent(new CustomEvent('app:showToast', {
        detail: i18nService.t('agentLlamaCppModelNotRunningBlocked'),
      }));
      return;
    }
    setShowFolderRequiredWarning(false);

    // Get active skills prompts and combine them
    const activeSkills = activeSkillIds
      .map(id => skills.find(s => s.id === id))
      .filter((s): s is Skill => s !== undefined);
    const skillPrompt = activeSkills.length > 0
      ? activeSkills.map(buildInlinedSkillPrompt).join('\n\n')
      : undefined;

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
    for (const attachment of attachments) {
      if (attachment.isImage && attachment.dataUrl) {
        const extracted = extractBase64FromDataUrl(attachment.dataUrl);
        if (extracted) {
          imageAtts.push({
            name: attachment.name,
            mimeType: extracted.mimeType,
            base64Data: extracted.base64Data,
          });
        } else {
          console.warn('[CoworkPromptInput] handleSubmit: extractBase64FromDataUrl returned null', {
            name: attachment.name,
            dataUrlPrefix: attachment.dataUrl.slice(0, 60),
          });
        }
      } else if (attachment.isImage) {
        console.warn('[CoworkPromptInput] handleSubmit: image attachment missing dataUrl', {
          path: attachment.path,
          name: attachment.name,
          isImage: attachment.isImage,
          hasDataUrl: !!attachment.dataUrl,
        });
      }
    }

    // Build prompt with ALL attachments that have real file paths (both regular files and images).
    // Image attachments also need their file paths in the prompt so the model knows
    // where the original files are located (e.g., for skills like seedream that need --image <path>).
    // Note: inline/clipboard images have pseudo-paths starting with 'inline:' and are excluded.
    // Note: image attachments that already carry base64 data are excluded — their content
    // is delivered via the attachments parameter of chat.send. Including the file path
    // would trigger OpenClaw's Native-image detection, which rejects paths outside allowed
    // directories and can drop the base64 image during sanitization (macOS-only bug).
    const attachmentLines = attachments
      .filter((a) => !a.path.startsWith('inline:') && !(a.isImage && a.dataUrl))
      .map((attachment) => `${i18nService.t('inputFileLabel')}: ${attachment.path}`)
      .join('\n');
    const finalPrompt = trimmedValue
      ? (attachmentLines ? `${trimmedValue}\n\n${attachmentLines}` : trimmedValue)
      : attachmentLines;

    if (imageAtts.length > 0) {
      console.log('[CoworkPromptInput] handleSubmit: passing imageAtts to onSubmit', {
        count: imageAtts.length,
        names: imageAtts.map(a => a.name),
        base64Lengths: imageAtts.map(a => a.base64Data.length),
      });
    } else if (attachments.some(a => a.isImage || isImagePath(a.path))) {
      console.warn('[CoworkPromptInput] handleSubmit: has image-like attachments but imageAtts is EMPTY — images will NOT be sent as base64', {
        imageAttachments: attachments.filter(a => a.isImage || isImagePath(a.path)).map(a => ({
          path: a.path,
          isImage: a.isImage,
          hasDataUrl: !!a.dataUrl,
        })),
      });
    }
    const result = await onSubmit(finalPrompt, skillPrompt, imageAtts.length > 0 ? imageAtts : undefined);
    if (result === false) return;
    setValue('');
    dispatch(setDraftPrompt({ sessionId: draftKey, draft: '' }));
    dispatch(clearDraftAttachments(draftKey));
    setImageVisionHint(false);
  }, [value, isStreaming, disabled, isPatchingModel, hasUnavailableLlamaCppModel, onSubmit, activeSkillIds, skills, attachments, showFolderSelector, workingDirectory, dispatch, draftKey, effectiveSelectedModel?.id, modelSupportsImage]);

  const handleSelectSkill = useCallback((skill: Skill) => {
    dispatch(toggleActiveSkill(skill.id));
  }, [dispatch]);

  const handleManageSkills = useCallback(() => {
    if (onManageSkills) {
      onManageSkills();
    }
  }, [onManageSkills]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const isComposing = event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229;
    if (event.key !== 'Enter' || isComposing) return;

    // Use synced state (kept up-to-date via config-updated event) so that
    // changes made in the Settings panel are reflected immediately without
    // requiring a configService read at event time.
    const sendKey = currentSendShortcut;

    let isSendCombo = false;
    switch (sendKey) {
      case 'Enter':
        isSendCombo = !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey;
        break;
      case 'Shift+Enter':
        isSendCombo = event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey;
        break;
      case 'Ctrl+Enter':
        isSendCombo = isMacPlatform
          ? event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
          : event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey;
        break;
      case 'Alt+Enter':
        isSendCombo = event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
        break;
      default:
        // Unknown config value — fall back to bare Enter so the user can always send
        isSendCombo = !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey;
        break;
    }

    if (isSendCombo && !isStreaming && !disabled && !isPatchingModel) {
      event.preventDefault();
      handleSubmit();
    } else {
      // Any non-send Enter combo inserts a newline.
      // Shift+Enter inserts newline natively; for other combos use execCommand.
      if (!event.shiftKey) {
        event.preventDefault();
        document.execCommand('insertText', false, '\n');
      }
    }
  };

  const truncatePath = (path: string, maxLength = 30): string => {
    if (!path) return i18nService.t('noFolderSelected');
    return getCompactFolderName(path, maxLength) || i18nService.t('noFolderSelected');
  };

  const handleFolderSelect = (path: string) => {
    if (onWorkingDirectoryChange) {
      onWorkingDirectoryChange(path);
    }
  };

  const addAttachment = useCallback((filePath: string, imageInfo?: { isImage: boolean; dataUrl?: string }) => {
    if (!filePath) return;
    dispatch(addDraftAttachment({
      draftKey,
      attachment: {
        path: filePath,
        name: getFileNameFromPath(filePath),
        isImage: imageInfo?.isImage,
        dataUrl: imageInfo?.dataUrl,
      },
    }));
  }, [dispatch, draftKey]);

  const addImageAttachmentFromDataUrl = useCallback((name: string, dataUrl: string) => {
    // Use the dataUrl as the unique key (no file path for inline images)
    const pseudoPath = `inline:${name}:${Date.now()}`;
    dispatch(addDraftAttachment({
      draftKey,
      attachment: {
        path: pseudoPath,
        name,
        isImage: true,
        dataUrl,
      },
    }));
  }, [dispatch, draftKey]);

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

  const saveInlineFile = useCallback(async (file: File): Promise<string | null> => {
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
  }, [fileToBase64, workingDirectory]);

  const handleIncomingFiles = useCallback(async (fileList: FileList | File[]) => {
    if (disabled || isStreaming) return;
    const files = Array.from(fileList ?? []);
    if (files.length === 0) return;

    let hasImageWithoutVision = false;
    for (const file of files) {
      const nativePath = getNativeFilePath(file);

      // Check if this is an image file and model supports images
      const fileIsImage = nativePath
        ? isImagePath(nativePath)
        : isImageMimeType(file.type);

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
          // For images on vision-capable models, read as data URL
          if (nativePath) {
            try {
              const result = await window.electron.dialog.readFileAsDataUrl(nativePath);
              if (result.success && result.dataUrl) {
                console.log('[CoworkPromptInput] handleIncomingFiles: native image read OK', { nativePath, dataUrlLength: result.dataUrl.length });
                addAttachment(nativePath, { isImage: true, dataUrl: result.dataUrl });
                continue;
              }
              console.warn('[CoworkPromptInput] handleIncomingFiles: readFileAsDataUrl returned falsy', { nativePath, success: result.success });
            } catch (error) {
              console.error('Failed to read image as data URL:', error);
            }
            // Fallback: add as regular file attachment
            console.warn('[CoworkPromptInput] handleIncomingFiles: native image fallback to path-only (no dataUrl)', { nativePath });
            addAttachment(nativePath);
          } else {
            // No native path (clipboard/drag from browser):
            // 1. Read as dataUrl for preview + base64 vision
            // 2. Save to disk so the agent can access the file in later turns
            let dataUrl: string | null = null;
            try {
              dataUrl = await fileToDataUrl(file);
              console.log('[CoworkPromptInput] handleIncomingFiles: clipboard fileToDataUrl OK', { dataUrlLength: dataUrl?.length ?? 0 });
            } catch (error) {
              console.error('[CoworkPromptInput] handleIncomingFiles: clipboard fileToDataUrl FAILED:', error);
            }

            const stagedPath = await saveInlineFile(file);
            console.log('[CoworkPromptInput] handleIncomingFiles: clipboard saveInlineFile result', { stagedPath, hasDataUrl: !!dataUrl });

            if (stagedPath) {
              addAttachment(stagedPath, {
                isImage: true,
                dataUrl: dataUrl ?? undefined,
              });
            } else if (dataUrl) {
              console.warn('Clipboard image saved only in memory (disk save failed)');
              addImageAttachmentFromDataUrl(file.name, dataUrl);
            } else {
              console.error('Failed to process clipboard image: both dataUrl and disk save failed');
            }
          }
          continue;
        }
        // Model doesn't support image input — add as file path and show hint
        console.warn('[CoworkPromptInput] handleIncomingFiles: image skipped vision path because modelSupportsImage=false', {
          fileName: file.name,
          effectiveModelId: effectiveSelectedModel?.id ?? null,
          effectiveModelSupportsImage: effectiveSelectedModel?.supportsImage ?? null,
        });
        hasImageWithoutVision = true;
      }

      // Non-image file or model doesn't support images: use original flow
      if (nativePath) {
        addAttachment(nativePath);
        continue;
      }

      const stagedPath = await saveInlineFile(file);
      if (stagedPath) {
        addAttachment(stagedPath);
      }
    }
    if (hasImageWithoutVision) {
      setImageVisionHint(true);
    }
  }, [addAttachment, addImageAttachmentFromDataUrl, disabled, effectiveSelectedModel, fileToDataUrl, getNativeFilePath, isStreaming, modelSupportsImage, saveInlineFile]);

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
          if (modelSupportsImage) {
            try {
              const readResult = await window.electron.dialog.readFileAsDataUrl(filePath);
              if (readResult.success && readResult.dataUrl) {
                console.log('[CoworkPromptInput] handleAddFile: image read OK', { filePath, dataUrlLength: readResult.dataUrl.length });
                addAttachment(filePath, { isImage: true, dataUrl: readResult.dataUrl });
                continue;
              }
              console.warn('[CoworkPromptInput] handleAddFile: readFileAsDataUrl returned falsy', { filePath });
            } catch (error) {
              console.error('Failed to read image as data URL:', error);
            }
          } else {
            console.warn('[CoworkPromptInput] handleAddFile: image skipped vision path because modelSupportsImage=false', {
              filePath,
              effectiveModelId: effectiveSelectedModel?.id ?? null,
            });
            hasImageWithoutVision = true;
          }
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
  }, [addAttachment, effectiveSelectedModel, isAddingFile, disabled, isStreaming, modelSupportsImage]);

  const handleRemoveAttachment = useCallback((path: string) => {
    dispatch(setDraftAttachments({
      draftKey,
      attachments: attachments.filter((attachment) => attachment.path !== path),
    }));
  }, [attachments, dispatch, draftKey]);

  const hasFileTransfer = (dataTransfer: DataTransfer | null): boolean => {
    if (!dataTransfer) return false;
    if (dataTransfer.files.length > 0) return true;
    return Array.from(dataTransfer.types).includes('Files');
  };

  const handleDragEnter = (event: React.DragEvent<HTMLElement>) => {
    if (!hasFileTransfer(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current += 1;
    if (!disabled && !isStreaming) {
      setIsDraggingFiles(true);
    }
  };

  const handleDragOver = (event: React.DragEvent<HTMLElement>) => {
    if (!hasFileTransfer(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = disabled || isStreaming ? 'none' : 'copy';
  };

  const handleDragLeave = (event: React.DragEvent<HTMLElement>) => {
    if (!hasFileTransfer(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setIsDraggingFiles(false);
    }
  };

  const handleDrop = (event: React.DragEvent<HTMLElement>) => {
    if (!hasFileTransfer(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = 0;
    setIsDraggingFiles(false);
    if (disabled || isStreaming) return;
    void handleIncomingFiles(event.dataTransfer.files);
  };

  const handlePaste = useCallback((event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (disabled || isStreaming) return;
    const files = Array.from(event.clipboardData?.files ?? []);
    if (files.length === 0) return;
    event.preventDefault();
    void handleIncomingFiles(files);
  }, [disabled, handleIncomingFiles, isStreaming]);

  const [currentSendShortcut, setCurrentSendShortcut] = useState(
    () => configService.getConfig().shortcuts?.sendMessage ?? 'Enter'
  );

  // Sync when config is updated elsewhere (e.g. Settings panel)
  useEffect(() => {
    const syncFromConfig = () => {
      const latest = configService.getConfig().shortcuts?.sendMessage ?? 'Enter';
      setCurrentSendShortcut(latest);
    };
    window.addEventListener('config-updated', syncFromConfig);
    return () => window.removeEventListener('config-updated', syncFromConfig);
  }, []);
  return (
    <div className="relative">
      {attachments.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2 max-h-[136px] overflow-y-auto">
          {attachments.map((attachment) => (
            <AttachmentCard
              key={attachment.path}
              attachment={attachment}
              onRemove={handleRemoveAttachment}
            />
          ))}
        </div>
      )}
      {imageVisionHint && (
        <div className="mb-2 flex items-start gap-1.5 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 px-2.5 py-1.5 text-xs text-amber-700 dark:text-amber-400">
          <TriangleAlert className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
          <span>
            {i18nService.t('imageVisionHint')}
          </span>
          <Button variant="ghost" size="icon-xs" className="ml-auto flex-shrink-0" onClick={() => setImageVisionHint(false)}>
            <X className="h-3 w-3" />
          </Button>
        </div>
      )}
      <PromptInput
        multiple
        className={cn(
          'shadow-elevated rounded-2xl transition-shadow focus-within:shadow-[0_4px_16px_rgba(59,130,246,0.25)] [&_[data-slot=input-group]]:rounded-2xl [&_[data-slot=input-group]]:has-[:focus-visible]:border-input [&_[data-slot=input-group]]:has-[:focus-visible]:ring-0',
          isDraggingFiles && 'ring-2 ring-primary'
        )}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onSubmit={handleSubmit}
      >
        {isDraggingFiles && (
          <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-[inherit] bg-primary/10 text-xs font-medium text-primary">
            {i18nService.t('coworkDropFileHint')}
          </div>
        )}
        <PromptInputBody>
          <PromptInputTextarea
            ref={textareaRef}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onChange={(e) => setValue(e.currentTarget.value)}
            placeholder={placeholder}
            disabled={disabled}
          />
        </PromptInputBody>
          <PromptInputFooter>
            <PromptInputTools>
              {showModelSelector && (
                <Popover open={modelSelectorOpen} onOpenChange={setModelSelectorOpen}>
                  <PopoverTrigger>
                    <span className="inline-flex items-center gap-1.5 text-xs rounded-md border border-input px-2 py-1 hover:bg-black/[0.03] dark:hover:bg-white/[0.04] max-w-[200px] [&_span]:flex-none cursor-pointer">
                      {agentSelectedModel ? (
                        <>
                          <ModelSelectorLogo provider={effectiveSelectedModel?.providerKey || effectiveSelectedModel?.provider || 'openai'} />
                          <ModelSelectorName>{agentSelectedModel.name}</ModelSelectorName>
                        </>
                      ) : (
                        <span className="text-muted-foreground">{i18nService.t('selectModel')}</span>
                      )}
                    </span>
                  </PopoverTrigger>
                  <PopoverContent
                    className="w-72 p-0 bg-background border ring-0 rounded-md"
                    side="top"
                    align="start"
                    sideOffset={4}
                  >
                    <Command className="bg-background [&_[data-slot=input-group]]:bg-transparent">
                      <CommandInput placeholder={i18nService.t('searchModels')} />
                      <CommandList>
                        <CommandGroup heading={i18nService.t('serverModels')}>
                          {availableModels.filter(m => m.isServerModel).map(m => (
                            <CommandItem
                              key={m.id}
                              value={m.name}
                              onSelect={() => {
                                handleModelSelect(m);
                                setModelSelectorOpen(false);
                              }}
                            >
                              <ModelSelectorLogo provider={m.providerKey || m.provider || 'openai'} />
                              <ModelSelectorName>{m.name}</ModelSelectorName>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              )}
              {showFolderSelector && (
                <>
                  <FolderSelectorPopover onSelectFolder={handleFolderSelect} side="top" align="start">
                    <PromptInputButton
                      className={`gap-1.5 hover:bg-black/[0.03] dark:hover:bg-white/[0.04] ${showFolderRequiredWarning ? 'ring-1 ring-warning text-warning animate-shake' : ''}`}
                    >
                      <Folder className="h-4 w-4 flex-shrink-0" />
                      <span className="max-w-[150px] truncate text-xs">
                        {truncatePath(workingDirectory)}
                      </span>
                      {workingDirectory && (
                        <span
                          role="button"
                          tabIndex={-1}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleFolderSelect('');
                          }}
                          className="flex-shrink-0 ml-0.5 p-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
                        >
                          <X className="h-3 w-3" />
                        </span>
                      )}
                    </PromptInputButton>
                  </FolderSelectorPopover>
                  {showFolderRequiredWarning && (
                    <div className="absolute left-0 top-full mt-1 px-2 py-1 rounded-md bg-surface-raised text-warning text-xs whitespace-nowrap animate-fade-in-up shadow-subtle z-10">
                      {i18nService.t('coworkSelectFolderFirst')}
                    </div>
                  )}
                </>
              )}
              {!remoteManaged && (
                <PromptInputButton onClick={handleAddFile} disabled={disabled || isStreaming || isAddingFile} className="hover:bg-black/[0.03] dark:hover:bg-white/[0.04]">
                  <Paperclip className="h-4 w-4" />
                </PromptInputButton>
              )}
              {!remoteManaged && (
                <>
                  <SkillsButton
                    onSelectSkill={handleSelectSkill}
                    onManageSkills={handleManageSkills}
                  />
                  <ActiveSkillBadge />
                </>
              )}
            </PromptInputTools>
            <PromptInputSubmit
              status={isStreaming ? 'streaming' : 'ready'}
              onStop={isStreaming ? onStop : undefined}
            />
          </PromptInputFooter>
        </PromptInput>
    </div>
  );
  }
);

CoworkPromptInputInner.displayName = 'CoworkPromptInputInner';

const CoworkPromptInput = React.forwardRef<CoworkPromptInputRef, CoworkPromptInputProps>(
  (props, ref) => (
    <PromptInputProvider>
      <CoworkPromptInputInner {...props} ref={ref} />
    </PromptInputProvider>
  )
);

CoworkPromptInput.displayName = 'CoworkPromptInput';

export default CoworkPromptInput;
