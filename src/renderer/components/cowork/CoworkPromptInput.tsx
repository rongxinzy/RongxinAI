import {
  PromptInput,
  PromptInputBody,
  PromptInputButton,
  PromptInputFooter,
  PromptInputHeader,
  PromptInputProvider,
  PromptInputSubmit,
  PromptInputTools,
  usePromptInputController,
} from '@shared/components/ai-elements/prompt-input';
import { Button } from '@shared/components/ui/button';
import { cn } from '@shared/lib/utils';
import { ChevronDown, Folder, Target, TriangleAlert, X } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import { CoworkSessionExpertSource } from '../../../shared/cowork/sessionExperts';
import { CoworkPermissionMode, CoworkSessionMode } from '../../../shared/cowork/constants';
import {
  ProductionLoopMode,
  type ProductionLoopMode as ProductionLoopModeValue,
} from '../../../shared/productionLoop';
import { agentService } from '../../services/agent';
import { configService } from '../../services/config';
import { coworkService } from '../../services/cowork';
import { i18nService } from '../../services/i18n';
import { skillService } from '../../services/skill';
import { RootState } from '../../store';
import { selectDraftPrompts } from '../../store/selectors/coworkSelectors';
import { selectWorkMode } from '../../store/selectors/workModeSelectors';
import {
  addDraftAttachment,
  clearDraftAttachments,
  type DraftAttachment,
  setDraftAttachments,
  setDraftPrompt,
  updateCurrentSessionModelOverride,
} from '../../store/slices/coworkSlice';
import { clearSelection } from '../../store/slices/quickActionSlice';
import {
  type Model,
  setDefaultSelectedModel,
  setSelectedModel,
} from '../../store/slices/modelSlice';
import { clearActiveSkills, setSkills } from '../../store/slices/skillSlice';
import { WorkMode } from '../../store/workMode/constants';
import { CoworkFileAttachment, CoworkImageAttachment } from '../../types/cowork';
import { Skill } from '../../types/skill';
import { toAgentModelRef } from '../../utils/agentModelRef';
import ActiveMcpBadge from '../mcp/ActiveMcpBadge';
import {
  resolveAgentModelSelection,
  resolveEffectiveModel,
  useAgentSelectedModel,
} from './agentModelSelection';
import ActiveExpertBadge from './ActiveExpertBadge';
import { CoworkInlineAttachments } from './CoworkInlineAttachments';
import { ContextUsageIndicator } from './ContextUsageIndicator';
import { SessionStatsLine } from './SessionStatsLine';
import { CoworkModelPicker } from './CoworkModelPicker';
import FolderSelectorPopover from './FolderSelectorPopover';
import InlineSkillPromptEditor from './InlineSkillPromptEditor';
import { LocalThinkingToggle } from './LocalThinkingToggle';
import PermissionModeMenu from './PermissionModeMenu';
import PromptPlusMenu from './PromptPlusMenu';
import { ResumeTaskContextBadge } from './ResumeTaskContextBadge';
import { usePersistAgentModelSelection } from './usePersistAgentModelSelection';

// CoworkAttachment is aliased from the Redux-persisted DraftAttachment type
// so that attachment state survives view switches (cowork ↔ skills, etc.)
type CoworkAttachment = DraftAttachment;

const GoalModeChip: React.FC<{ onRemove: () => void; compact?: boolean }> = ({
  onRemove,
  compact = false,
}) => (
  <span
    className={cn(
      'inline-flex h-6 items-center gap-1.5 rounded-full px-1.5 text-xs font-medium text-(--zy-skill-blue-foreground) transition-colors hover:bg-(--zy-skill-blue-background)',
      compact && 'px-1',
    )}
    title={i18nService.t('goalMode')}
  >
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      onClick={onRemove}
      aria-label={i18nService.t('clearGoalMode')}
      title={i18nService.t('clearGoalMode')}
      className="group/goal relative ml-0.5 size-4 rounded-full p-0 hover:bg-transparent"
    >
      <Target className="size-3.5 transition-opacity group-hover/goal:opacity-0" />
      <X className="absolute size-3.5 opacity-0 transition-opacity group-hover/goal:opacity-100" />
    </Button>
    {!compact && <span className="max-w-24 truncate">{i18nService.t('goalMode')}</span>}
  </span>
);

