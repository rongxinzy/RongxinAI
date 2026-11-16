import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputHeader,
  PromptInputProvider,
  PromptInputSubmit,
  PromptInputTools,
} from '@shared/components/ai-elements/prompt-input';
import { Alert, AlertDescription, AlertTitle } from '@shared/components/ui/alert';
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
  CoworkSessionMode,
  DEFAULT_COWORK_PERMISSION_MODE,
} from '../../../../shared/cowork/constants';
import { hasVisiblePromptContent } from '../../../../shared/cowork/submissionContent';
import { i18nService } from '../../../services/i18n';
import { skillService } from '../../../services/skill';
import type { RootState } from '../../../store';
import { selectDraftPrompts } from '../../../store/selectors/coworkSelectors';
import { selectWorkMode } from '../../../store/selectors/workModeSelectors';
import {
  clearDraftAttachments,
  setDraftAttachments,
  setDraftPrompt,
} from '../../../store/slices/coworkSlice';
import { clearSelection } from '../../../store/slices/quickActionSlice';
import { clearActiveSkills, setSkills } from '../../../store/slices/skillSlice';
import { WorkMode } from '../../../store/workMode/constants';
import type { CoworkImageAttachment } from '../../../types/cowork';
import { SlashCommandMenu } from '../../common/SlashCommandMenu';
import ActiveExpertBadge from '../../cowork/ActiveExpertBadge';
import { ContextUsageIndicator } from '../../cowork/ContextUsageIndicator';
import { CoworkInlineAttachments } from '../../cowork/CoworkInlineAttachments';
import { CoworkModelPicker } from '../../cowork/CoworkModelPicker';
import PermissionModeMenu from '../../cowork/PermissionModeMenu';
import PromptPlusMenu from '../../cowork/PromptPlusMenu';
import { PromptWorkspaceSelector } from '../../cowork/PromptWorkspaceSelector';
import GoalModeChip from '../../cowork/promptInput/GoalModeChip';
import { EMPTY_ATTACHMENTS } from '../../cowork/promptInput/promptInputUtils';
import type {
  CoworkAttachment,
  CoworkPromptInputProps,
  CoworkPromptInputRef,
} from '../../cowork/promptInput/types';
import { useCoworkPromptSubmission } from '../../cowork/promptInput/useCoworkPromptSubmission';
import { usePromptAttachments } from '../../cowork/promptInput/usePromptAttachments';
import { usePromptDraftSync } from '../../cowork/promptInput/usePromptDraftSync';
import { usePromptFileDrop } from '../../cowork/promptInput/usePromptFileDrop';
import { usePromptKeyDown } from '../../cowork/promptInput/usePromptKeyDown';
import { usePromptModelSelection } from '../../cowork/promptInput/usePromptModelSelection';
import { resolveInitialSelectedExpertIds } from '../../cowork/resolveInitialSelectedExpertIds';
import { SessionStatsLine } from '../../cowork/SessionStatsLine';
import { useCoworkSlashMenu } from '../../cowork/useCoworkSlashMenu';
import { usePromptSubmissionLock } from '../../cowork/usePromptSubmissionLock';
import ActiveMcpBadge from '../../mcp/ActiveMcpBadge';
import { TiptapPromptEditor, type TiptapPromptEditorHandle } from './TiptapPromptEditor';

const COMPACT_TOOLBAR_MAX_WIDTH = 480;
const TIGHT_TOOLBAR_MAX_WIDTH = 760;

