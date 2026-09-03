import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from '@shared/components/ai-elements/prompt-input';
import { Bot } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';

import type {
  CodingAgentAvailableCommand,
  CodingAgentConfigOption,
} from '../../../shared/codingAgent';
import { i18nService } from '../../services/i18n';
import { CodingComposerConfigControls } from './CodingComposerConfigControls';
import { CodingSlashCommandMenu } from './CodingSlashCommandMenu';
import { filterSlashCommands, slashCommandPrompt, slashCommandQuery } from './codingSlashCommands';
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
  recipientName: string;
  showRecipient?: boolean;
  leadingTools?: ReactNode;
  statusNotice?: ReactNode;
  sessionId?: string;
  queueService?: Pick<typeof coworkQueueService, 'subscribe' | 'load' | 'update' | 'remove' | 'steer' | 'followUp'>;
  onChange: (value: string) => void;
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
  recipientName,
  showRecipient = true,
  leadingTools,
  statusNotice,
  sessionId,
  queueService,
  onChange,
  onConfigOptionChange,
  onSend,
  onSteer,
  supportsSteerShortcut = false,
  onStop,
}: CodingComposerProps) => {
  const composerRootRef = useRef<HTMLDivElement | null>(null);
  const [isTightToolbar, setIsTightToolbar] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [commandSelection, setCommandSelection] = useState<{
    query: string | null;
    name: string;
  }>({ query: null, name: '' });
  const [dismissedPrompt, setDismissedPrompt] = useState<string | null>(null);
  const query = slashCommandQuery(prompt);
  const matchingCommands = query === null ? [] : filterSlashCommands(availableCommands, query);
  const selectedCommandName = commandSelection.query === query ? commandSelection.name : '';
  const selectedCommand =
    matchingCommands.find(command => command.name === selectedCommandName) ?? matchingCommands[0];
  const commandMenuOpen =
    !disabled &&
    !isRunning &&
    query !== null &&
    availableCommands.length > 0 &&
    dismissedPrompt !== prompt;

  useEffect(() => {
    const element = composerRootRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const updateToolbarDensity = () => setIsTightToolbar(element.clientWidth <= 760);
    updateToolbarDensity();
    const observer = new ResizeObserver(updateToolbarDensity);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const selectCommand = (command: CodingAgentAvailableCommand) => {
    const nextPrompt = slashCommandPrompt(command);
    setDismissedPrompt(nextPrompt);
    onChange(nextPrompt);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(nextPrompt.length, nextPrompt.length);
    });
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
          <PendingMessageQueue sessionId={sessionId} isStreaming={isRunning} queueService={queueService} />
        ) : null}
        {commandMenuOpen ? (
          <CodingSlashCommandMenu
            commands={matchingCommands}
            selectedName={selectedCommand?.name ?? ''}
            onSelectedNameChange={name => setCommandSelection({ query, name })}
            onSelect={selectCommand}
          />
        ) : null}
        <PromptInput
          className="input-aura rounded-3xl shadow-elevated transition-shadow **:data-[slot=input-group]:rounded-3xl"
          onSubmit={(_message, event) => {
            event.preventDefault();
            if (!disabled && !isSubmitting && prompt.trim()) onSend();
          }}
        >
          <PromptInputBody>
            <PromptInputTextarea
              ref={textareaRef}
              value={prompt}
              onChange={event => onChange(event.target.value)}
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
                if (!commandMenuOpen) return;
                if (event.key === 'Escape') {
                  event.preventDefault();
                  setDismissedPrompt(prompt);
                  return;
                }
                if (!selectedCommand) return;
                const selectedIndex = matchingCommands.indexOf(selectedCommand);
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  event.preventDefault();
                  const offset = event.key === 'ArrowDown' ? 1 : -1;
                  const nextIndex =
                    (selectedIndex + offset + matchingCommands.length) % matchingCommands.length;
                  setCommandSelection({ query, name: matchingCommands[nextIndex].name });
                  return;
                }
                if (event.key === 'Tab') {
                  event.preventDefault();
                  selectCommand(selectedCommand);
                  return;
                }
                if (event.key === 'Enter') {
                  const commandPrompt = slashCommandPrompt(selectedCommand);
                  if (!selectedCommand.input?.hint && prompt === commandPrompt) {
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
              aria-controls={commandMenuOpen ? 'coding-agent-command-menu' : undefined}
              aria-expanded={commandMenuOpen}
              disabled={disabled}
              className="max-h-48 min-h-20"
            />
          </PromptInputBody>
          <PromptInputFooter className="flex-nowrap">
            <PromptInputTools className="min-w-0 flex-1 flex-nowrap overflow-hidden">
              {leadingTools}
              {showRecipient ? (
                <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                  <Bot className="size-3.5 shrink-0" />
                  {!isTightToolbar && (
                    <span className="shrink-0">{i18nService.t('codingAgentSendTo')}</span>
                  )}
                  <span className="truncate font-medium text-foreground">{recipientName}</span>
                </div>
              ) : null}
              <CodingComposerConfigControls
                options={configOptions}
                onChange={onConfigOptionChange}
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
