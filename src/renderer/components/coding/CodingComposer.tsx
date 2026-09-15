import {
  PromptInput,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuItem,
  PromptInputActionMenuTrigger,
  PromptInputBody,
  PromptInputButton,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from '@shared/components/ai-elements/prompt-input';
import { ImageIcon, X } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';

import type {
  CodingAgentAvailableCommand,
  CodingAgentConfigOption,
  CodingPromptAttachment,
} from '../../../shared/codingAgent';
import { i18nService } from '../../services/i18n';
import { CodingComposerConfigControls } from './CodingComposerConfigControls';
import { CodingSlashCommandMenu, type CodingSlashCommandMenuItem } from './CodingSlashCommandMenu';
import {
  filterCommandOptions,
  filterSlashCommands,
  slashCommandArgument,
  slashCommandPrompt,
  slashCommandQuery,
  slashCommandSelectionPrompt,
} from './codingSlashCommands';
import { CodingComposerStatus } from './constants';
import PendingMessageQueue from '../cowork/PendingMessageQueue';
import type { coworkQueueService } from '../../services/coworkQueue';

interface CodingComposerProps {
  availableCommands: CodingAgentAvailableCommand[];
  configOptions: CodingAgentConfigOption[];
  disabled: boolean;
  isRunning: boolean;
  isSubmitting?: boolean;
  hasError?: boolean;
  prompt: string;
  focusRequestKey?: number;
  attachments: CodingPromptAttachment[];
  canAttachFiles: boolean;
  leadingTools?: ReactNode;
  statusNotice?: ReactNode;
  sessionId?: string;
  queueService?: Pick<
    typeof coworkQueueService,
    'subscribe' | 'load' | 'update' | 'remove' | 'steer' | 'followUp'
  >;
  onChange: (value: string) => void;
  onAddAttachments: () => void;
  onRemoveAttachment: (path: string) => void;
  onConfigOptionChange: (optionId: string, value: string | boolean) => void;
  onSend: () => void;
  onSteer?: () => void;
  supportsSteerShortcut?: boolean;
  onStop: () => void;
}

export const CodingComposer = ({
  availableCommands,
  configOptions,
  disabled,
  isRunning,
  isSubmitting = false,
  hasError = false,
  prompt,
  focusRequestKey = 0,
  attachments,
  canAttachFiles,
  leadingTools,
  statusNotice,
  sessionId,
  queueService,
  onChange,
  onAddAttachments,
  onRemoveAttachment,
  onConfigOptionChange,
  onSend,
  onSteer,
  supportsSteerShortcut = false,
  onStop,
}: CodingComposerProps) => {
  const composerRootRef = useRef<HTMLDivElement | null>(null);
  const [isTightToolbar, setIsTightToolbar] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const promptRef = useRef(prompt);
  promptRef.current = prompt;
  const [commandSelection, setCommandSelection] = useState<{
    query: string | null;
    name: string;
  }>({ query: null, name: '' });
  const [choiceSelection, setChoiceSelection] = useState<{
    argument: string | null;
    value: string;
  }>({ argument: null, value: '' });
  const [dismissedPrompt, setDismissedPrompt] = useState<string | null>(null);
  const query = slashCommandQuery(prompt);
  const matchingCommands = query === null ? [] : filterSlashCommands(availableCommands, query);
  const argument = slashCommandArgument(prompt);
  const argumentCommand = argument
    ? availableCommands.find(command => command.name === argument.name)
    : undefined;
  const argumentOptions = argumentCommand?.input?.options ?? [];
  const matchingOptions = argument ? filterCommandOptions(argumentOptions, argument.query) : [];
  const selectedCommandName = commandSelection.query === query ? commandSelection.name : '';
  const selectedCommand =
    matchingCommands.find(command => command.name === selectedCommandName) ?? matchingCommands[0];
  const selectedChoiceValue =
    choiceSelection.argument === (argument?.query ?? null) ? choiceSelection.value : '';
  const selectedChoice =
    matchingOptions.find(option => option.value === selectedChoiceValue) ?? matchingOptions[0];
  const commandMenuDismissed = dismissedPrompt === prompt;
  // A command that takes a selection swaps the same menu to its choices.
  const choiceMenuOpen =
    !disabled &&
    !isRunning &&
    argument !== null &&
    argumentOptions.length > 0 &&
    !commandMenuDismissed;
  const commandMenuOpen =
    !disabled &&
    !isRunning &&
    query !== null &&
    availableCommands.length > 0 &&
    !commandMenuDismissed;
  const menuOpen = choiceMenuOpen || commandMenuOpen;
  const menuItems: CodingSlashCommandMenuItem[] = choiceMenuOpen
    ? matchingOptions.map(option => ({
        key: option.value,
        token: option.label,
        ...(option.description ? { description: option.description } : {}),
      }))
    : matchingCommands.map(command => ({
        key: command.name,
        token: `/${command.name}`,
        description: command.description,
        ...(command.input?.hint ? { hint: command.input.hint } : {}),
      }));
  const activeMenuItemKey = choiceMenuOpen
    ? (selectedChoice?.value ?? '')
    : (selectedCommand?.name ?? '');

  useEffect(() => {
    const element = composerRootRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const updateToolbarDensity = () => setIsTightToolbar(element.clientWidth <= 760);
    updateToolbarDensity();
    const observer = new ResizeObserver(updateToolbarDensity);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (focusRequestKey === 0 || disabled) return;
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(promptRef.current.length, promptRef.current.length);
    });
  }, [disabled, focusRequestKey]);

  const applyPrompt = (nextPrompt: string, options?: { openChoices?: boolean }) => {
    // A dismissal normally remembers the text the user just accepted, so the
    // menu does not bounce back open. Commands that take a selection are the
    // exception: the menu swaps to their candidates instead of closing.
    setDismissedPrompt(options?.openChoices ? null : nextPrompt);
    onChange(nextPrompt);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(nextPrompt.length, nextPrompt.length);
    });
  };

  const selectCommand = (command: CodingAgentAvailableCommand) => {
    applyPrompt(slashCommandPrompt(command), {
      openChoices: (command.input?.options?.length ?? 0) > 0,
    });
  };

  const selectMenuChoice = (key: string) => {
    if (choiceMenuOpen) {
      if (argumentCommand) applyPrompt(slashCommandSelectionPrompt(argumentCommand.name, key));
      return;
    }
    const command = matchingCommands.find(candidate => candidate.name === key);
    if (command) selectCommand(command);
  };

  const setMenuSelection = (key: string) => {
    if (choiceMenuOpen) {
      setChoiceSelection({ argument: argument?.query ?? '', value: key });
      return;
    }
    setCommandSelection({ query, name: key });
  };

  const insertNewlineAtCursor = () => {
    const textarea = textareaRef.current;
    const selectionStart = textarea?.selectionStart ?? prompt.length;
    const selectionEnd = textarea?.selectionEnd ?? selectionStart;
    const nextPrompt = `${prompt.slice(0, selectionStart)}\n${prompt.slice(selectionEnd)}`;
    onChange(nextPrompt);
    requestAnimationFrame(() => {
      const nextCursorPosition = selectionStart + 1;
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(nextCursorPosition, nextCursorPosition);
    });
  };

  return (
    <div ref={composerRootRef} className="px-4 pt-2 pb-4">
      <div className="relative mx-auto max-w-5xl">
        {statusNotice}
        {sessionId ? (
          <PendingMessageQueue
            sessionId={sessionId}
            isStreaming={isRunning}
            queueService={queueService}
          />
        ) : null}
        {menuOpen ? (
          <CodingSlashCommandMenu
            items={menuItems}
            selectedKey={activeMenuItemKey}
            onSelectedKeyChange={setMenuSelection}
            onSelect={selectMenuChoice}
          />
        ) : null}
        <PromptInput
          className="theme-composer-surface input-aura"
          onSubmit={(_message, event) => {
            event.preventDefault();
            if (!disabled && !isSubmitting && prompt.trim()) onSend();
          }}
        >
          <PromptInputBody>
            <PromptInputTextarea
              ref={textareaRef}
              value={prompt}
              onChange={event => {
                // A dismissal applies to the text that was on screen when the
                // user closed the menu. Clearing it on every edit means typing
                // the same text again (for example a lone "/") reopens the
                // menu instead of staying dismissed forever.
                setDismissedPrompt(null);
                onChange(event.target.value);
              }}
              onKeyDown={event => {
                if (event.nativeEvent.isComposing) return;
                if (
                  event.key.toLowerCase() === 's' &&
                  event.ctrlKey &&
                  supportsSteerShortcut &&
                  isRunning &&
                  prompt.trim()
                ) {
                  event.preventDefault();
                  onSteer?.();
                  return;
                }
                if (event.key === 'Enter' && event.ctrlKey) {
                  event.preventDefault();
                  insertNewlineAtCursor();
                  return;
                }
                if (!menuOpen) return;
                if (event.key === 'Escape') {
                  event.preventDefault();
                  setDismissedPrompt(prompt);
                  return;
                }
                if (menuItems.length === 0) return;
                const selectedIndex = menuItems.findIndex(item => item.key === activeMenuItemKey);
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  event.preventDefault();
                  const offset = event.key === 'ArrowDown' ? 1 : -1;
                  const nextIndex =
                    (Math.max(selectedIndex, 0) + offset + menuItems.length) % menuItems.length;
                  setMenuSelection(menuItems[nextIndex].key);
                  return;
                }
                if (event.key === 'Tab') {
                  event.preventDefault();
                  selectMenuChoice(activeMenuItemKey);
                  return;
                }
                if (event.key === 'Enter') {
                  if (choiceMenuOpen) {
                    if (!argumentCommand) return;
                    if (
                      prompt ===
                      slashCommandSelectionPrompt(argumentCommand.name, activeMenuItemKey)
                    ) {
                      setDismissedPrompt(prompt);
                      return;
                    }
                    event.preventDefault();
                    selectMenuChoice(activeMenuItemKey);
                    return;
                  }
                  if (!selectedCommand) return;
                  if (
                    prompt === slashCommandPrompt(selectedCommand) &&
                    !selectedCommand.input?.hint
                  ) {
                    setDismissedPrompt(prompt);
                    return;
                  }
                  event.preventDefault();
                  selectCommand(selectedCommand);
                }
              }}
              placeholder={i18nService.t('codingAgentPromptPlaceholder')}
              aria-label={i18nService.t('codingAgentPromptPlaceholder')}
              aria-autocomplete="list"
              aria-controls={menuOpen ? 'coding-agent-command-menu' : undefined}
              aria-expanded={menuOpen}
              disabled={disabled}
              className="max-h-48 min-h-20"
            />
            {attachments.length > 0 ? (
              <div className="flex flex-wrap gap-1 px-3 pb-2">
                {attachments.map(attachment => (
                  <PromptInputButton
                    key={attachment.path}
                    type="button"
                    className="theme-prompt-compact-action max-w-48 gap-1"
                    tooltip={i18nService.t('codingAttachmentRemove')}
                    onClick={() => onRemoveAttachment(attachment.path)}
                  >
                    <span className="truncate">{attachment.name}</span>
                    <X className="size-3.5 shrink-0" />
                  </PromptInputButton>
                ))}
              </div>
            ) : null}
          </PromptInputBody>
          <PromptInputFooter className="flex-wrap">
            <PromptInputTools className="flex-1 flex-wrap">
              {canAttachFiles ? (
                <PromptInputActionMenu>
                  <PromptInputActionMenuTrigger tooltip={i18nService.t('codingAttachmentAdd')} />
                  <PromptInputActionMenuContent>
                    <PromptInputActionMenuItem onClick={onAddAttachments}>
                      <ImageIcon className="mr-2 size-4" />
                      {i18nService.t('codingAttachmentAdd')}
                    </PromptInputActionMenuItem>
                  </PromptInputActionMenuContent>
                </PromptInputActionMenu>
              ) : null}
              {leadingTools}
              <CodingComposerConfigControls
                options={configOptions}
                onChange={onConfigOptionChange}
                compact={isTightToolbar}
              />
            </PromptInputTools>
            <PromptInputSubmit
              status={
                isRunning
                  ? CodingComposerStatus.Streaming
                  : isSubmitting
                    ? CodingComposerStatus.Submitted
                    : hasError
                      ? CodingComposerStatus.Error
                      : undefined
              }
              onStop={isRunning ? onStop : undefined}
              disabled={disabled || isSubmitting || (!isRunning && !prompt.trim())}
              aria-label={
                isRunning ? i18nService.t('codingAgentStop') : i18nService.t('codingAgentSend')
              }
            />
          </PromptInputFooter>
        </PromptInput>
      </div>
    </div>
  );
};
