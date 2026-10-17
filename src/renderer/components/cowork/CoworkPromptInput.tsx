import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputHeader,
  PromptInputProvider,
  PromptInputSubmit,
  PromptInputTools,
  usePromptInputController,
} from '@shared/components/ai-elements/prompt-input';
import { Button } from '@shared/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@shared/components/ui/tooltip';
import { cn } from '@shared/lib/utils';
import { TriangleAlert, X } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import {
  DEFAULT_COWORK_PERMISSION_MODE,
  CoworkSessionMode,
} from '../../../shared/cowork/constants';
import { hasVisiblePromptContent } from '../../../shared/cowork/submissionContent';
import { i18nService } from '../../services/i18n';
import { skillService } from '../../services/skill';
import { RootState } from '../../store';
import { selectDraftPrompts } from '../../store/selectors/coworkSelectors';
import { selectWorkMode } from '../../store/selectors/workModeSelectors';
import {
  clearDraftAttachments,
  setDraftAttachments,
  setDraftPrompt,
} from '../../store/slices/coworkSlice';
import { clearSelection } from '../../store/slices/quickActionSlice';
import { clearActiveSkills, setSkills } from '../../store/slices/skillSlice';
import { WorkMode } from '../../store/workMode/constants';
import { CoworkImageAttachment } from '../../types/cowork';
import ActiveMcpBadge from '../mcp/ActiveMcpBadge';
import { SlashCommandMenu } from '../common/SlashCommandMenu';
import ActiveExpertBadge from './ActiveExpertBadge';
import { CoworkInlineAttachments } from './CoworkInlineAttachments';
import { ContextUsageIndicator } from './ContextUsageIndicator';
import { SessionStatsLine } from './SessionStatsLine';
import { CoworkModelPicker } from './CoworkModelPicker';
import { useCoworkSlashMenu } from './useCoworkSlashMenu';
import { PromptWorkspaceSelector } from './PromptWorkspaceSelector';
import InlineSkillPromptEditor from './InlineSkillPromptEditor';
import PermissionModeMenu from './PermissionModeMenu';
import PromptPlusMenu from './PromptPlusMenu';
import { ResumeTaskContextBadge } from './ResumeTaskContextBadge';
import { usePromptSubmissionLock } from './usePromptSubmissionLock';
import { resolveInitialSelectedExpertIds } from './resolveInitialSelectedExpertIds';
import GoalModeChip from './promptInput/GoalModeChip';
import { EMPTY_ATTACHMENTS } from './promptInput/promptInputUtils';
import {
  type CoworkAttachment,
  type CoworkPromptInputProps,
  type CoworkPromptInputRef,
} from './promptInput/types';
import { useCoworkPromptSubmission } from './promptInput/useCoworkPromptSubmission';
import { usePromptAttachments } from './promptInput/usePromptAttachments';
import { usePromptDraftSync } from './promptInput/usePromptDraftSync';
import { usePromptFileDrop } from './promptInput/usePromptFileDrop';
import { usePromptKeyDown } from './promptInput/usePromptKeyDown';
import { usePromptModelSelection } from './promptInput/usePromptModelSelection';

export type { CoworkPromptInputRef } from './promptInput/types';

