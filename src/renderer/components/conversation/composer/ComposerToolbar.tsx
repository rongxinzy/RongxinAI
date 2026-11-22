import {
  PromptInputFooter,
  PromptInputTools,
  PromptInputSubmit,
} from '@shared/components/ai-elements/prompt-input';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@shared/components/ui/tooltip';
import { cn } from '@shared/lib/utils';
import { useState } from 'react';
import { DEFAULT_COWORK_PERMISSION_MODE } from '../../../../shared/cowork/constants';
import { i18nService } from '../../../services/i18n';
import type { CoworkMessage, CoworkSession } from '../../../types/cowork';
import type { Model } from '../../../store/slices/modelSlice';
import ActiveExpertBadge from '../../cowork/ActiveExpertBadge';
import { ContextUsageIndicator } from '../../cowork/ContextUsageIndicator';
import { CoworkModelPicker } from '../../cowork/CoworkModelPicker';
import PermissionModeMenu from '../../cowork/PermissionModeMenu';
import PromptPlusMenu from '../../cowork/PromptPlusMenu';
import { PromptWorkspaceSelector } from '../../cowork/PromptWorkspaceSelector';
import GoalModeChip from '../../cowork/promptInput/GoalModeChip';
import type { CoworkPromptInputProps } from '../../cowork/promptInput/types';
import ActiveMcpBadge from '../../mcp/ActiveMcpBadge';

interface Props {
  config: CoworkPromptInputProps;
  currentSession: CoworkSession | null;
  contextMessage?: CoworkMessage;
  availableModels: Model[];
  effectiveSelectedModel: Model | null;
  handleModelSelect: (model: Model) => Promise<void>;
  isCompactToolbar: boolean;
  isTightToolbar: boolean;
  isAddingFile: boolean;
  showFolderRequiredWarning: boolean;
  selectedExpertIds: string[];
  setSelectedExpertIds: (ids: string[]) => void;
  goalMode: boolean;
  setGoalMode: (value: boolean) => void;
  handleAddFile: () => Promise<void>;
  showEmptySubmitHint: boolean;
}

export function ComposerToolbar({
  config,
  currentSession,
  contextMessage,
  availableModels,
  effectiveSelectedModel,
  handleModelSelect,
  isCompactToolbar,
  isTightToolbar,
  isAddingFile,
  showFolderRequiredWarning,
  selectedExpertIds,
  setSelectedExpertIds,
  goalMode,
  setGoalMode,
  handleAddFile,
  showEmptySubmitHint,
}: Props) {
  const {
    onStop,
    isStreaming = false,
    disabled = false,
    sessionContextPending = false,
    remoteManaged = false,
    showFolderSelector = false,
    showPermissionModeSelector = false,
    showModelSelector = false,
    onManageModels,
    onManageSkills,
    onManageConnectors,
    onWorkingDirectoryChange,
    onCreateProject,
    onUseNoFolder,
    showNoFolderAction = true,
    workingDirectory = '',
    workingDirectoryName,
    permissionMode,
    onPermissionModeChange,
  } = config;
  const [modelSelectorOpen, setModelSelectorOpen] = useState(false);
  const contextUsage = contextMessage?.metadata?.contextUsage;
  const isPlusToolbar = !remoteManaged;
  const isWorkVariant = showFolderSelector || showPermissionModeSelector;
  const compactPermission = isCompactToolbar && Boolean(config.sessionId);
  return (
    <PromptInputFooter className="flex-nowrap">
      <PromptInputTools
        className={cn(
          'min-w-0 flex-1 flex-wrap',
          sessionContextPending && 'theme-conversation-toolbar-pending pointer-events-none',
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
              isWorkVariant ? { selectedExpertIds, onChange: setSelectedExpertIds } : undefined
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
            {!compactPermission && isWorkVariant && (
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
                  currentSession?.experts?.find(expert => expert.expertId === selectedExpertIds[0])
                    ?.expertName
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
      {isPlusToolbar && (showModelSelector || (compactPermission && isWorkVariant)) && (
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
          {compactPermission && isWorkVariant && (
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
                className="theme-conversation-submit-empty cursor-not-allowed"
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
  );
}