// Stable empty array reference to avoid unnecessary re-renders from useSelector
// returning a new [] on every call (when draftAttachments[draftKey] is undefined).
const EMPTY_ATTACHMENTS: DraftAttachment[] = [];
const IMAGE_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.bmp',
  '.svg',
  '.tiff',
  '.tif',
  '.ico',
  '.avif',
]);

const isImagePath = (filePath: string): boolean => {
  const dotIndex = filePath.lastIndexOf('.');
  if (dotIndex === -1) return false;
  const ext = filePath.slice(dotIndex).toLowerCase();
  return IMAGE_EXTENSIONS.has(ext);
};
const isImageMimeType = (mimeType: string): boolean => {
  return mimeType.startsWith('image/');
};
const extractBase64FromDataUrl = (
  dataUrl: string,
): { mimeType: string; base64Data: string } | null => {
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
// Only collapse secondary controls when the chat column is genuinely narrow.
// A split pane around 700px still has room for the full permission/model row.
const COMPACT_TOOLBAR_MAX_WIDTH = 480;
const TIGHT_TOOLBAR_MAX_WIDTH = 760;

export interface CoworkPromptInputRef {
  /** 设置输入框值 */
  setValue: (value: string) => void;
  /** 设置图片附件（用于重新编辑消息时还原图片） */
  setImageAttachments: (images: CoworkImageAttachment[]) => void;
  /** 聚焦输入框 */
  focus: () => void;
}

interface CoworkPromptInputProps {
  onSubmit: (
    prompt: string,
    skillPrompt?: string,
    imageAttachments?: CoworkImageAttachment[],
    fileAttachments?: CoworkFileAttachment[],
    expertIds?: string[],
    goalMode?: boolean,
    productionLoopMode?: ProductionLoopModeValue,
  ) => boolean | void | Promise<boolean | void>;
  onStop?: () => void;
  isStreaming?: boolean;
  placeholder?: string;
  disabled?: boolean;
  /** Keeps text editing available while session-bound actions wait for the target session. */
  sessionContextPending?: boolean;
  size?: 'normal' | 'large';
  workingDirectory?: string;
  workingDirectoryName?: string;
  onWorkingDirectoryChange?: (dir: string) => void;
  onUseNoFolder?: (dir: string) => void | Promise<void>;
  showFolderSelector?: boolean;
  showNoFolderAction?: boolean;
  showModelSelector?: boolean;
  onManageSkills?: () => void;
  onManageConnectors?: () => void;
  /** Work mode: show the 请求权限/全部允许 selector in the toolbar */
  showPermissionModeSelector?: boolean;
  permissionMode?: CoworkPermissionMode;
  onPermissionModeChange?: (mode: CoworkPermissionMode) => void;
  sessionId?: string;
  /** When true, hides attachment/skill buttons but keeps the input box visible (disabled) */
  remoteManaged?: boolean;
  showLocalThinkingToggle?: boolean;
  localThinkingEnabled?: boolean;
  onLocalThinkingEnabledChange?: (enabled: boolean | undefined) => void;
  isDirectChat?: boolean;
  topAccessory?: React.ReactNode;
  resumeTaskActive?: boolean;
  onCancelTaskResume?: () => void;
}

const CoworkPromptInputInner = React.forwardRef<CoworkPromptInputRef, CoworkPromptInputProps>(
  (props, ref) => {
    const {
      onSubmit,
      onStop,
      isStreaming = false,
      placeholder = 'Enter your task...',
      disabled = false,
      sessionContextPending = false,
      size = 'normal',
      workingDirectory = '',
      workingDirectoryName,
      onWorkingDirectoryChange,
      onUseNoFolder,
      showFolderSelector = false,
      showNoFolderAction = true,
      showModelSelector = false,
      onManageSkills,
      onManageConnectors,
      showPermissionModeSelector = false,
      permissionMode,
      onPermissionModeChange,
      sessionId,
      remoteManaged = false,
      showLocalThinkingToggle = false,
      localThinkingEnabled,
      onLocalThinkingEnabledChange,
      isDirectChat = false,
      topAccessory,
      resumeTaskActive = false,
      onCancelTaskResume,
    } = props;
    const dispatch = useDispatch();
    const controller = usePromptInputController();

    const draftKey = sessionId || '__home__';
    const draftPrompt = useSelector(
      (state: RootState) => selectDraftPrompts(state)[draftKey] || '',
    );

    const attachments = (useSelector(
      (state: RootState) => state.cowork.draftAttachments[draftKey],
    ) || EMPTY_ATTACHMENTS) as CoworkAttachment[];
    const currentAgentId = useSelector((state: RootState) => state.agent.currentAgentId);
    const agents = useSelector((state: RootState) => state.agent.agents);
    const currentAgent = agents.find(agent => agent.id === currentAgentId);
    const availableModels = useSelector((state: RootState) => state.model.availableModels);
    const defaultSelectedModel = useSelector(
      (state: RootState) => state.model.defaultSelectedModel,
    );
    const currentSession = useSelector((state: RootState) => state.cowork.currentSession);
    const contextMessage = useMemo(
      () =>
        [...(currentSession?.messages ?? [])]
          .reverse()
          .find(message => message.metadata?.contextUsage),
      [currentSession?.messages],
    );
    const contextUsage = contextMessage?.metadata?.contextUsage;
    const workMode = useSelector(selectWorkMode);
    const canQueueWhileStreaming =
      workMode === WorkMode.Work &&
      !isDirectChat &&
      (currentSession?.mode ?? CoworkSessionMode.Work) === CoworkSessionMode.Work;
    const persistedExpertIds = useMemo(
      () => currentSession?.experts?.slice(0, 1).map(expert => expert.expertId) ?? [],
      [currentSession?.experts],
    );
    const [selectedExpertIds, setSelectedExpertIds] = useState<string[]>(() =>
      persistedExpertIds.length > 0
        ? persistedExpertIds
        : currentAgent?.source === CoworkSessionExpertSource.Package ||
            currentAgent?.source === CoworkSessionExpertSource.Member
          ? [currentAgent.id]
          : [],
    );
    const [value, setValue] = useState(draftPrompt);
    const [goalMode, setGoalMode] = useState(false);
    const [productionLoopMode, setProductionLoopMode] = useState<ProductionLoopModeValue>(
      ProductionLoopMode.Auto,
    );

    // Keep a stable ref to the controller to avoid [controller] dep in the sync effect.
    // Without this, every controller reference change triggers a re-render cascade
    // which can cause OOM when switching to sessions with large message histories.
    const controllerRef = useRef(controller);
    controllerRef.current = controller;

    // Sync local value to PromptInput's controller on all changes
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
    const [isCompactToolbar, setIsCompactToolbar] = useState(false);
    const [isTightToolbar, setIsTightToolbar] = useState(false);

    const textareaRef = useRef<HTMLDivElement>(null);
    const promptRootRef = useRef<HTMLDivElement>(null);
    const dragDepthRef = useRef(0);
    const warningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const modelPatchRequestIdRef = useRef(0);
    // 暴露方法给父组件
    React.useImperativeHandle(ref, () => ({
      setValue: (newValue: string) => {
        setValue(newValue);
        requestAnimationFrame(() => {
          textareaRef.current?.focus();
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
    const currentAgentSelectedModel = useAgentSelectedModel(
      currentAgentId,
      currentAgent?.model ?? '',
    );
    const { isPersistingAgentModel, persistAgentModelSelection } = usePersistAgentModelSelection({
      agentId: currentAgentId,
      syncDefaultModel: currentAgentId === 'main' || currentAgent?.isDefault === true,
    });

    const {
      selectedModel: agentSelectedModel,
      hasInvalidExplicitModel: agentModelIsInvalid,
      hasUnavailableLlamaCppModel,
    } = resolveAgentModelSelection({
      sessionModel:
        currentSession && currentSession.id === sessionId ? currentSession.modelOverride : '',
      agentModel: currentAgent?.model ?? '',
      availableModels,
      fallbackModel: currentAgentSelectedModel,
    });

    const handleModelSelect = useCallback(
      async (nextModel: Model) => {
        if (isPatchingModel || isPersistingAgentModel) return;
        if (isDirectChat) {
          dispatch(setDefaultSelectedModel(nextModel));
          return;
        }
        const modelRef = toAgentModelRef(nextModel);
        // Always update the agent-level model selection so that CoworkView's
        // currentAgentSelectedModel (used to build ChatChatTransport) reflects
        // the user's latest choice — even when switching model inside a session.
        dispatch(setSelectedModel({ agentId: currentAgentId, model: nextModel }));
        if (sessionId) {
          const reqId = modelPatchRequestIdRef.current + 1;
          modelPatchRequestIdRef.current = reqId;
          const prev = currentSession?.id === sessionId ? currentSession.modelOverride : '';
          setIsPatchingModel(true);
          dispatch(updateCurrentSessionModelOverride({ sessionId, modelOverride: modelRef }));
          try {
            const ok = await coworkService.updateSessionModel(sessionId, modelRef);
            if (reqId !== modelPatchRequestIdRef.current) return;
            if (!ok) {
              dispatch(updateCurrentSessionModelOverride({ sessionId, modelOverride: prev }));
              window.dispatchEvent(
                new CustomEvent('app:showToast', {
                  detail: i18nService.t('coworkModelSwitchFailed'),
                }),
              );
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
      },
      [
        isPatchingModel,
        isPersistingAgentModel,
        isDirectChat,
        sessionId,
        currentSession,
        currentAgentId,
        dispatch,
        currentAgent,
        agentModelIsInvalid,
        persistAgentModelSelection,
      ],
    );

    const agentEffectiveModel = resolveEffectiveModel({
      sessionId,
      agentSelectedModel,
      globalSelectedModel: currentAgentSelectedModel,
    });
    const effectiveSelectedModel = isDirectChat ? defaultSelectedModel : agentEffectiveModel;
    const modelSupportsImage = !!effectiveSelectedModel?.supportsImage;

    // Load skills on mount
    useEffect(() => {
      setSelectedExpertIds(
        persistedExpertIds.length > 0
          ? persistedExpertIds
          : currentAgent?.source === CoworkSessionExpertSource.Package ||
              currentAgent?.source === CoworkSessionExpertSource.Member
            ? [currentAgent.id]
            : [],
      );
    }, [
      currentSession?.id,
      currentAgentId,
      currentAgent?.id,
      currentAgent?.source,
      persistedExpertIds,
    ]);

    const syncSkills = useCallback(async () => {
      const loadedSkills = await skillService.loadSkills();
      // Chat and Work share the same local skill registry. Chat sessions with
      // selected skills are routed through the agent execution path, so local
      // skills must not be hidden behind a core-skill-only allowlist.
      dispatch(setSkills(loadedSkills));
    }, [dispatch]);

    useEffect(() => {
      void syncSkills();
    }, [syncSkills, workMode]);

    useEffect(() => {
      const unsubscribe = skillService.onSkillsChanged(() => {
        void syncSkills();
      });
      return () => {
        unsubscribe();
      };
    }, [syncSkills]);

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

    useEffect(() => {
      const element = promptRootRef.current;
      if (!element || typeof ResizeObserver === 'undefined') return;
      const updateCompactState = () => {
        const width = element.clientWidth;
        setIsCompactToolbar(width <= COMPACT_TOOLBAR_MAX_WIDTH);
        setIsTightToolbar(width <= TIGHT_TOOLBAR_MAX_WIDTH);
      };
      updateCompactState();
      const observer = new ResizeObserver(updateCompactState);
      observer.observe(element);
      return () => observer.disconnect();
    }, []);

    // Sync value from draft when sessionId changes
    useEffect(() => {
      setValue(draftPrompt);
      // Re-derive imageVisionHint from the new session's draft attachments
      const hasImageWithoutVision =
        !modelSupportsImage && attachments.some(a => a.isImage || isImagePath(a.path));
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
      if (
        (!trimmedValue && attachments.length === 0 && !resumeTaskActive) ||
        (isStreaming && !canQueueWhileStreaming) ||
        disabled ||
        sessionContextPending ||
        isPatchingModel
      )
        return;
      if (!isDirectChat && hasUnavailableLlamaCppModel) {
        window.dispatchEvent(
          new CustomEvent('app:showToast', {
            detail: i18nService.t('agentLlamaCppModelNotRunningBlocked'),
          }),
        );
        return;
      }
      setShowFolderRequiredWarning(false);

      // Get active skills prompts and combine them
      const activeSkills = activeSkillIds
        .map(id => skills.find(s => s.id === id))
        .filter((s): s is Skill => s !== undefined);
      const skillPrompt =
        activeSkills.length > 0
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
      const fileAtts: CoworkFileAttachment[] = [];
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
            console.warn(
              '[CoworkPromptInput] handleSubmit: extractBase64FromDataUrl returned null',
              {
                name: attachment.name,
                dataUrlPrefix: attachment.dataUrl.slice(0, 60),
              },
            );
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
        .filter(a => !a.path.startsWith('inline:') && !(a.isImage && a.dataUrl))
        .map(attachment => `${i18nService.t('inputFileLabel')}: ${attachment.path}`)
        .join('\n');
      const finalPrompt = trimmedValue
        ? attachmentLines
          ? `${attachmentLines}\n\n${trimmedValue}`
          : trimmedValue
        : attachmentLines;

      if (imageAtts.length > 0) {
        console.log('[CoworkPromptInput] handleSubmit: passing imageAtts to onSubmit', {
          count: imageAtts.length,
          names: imageAtts.map(a => a.name),
          base64Lengths: imageAtts.map(a => a.base64Data.length),
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
        skillPrompt,
        imageAtts.length > 0 ? imageAtts : undefined,
        fileAtts.length > 0 ? fileAtts : undefined,
        selectedExpertIds,
        goalMode,
        productionLoopMode,
      );
      if (result === false) {
        // Submission rejected — restore the prompt so the user can retry.
        setValue(finalPrompt);
      } else if (activeSkills.length > 0) {
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
      isDirectChat,
      hasUnavailableLlamaCppModel,
      onSubmit,
      activeSkillIds,
      skills,
      attachments,
      showFolderSelector,
      workingDirectory,
      dispatch,
      draftKey,
      effectiveSelectedModel?.id,
      modelSupportsImage,
      selectedExpertIds,
      goalMode,
      productionLoopMode,
      canQueueWhileStreaming,
      resumeTaskActive,
    ]);

    const handleManageSkills = useCallback(() => {
      if (onManageSkills) {
        onManageSkills();
      }
    }, [onManageSkills]);

    const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
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

      if (
        isSendCombo &&
        (!isStreaming || canQueueWhileStreaming) &&
        !disabled &&
        !isPatchingModel
      ) {
        event.preventDefault();
        handleSubmit();
      } else {
        // Keep newlines as text nodes. Letting contenteditable create block
        // elements makes the serialized prompt browser-dependent.
        event.preventDefault();
        document.execCommand('insertText', false, '\n');
      }
    };

    const handleFolderSelect = (path: string) => {
      if (onWorkingDirectoryChange) {
        onWorkingDirectoryChange(path);
      }
    };

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
              // For images on vision-capable models, read as data URL
              if (nativePath) {
                try {
                  const result = await window.electron.dialog.readFileAsDataUrl(nativePath);
                  if (result.success && result.dataUrl) {
                    console.log('[CoworkPromptInput] handleIncomingFiles: native image read OK', {
                      nativePath,
                      dataUrlLength: result.dataUrl.length,
                    });
                    addAttachment(nativePath, { isImage: true, dataUrl: result.dataUrl });
                    continue;
                  }
                  console.warn(
                    '[CoworkPromptInput] handleIncomingFiles: readFileAsDataUrl returned falsy',
                    { nativePath, success: result.success },
                  );
                } catch (error) {
                  console.error('Failed to read image as data URL:', error);
                }
                // Fallback: add as regular file attachment
                console.warn(
                  '[CoworkPromptInput] handleIncomingFiles: native image fallback to path-only (no dataUrl)',
                  { nativePath },
                );
                addAttachment(nativePath, { isImage: true });
              } else {
                // No native path (clipboard/drag from browser):
                // 1. Read as dataUrl for preview + base64 vision
                // 2. Save to disk so the agent can access the file in later turns
                let dataUrl: string | null = null;
                try {
                  dataUrl = await fileToDataUrl(file);
                  console.log(
                    '[CoworkPromptInput] handleIncomingFiles: clipboard fileToDataUrl OK',
                    { dataUrlLength: dataUrl?.length ?? 0 },
                  );
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
                  addAttachment(stagedPath, {
                    isImage: true,
                    dataUrl: dataUrl ?? undefined,
                  });
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
            if (modelSupportsImage) {
              try {
                const readResult = await window.electron.dialog.readFileAsDataUrl(filePath);
                if (readResult.success && readResult.dataUrl) {
                  console.log('[CoworkPromptInput] handleAddFile: image read OK', {
                    filePath,
                    dataUrlLength: readResult.dataUrl.length,
                  });
                  addAttachment(filePath, { isImage: true, dataUrl: readResult.dataUrl });
                  continue;
                }
                console.warn(
                  '[CoworkPromptInput] handleAddFile: readFileAsDataUrl returned falsy',
                  { filePath },
                );
              } catch (error) {
                console.error('Failed to read image as data URL:', error);
              }
            } else {
              console.warn(
                '[CoworkPromptInput] handleAddFile: image skipped vision path because modelSupportsImage=false',
                {
                  filePath,
                  effectiveModelId: effectiveSelectedModel?.id ?? null,
                },
              );
              hasImageWithoutVision = true;
            }
          }
          addAttachment(filePath, isImagePath(filePath) ? { isImage: true } : undefined);
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

    const handlePaste = useCallback(
      (event: React.ClipboardEvent<HTMLDivElement>) => {
        if (disabled || isStreaming) return;
        const files = Array.from(event.clipboardData?.files ?? []);
        if (files.length === 0) return;
        event.preventDefault();
        void handleIncomingFiles(files);
      },
      [disabled, handleIncomingFiles, isStreaming],
    );

    const [currentSendShortcut, setCurrentSendShortcut] = useState(
      () => configService.getConfig().shortcuts?.sendMessage ?? 'Enter',
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
    // Unified Kimi-style toolbar: "+" menu (+ permission selector in work mode)
    // on the left, model picker + submit on the right. remoteManaged sessions
    // keep the minimal read-only layout (model picker + thinking toggle only).
    const isPlusToolbar = !remoteManaged;
    const isWorkVariant = showFolderSelector || showPermissionModeSelector;
    return (
      <div ref={promptRootRef} className="relative">
        {imageVisionHint && (
          <div className="mb-2 flex items-start gap-1.5 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 px-2.5 py-1.5 text-xs text-amber-700 dark:text-amber-400">
            <TriangleAlert className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>{i18nService.t('imageVisionHint')}</span>
            <Button
              variant="ghost"
              size="icon-xs"
              className="ml-auto shrink-0"
              onClick={() => setImageVisionHint(false)}
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        )}
        {topAccessory && <div className="relative">{topAccessory}</div>}
        <PromptInput
          multiple
          className={cn(
            'input-aura shadow-elevated rounded-3xl transition-shadow **:data-[slot=input-group]:rounded-3xl',
            isDraggingFiles && 'ring-2 ring-primary',
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
          {(resumeTaskActive || attachments.length > 0) && (
            <PromptInputHeader className="max-h-[136px] items-start gap-2 overflow-y-auto px-2.5 pt-2">
              {resumeTaskActive && onCancelTaskResume && (
                <ResumeTaskContextBadge onCancel={onCancelTaskResume} />
              )}
              <CoworkInlineAttachments
                attachments={attachments}
                className="max-w-full"
                onRemove={handleRemoveAttachment}
              />
            </PromptInputHeader>
          )}
          <PromptInputBody>
            <InlineSkillPromptEditor
              ref={textareaRef}
              value={value}
              placeholder={placeholder}
              disabled={disabled}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              onChange={setValue}
              className={size === 'large' ? 'max-h-48 overflow-y-auto' : undefined}
            />
          </PromptInputBody>
          <PromptInputFooter className="flex-nowrap">
            <PromptInputTools
              className={cn(
                'min-w-0 flex-1 flex-nowrap overflow-hidden',
                sessionContextPending && 'pointer-events-none opacity-50',
              )}
              aria-disabled={sessionContextPending}
              inert={sessionContextPending ? true : undefined}
            >
              {!isCompactToolbar && !isPlusToolbar && showModelSelector && (
                <>
                  <ContextUsageIndicator
                    usage={contextUsage}
                    messageUsage={contextMessage?.metadata?.usage}
                    modelId={contextMessage?.metadata?.model}
                    modelProviderKey={contextMessage?.metadata?.modelProviderKey}
                    selectedModelId={effectiveSelectedModel?.id}
                    selectedModelProviderKey={effectiveSelectedModel?.providerKey}
                    messages={currentSession?.messages}
                    systemPrompt={currentSession?.systemPrompt}
                  />
                  <CoworkModelPicker
                    models={availableModels}
                    selectedModel={effectiveSelectedModel}
                    open={modelSelectorOpen}
                    onOpenChange={setModelSelectorOpen}
                    onSelect={model => {
                      void handleModelSelect(model);
                    }}
                  />
                </>
              )}
              {!isCompactToolbar && !isPlusToolbar && (
                <LocalThinkingToggle
                  model={effectiveSelectedModel}
                  visible={showLocalThinkingToggle}
                  enabled={localThinkingEnabled}
                  disabled={disabled || isStreaming}
                  onEnabledChange={onLocalThinkingEnabledChange}
                />
              )}
              {isPlusToolbar && (
                <>
                  <PromptPlusMenu
                    onAddFile={() => {
                      void handleAddFile();
                    }}
                    onManageSkills={handleManageSkills}
                    onManageConnectors={() => onManageConnectors?.()}
                    experts={
                      isWorkVariant && !isDirectChat
                        ? { selectedExpertIds, onChange: setSelectedExpertIds }
                        : undefined
                    }
                    goalMode={goalMode}
                    onGoalModeChange={setGoalMode}
                    productionLoopMode={productionLoopMode}
                    onProductionLoopModeChange={setProductionLoopMode}
                    disabled={disabled || isStreaming || isAddingFile}
                  />
                  {!isCompactToolbar && isWorkVariant && (
                    <PermissionModeMenu
                      value={permissionMode ?? CoworkPermissionMode.Ask}
                      onChange={mode => onPermissionModeChange?.(mode)}
                      disabled={disabled}
                    />
                  )}
                  {isWorkVariant && (
                    <ActiveExpertBadge
                      expertId={selectedExpertIds[0]}
                      expertName={
                        currentSession?.experts?.find(
                          expert => expert.expertId === selectedExpertIds[0],
                        )?.expertName
                      }
                      onRemove={() => setSelectedExpertIds([])}
                      compact={isTightToolbar}
                    />
                  )}
                  {isWorkVariant && goalMode && (
                    <GoalModeChip compact={isTightToolbar} onRemove={() => setGoalMode(false)} />
                  )}
                  <ActiveMcpBadge />
                </>
              )}
            </PromptInputTools>
            {!isCompactToolbar && isPlusToolbar && (showLocalThinkingToggle || showModelSelector) && (
              <div className="flex items-center gap-1.5">
                {!isWorkVariant && (
                  <LocalThinkingToggle
                    model={effectiveSelectedModel}
                    visible={showLocalThinkingToggle}
                    enabled={localThinkingEnabled}
                    disabled={disabled || isStreaming}
                    onEnabledChange={onLocalThinkingEnabledChange}
                  />
                )}
                {showModelSelector && (
                  <>
                    <ContextUsageIndicator
                      usage={contextUsage}
                      messageUsage={contextMessage?.metadata?.usage}
                      modelId={contextMessage?.metadata?.model}
                      modelProviderKey={contextMessage?.metadata?.modelProviderKey}
                      selectedModelId={effectiveSelectedModel?.id}
                      selectedModelProviderKey={effectiveSelectedModel?.providerKey}
                      messages={currentSession?.messages}
                      systemPrompt={currentSession?.systemPrompt}
                    />
                    <CoworkModelPicker
                      models={availableModels}
                      selectedModel={effectiveSelectedModel}
                      open={modelSelectorOpen}
                      onOpenChange={setModelSelectorOpen}
                      onSelect={model => {
                        void handleModelSelect(model);
                      }}
                    />
                  </>
                )}
              </div>
            )}
            <PromptInputSubmit
              disabled={sessionContextPending}
              status={isStreaming ? 'streaming' : 'ready'}
              onStop={isStreaming ? onStop : undefined}
            />
          </PromptInputFooter>
        </PromptInput>
        <SessionStatsLine messages={currentSession?.messages ?? []} />
        {showFolderSelector && (
          <div className="relative mt-1.5 flex justify-start">
            <FolderSelectorPopover
              onSelectFolder={handleFolderSelect}
              onUseNoFolder={onUseNoFolder}
              side="bottom"
              align="start"
              showNoFolderAction={showNoFolderAction}
              initialDirectory={workingDirectory}
            >
              <PromptInputButton
                className={`sidebar-interactive-surface gap-1 px-2 text-sm hover:shadow-subtle data-popup-open:shadow-subtle ${showFolderRequiredWarning ? 'ring-1 ring-warning text-warning animate-shake' : ''}`}
              >
                <Folder className="size-4 shrink-0" />
                <span>{workingDirectoryName || i18nService.t('enterProjectWork')}</span>
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              </PromptInputButton>
            </FolderSelectorPopover>
            {showFolderRequiredWarning && (
              <div className="absolute bottom-full mb-1 px-2 py-1 rounded-md bg-surface-raised text-warning text-xs whitespace-nowrap animate-fade-in-up shadow-subtle z-10">
                {i18nService.t('coworkSelectFolderFirst')}
              </div>
            )}
          </div>
        )}
      </div>
    );
  },
);

CoworkPromptInputInner.displayName = 'CoworkPromptInputInner';

const CoworkPromptInput = React.forwardRef<CoworkPromptInputRef, CoworkPromptInputProps>(
  (props, ref) => (
    <PromptInputProvider>
      <CoworkPromptInputInner {...props} ref={ref} />
    </PromptInputProvider>
  ),
);

CoworkPromptInput.displayName = 'CoworkPromptInput';

export default CoworkPromptInput;