// Only collapse secondary controls when the chat column is genuinely narrow.
// A split pane around 700px still has room for the full permission/model row.
const COMPACT_TOOLBAR_MAX_WIDTH = 480;
const TIGHT_TOOLBAR_MAX_WIDTH = 760;

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
      onCreateProject,
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
      (currentSession?.mode ?? CoworkSessionMode.Work) === CoworkSessionMode.Work;
    const persistedExpertIds = useMemo(
      () => currentSession?.experts?.slice(0, 1).map(expert => expert.expertId) ?? [],
      [currentSession?.experts],
    );
    const [selectedExpertIds, setSelectedExpertIds] = useState<string[]>(() => persistedExpertIds);
    const [value, setValue] = useState(draftPrompt);
    const [goalMode, setGoalMode] = useState(false);

    const [showFolderRequiredWarning, setShowFolderRequiredWarning] = useState(false);
    const [imageVisionHint, setImageVisionHint] = useState(false);
    const [modelSelectorOpen, setModelSelectorOpen] = useState(false);
    const [isCompactToolbar, setIsCompactToolbar] = useState(false);
    const [isTightToolbar, setIsTightToolbar] = useState(false);

    const textareaRef = useRef<HTMLDivElement>(null);
    const promptRootRef = useRef<HTMLDivElement>(null);
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
          path: img.path || `inline:${img.name}:reedit-${Date.now()}-${idx}`,
          name: img.name,
          isImage: true,
          ...(!img.path && img.base64Data
            ? { dataUrl: `data:${img.mimeType};base64,${img.base64Data}` }
            : {}),
        }));
        dispatch(setDraftAttachments({ draftKey, attachments: newAttachments }));
      },
      focus: () => {
        textareaRef.current?.focus();
      },
    }));

    const activeSkillIds = useSelector((state: RootState) => state.skill.activeSkillIds);

    const {
      effectiveSelectedModel,
      modelSupportsImage,
      isPatchingModel,
      hasUnavailableLlamaCppModel,
      handleModelSelect,
    } = usePromptModelSelection({
      sessionId,
      currentAgentId,
      currentAgent,
      currentSession,
      availableModels,
    });

    usePromptDraftSync({
      draftKey,
      draftPrompt,
      value,
      setValue,
      attachments,
      modelSupportsImage,
      setImageVisionHint,
      controller,
    });

    // Load skills on mount
    useEffect(() => {
      // 2026/09/22 lixiang  从专家页进入新会话时选中当前专家 agent（#100）
      setSelectedExpertIds(
        resolveInitialSelectedExpertIds({
          sessionId: currentSession?.id,
          persistedExpertIds,
          currentAgentId,
          currentAgentSource: currentAgent?.source,
        }),
      );
    }, [currentSession?.id, currentAgentId, currentAgent?.source, persistedExpertIds]);

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

    // 切换工作/对话模式时：仅在首页 (__home__) 时清空输入、首页草稿与已挂载 skill；
    // 真实会话 (draftKey !== '__home__') 中保留用户草稿与附件，严禁误清。
    const prevWorkModeForDraftRef = useRef(workMode);
    useEffect(() => {
      if (prevWorkModeForDraftRef.current === workMode) return;
      prevWorkModeForDraftRef.current = workMode;

      if (draftKey === '__home__') {
        setValue('');
        setImageVisionHint(false);
        dispatch(setDraftPrompt({ sessionId: '__home__', draft: '' }));
        dispatch(clearDraftAttachments('__home__'));
        dispatch(clearActiveSkills());
        dispatch(clearSelection());
      }
    }, [workMode, dispatch, draftKey]);

    useEffect(() => {
      const unsubscribe = skillService.onSkillsChanged(() => {
        void syncSkills();
      });
      return () => {
        unsubscribe();
      };
    }, [syncSkills]);

    useEffect(() => {
      if (workingDirectory?.trim()) {
        setShowFolderRequiredWarning(false);
      }
    }, [workingDirectory]);

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

    // Slash command menu (`/skill`, `/compact`). State and filtering live in
    // the hook; submitPrompt decides what the text actually does.
    const slashMenu = useCoworkSlashMenu({
      value,
      disabled,
      remoteManaged,
      sessionId,
      setValue,
      focusEditor: () => textareaRef.current?.focus(),
    });
    const {
      enabledSkills: slashEnabledSkills,
      findEnabledSkill: findSlashSkill,
      runCompact: runSlashCompact,
    } = slashMenu;

    const { isAddingFile, handleIncomingFiles, handleAddFile, handleRemoveAttachment } =
      usePromptAttachments({
        draftKey,
        attachments,
        disabled,
        isStreaming,
        workingDirectory,
        modelSupportsImage,
        effectiveSelectedModel,
        setImageVisionHint,
      });

    const {
      isDraggingFiles,
      handleDragEnter,
      handleDragOver,
      handleDragLeave,
      handleDrop,
      handlePaste,
    } = usePromptFileDrop({ disabled, isStreaming, handleIncomingFiles });

    const { submitPrompt, cancelFolderWarningTimer } = useCoworkPromptSubmission({
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
    });

    const handleSubmit = usePromptSubmissionLock(submitPrompt);

    useEffect(() => {
      const handleFocusInput = (event: Event) => {
        const detail = (
          event as CustomEvent<{ clear?: boolean; clearExperts?: boolean; text?: string }>
        ).detail;
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
        // Only clear when new-chat explicitly requests it; do not tie to shouldClear (avoids ask-ai side effects).
        if (detail?.clearExperts === true) {
          setSelectedExpertIds([]);
        }
        requestAnimationFrame(() => {
          textareaRef.current?.focus();
        });
      };
      window.addEventListener('cowork:focus-input', handleFocusInput);
      return () => {
        window.removeEventListener('cowork:focus-input', handleFocusInput);
        cancelFolderWarningTimer();
      };
    }, [dispatch, draftKey, cancelFolderWarningTimer]);

    const handleManageSkills = useCallback(() => {
      if (onManageSkills) {
        onManageSkills();
      }
    }, [onManageSkills]);

    const handleKeyDown = usePromptKeyDown({
      value,
      disabled,
      isStreaming,
      isPatchingModel,
      canQueueWhileStreaming,
      slashMenu,
      handleSubmit,
    });

    const handleFolderSelect = (path: string) => {
      if (onWorkingDirectoryChange) {
        onWorkingDirectoryChange(path);
      }
    };

    const handleProjectCreate = async (path: string, name: string): Promise<boolean> => {
      if (!onCreateProject) return false;
      return onCreateProject(path, name);
    };

    // Unified Kimi-style toolbar: "+" menu (+ permission selector in work mode)
    // on the left, model picker + submit on the right. remoteManaged sessions
    // keep the minimal read-only layout with the model picker.
    const isPlusToolbar = !remoteManaged;
    const isWorkVariant = showFolderSelector || showPermissionModeSelector;
    // 2026/09/15 lixiang  Empty prompt: dim submit, not-allowed cursor, and ask-user tip
    const isSubmitEmpty =
      !hasVisiblePromptContent(value) && attachments.length === 0 && !resumeTaskActive;
    const showEmptySubmitHint = isSubmitEmpty && !isStreaming;
    return (
      <div ref={promptRootRef} className="relative">
        {imageVisionHint && (
          <div className="mb-2 flex items-start gap-1.5 rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-xs text-muted-foreground">
            <TriangleAlert className="h-3.5 w-3.5 shrink-0 mt-0.5 text-warning" />
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
        {slashMenu.open ? (
          <SlashCommandMenu
            id="cowork-slash-command-menu"
            items={slashMenu.items}
            selectedKey={slashMenu.activeItemKey}
            emptyLabel={i18nService.t('coworkSlashCommandNoMatches')}
            onSelectedKeyChange={slashMenu.setMenuSelection}
            onSelect={slashMenu.selectMenuChoice}
          />
        ) : null}
        <PromptInput
          multiple
          className={cn(
            'theme-composer-surface input-aura',
            isDraggingFiles && 'theme-composer-drop-active',
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
          {/* 2026/09/15 lixiang  Override display:contents so vertical padding on the prompt body actually applies */}
          <PromptInputBody className="flex w-full min-w-0 flex-col pt-2.5 pb-0 pr-px">
            <InlineSkillPromptEditor
              ref={textareaRef}
              value={value}
              placeholder={placeholder}
              disabled={disabled}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              onChange={nextValue => {
                // A dismissal applies to the text that was on screen when the
                // user closed the menu. Clearing it on every edit means typing
                // the same text again (for example a lone "/") reopens the
                // menu instead of staying dismissed forever.
                slashMenu.clearDismissal();
                setValue(nextValue);
              }}
              className={cn(
                'py-0 pr-1.5',
                size === 'large' ? 'theme-home-prompt-editor max-h-48 overflow-y-auto' : undefined,
              )}
            />
          </PromptInputBody>
          <PromptInputFooter className="flex-nowrap">
            <PromptInputTools
              className={cn(
                'min-w-0 flex-1 flex-wrap',
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
              {isPlusToolbar && (
                <PromptPlusMenu
                  onAddFile={() => {
                    void handleAddFile();
                  }}
                  onManageSkills={handleManageSkills}
                  onManageConnectors={() => onManageConnectors?.()}
                  experts={
                    isWorkVariant
                      ? { selectedExpertIds, onChange: setSelectedExpertIds }
                      : undefined
                  }
                  goalMode={goalMode}
                  onGoalModeChange={setGoalMode}
                  disabled={disabled || isStreaming || isAddingFile}
                />
              )}
              {showFolderSelector && (
                <PromptWorkspaceSelector
                  onSelectFolder={handleFolderSelect}
                  onCreateProject={handleProjectCreate}
                  onUseNoFolder={onUseNoFolder}
                  showNoFolderAction={showNoFolderAction}
                  initialDirectory={workingDirectory}
                  label={workingDirectoryName || i18nService.t('enterProjectWork')}
                  compact={isTightToolbar}
                  warning={showFolderRequiredWarning}
                  disabled={disabled || sessionContextPending}
                />
              )}
              {isPlusToolbar && (
                <>
                  {!isCompactToolbar && isWorkVariant && (
                    <PermissionModeMenu
                      value={permissionMode ?? DEFAULT_COWORK_PERMISSION_MODE}
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
            {isPlusToolbar && (showModelSelector || (isCompactToolbar && isWorkVariant)) && (
              <div className="flex min-w-0 shrink-0 items-center gap-1.5">
                {showModelSelector && (
                  <>
                    {!isCompactToolbar && (
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
                    )}
                    <CoworkModelPicker
                      models={availableModels}
                      selectedModel={effectiveSelectedModel}
                      open={modelSelectorOpen}
                      onOpenChange={setModelSelectorOpen}
                      onSelect={model => {
                        void handleModelSelect(model);
                      }}
                      compact={isCompactToolbar}
                    />
                  </>
                )}
                {isCompactToolbar && isWorkVariant && (
                  <PermissionModeMenu
                    value={permissionMode ?? DEFAULT_COWORK_PERMISSION_MODE}
                    onChange={mode => onPermissionModeChange?.(mode)}
                    disabled={disabled}
                    compact
                  />
                )}
              </div>
            )}
            {/* 2026/09/15 lixiang  Empty prompt: dim submit, not-allowed cursor, and ask-user tip */}
            {showEmptySubmitHint ? (
              <TooltipProvider delay={0}>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <span
                        className="inline-flex cursor-not-allowed"
                        aria-label={i18nService.t('chatSubmitEmptyHint')}
                      />
                    }
                  >
                    <PromptInputSubmit
                      type="button"
                      status="ready"
                      aria-disabled="true"
                      tabIndex={-1}
                      onClick={event => {
                        event.preventDefault();
                        event.stopPropagation();
                      }}
                      className="cursor-not-allowed opacity-40"
                    />
                  </TooltipTrigger>
                  <TooltipContent side="top">{i18nService.t('chatSubmitEmptyHint')}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : (
              <PromptInputSubmit
                disabled={sessionContextPending}
                status={isStreaming ? 'streaming' : 'ready'}
                onStop={isStreaming ? onStop : undefined}
              />
            )}
          </PromptInputFooter>
        </PromptInput>
        <SessionStatsLine messages={currentSession?.messages ?? []} />
        {showFolderSelector && showFolderRequiredWarning && (
          <div className="theme-home-folder-warning mt-2" role="alert">
            {i18nService.t('coworkSelectFolderFirst')}
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