const ConversationComposerInner = React.forwardRef<CoworkPromptInputRef, CoworkPromptInputProps>(
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
      onManageModels,
      onManageSkills,
      onManageConnectors,
      showPermissionModeSelector = false,
      permissionMode,
      onPermissionModeChange,
      sessionId,
      remoteManaged = false,
      topAccessory,
    } = props;

    const dispatch = useDispatch();
    const draftKey = sessionId || '__home__';
    const draftPrompts = useSelector(selectDraftPrompts);
    const draftPrompt = draftPrompts[draftKey] ?? '';
    const rawAttachments = useSelector(
      (state: RootState) => state.cowork.draftAttachments[draftKey],
    );
    const attachments = rawAttachments ?? EMPTY_ATTACHMENTS;
    const availableModels = useSelector((state: RootState) => state.model.availableModels);
    const modelServiceState = useSelector((state: RootState) => state.model.serviceState);
    const currentAgentId = useSelector((state: RootState) => state.agent.currentAgentId);
    const currentAgent = useSelector((state: RootState) =>
      state.agent.agents.find(agent => agent.id === state.agent.currentAgentId),
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

    const editorRef = useRef<TiptapPromptEditorHandle>(null);
    const promptRootRef = useRef<HTMLDivElement>(null);

    React.useImperativeHandle(ref, () => ({
      setValue: (newValue: string) => {
        setValue(newValue);
        requestAnimationFrame(() => {
          editorRef.current?.focus();
        });
      },
      setImageAttachments: (images: CoworkImageAttachment[]) => {
        const nextAttachments: CoworkAttachment[] = images.map((img, idx) => ({
          path: img.path || `inline:${img.name}:reedit-${Date.now()}-${idx}`,
          name: img.name,
          isImage: true,
          ...(!img.path && img.base64Data
            ? { dataUrl: `data:${img.mimeType};base64,${img.base64Data}` }
            : {}),
        }));
        dispatch(setDraftAttachments({ draftKey, attachments: nextAttachments }));
      },
      focus: () => {
        editorRef.current?.focus();
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
    });

    useEffect(() => {
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
      dispatch(setSkills(loadedSkills));
    }, [dispatch]);

    useEffect(() => {
      void syncSkills();
    }, [syncSkills, workMode]);

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

    const slashMenu = useCoworkSlashMenu({
      value,
      disabled,
      remoteManaged,
      sessionId,
      setValue,
      focusEditor: () => editorRef.current?.focus(),
    });

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
      showFolderSelector,
      workingDirectory,
      setShowFolderRequiredWarning,
      effectiveSelectedModel,
      modelSupportsImage,
      selectedExpertIds,
      goalMode,
      activeSkillIds,
      slashEnabledSkills: slashMenu.enabledSkills,
      findSlashSkill: slashMenu.findEnabledSkill,
      runSlashCompact: slashMenu.runCompact,
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
        if (detail?.clearExperts === true) {
          setSelectedExpertIds([]);
        }
        requestAnimationFrame(() => {
          editorRef.current?.focus();
        });
      };
      window.addEventListener('cowork:focus-input', handleFocusInput);
      return () => {
        window.removeEventListener('cowork:focus-input', handleFocusInput);
        cancelFolderWarningTimer();
      };
    }, [dispatch, draftKey, cancelFolderWarningTimer]);

    const handleKeyDown = usePromptKeyDown({
      value,
      disabled,
      isStreaming,
      isPatchingModel,
      canQueueWhileStreaming,
      slashMenu,
      handleSubmit,
    });

    const isPlusToolbar = !remoteManaged;
    const isWorkVariant = showFolderSelector || showPermissionModeSelector;
    const isSubmitEmpty = !hasVisiblePromptContent(value) && attachments.length === 0;
    const showEmptySubmitHint = isSubmitEmpty && !isStreaming;

    return (
      <div ref={promptRootRef} className="relative">
        {modelServiceState === 'failed' && (
          <Alert variant="destructive" className="mb-2">
            <TriangleAlert />
            <AlertTitle>{i18nService.t('magpieGatewayStartFailedTitle')}</AlertTitle>
            <AlertDescription>{i18nService.t('magpieGatewayStartFailedHint')}</AlertDescription>
          </Alert>
        )}
        {imageVisionHint && (
          <div className="mb-2 flex items-start gap-1.5 rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-xs text-muted-foreground">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
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
        {topAccessory ? <div className="relative">{topAccessory}</div> : null}
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
          {attachments.length > 0 && (
            <PromptInputHeader className="max-h-[136px] items-start gap-2 overflow-y-auto px-2.5 pt-2">
              <CoworkInlineAttachments
                attachments={attachments}
                className="max-w-full"
                onRemove={handleRemoveAttachment}
              />
            </PromptInputHeader>
          )}
          <PromptInputBody className="flex w-full min-w-0 flex-col pt-2.5 pr-px pb-0">
            <TiptapPromptEditor
              ref={editorRef}
              value={value}
              placeholder={placeholder}
              disabled={disabled}
              attachments={attachments}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              onChange={nextValue => {
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
                    onManageModels={onManageModels}
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
                  onManageSkills={() => onManageSkills?.()}
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
                  onSelectFolder={path => onWorkingDirectoryChange?.(path)}
                  onCreateProject={async (path, name) =>
                    onCreateProject ? onCreateProject(path, name) : false
                  }
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
                      onManageModels={onManageModels}
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

ConversationComposerInner.displayName = 'ConversationComposerInner';

export const ConversationComposer = React.forwardRef<CoworkPromptInputRef, CoworkPromptInputProps>(
  (props, ref) => (
    <PromptInputProvider>
      <ConversationComposerInner {...props} ref={ref} />
    </PromptInputProvider>
  ),
);

ConversationComposer.displayName = 'ConversationComposer';
