import { useCallback, useEffect, useRef, useState } from 'react';
import { X, PanelLeft, Square } from 'lucide-react';
import { WorkbenchRunStatus } from '../../shared/workbenchTask';
import { Button } from '@shared/components/ui/button';
import { FluidTabs } from '@shared/components/ui/fluid-tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shared/components/ui/select';
import {
  PromptInput,
  PromptInputFooter,
  PromptInputTextarea,
  PromptInputSubmit,
} from '@shared/components/ai-elements/prompt-input';
import { Conversation, ConversationContent } from '@shared/components/ai-elements/conversation';
import { Message, MessageContent, MessageResponse } from '@shared/components/ai-elements/message';
import type { CompanionWindowContext, CompanionWindowState } from '../../shared/companion/types';
import {
  COMPANION_NAME_KEYS,
  CompanionCapability,
  CompanionRequestState,
  CompanionComposerMode,
} from '../../shared/companion/constants';
import PageHeader from '../components/PageHeader';
import { i18nService } from '../services/i18n';
import { themeService } from '../services/theme';
import { readCompanionDraft, writeCompanionDraft } from './draft';

function applyContext(context: CompanionWindowContext): void {
  i18nService.setLanguage(context.language, { persist: false });
  themeService.setStyle(context.themeStyle);
  themeService.setTheme(context.theme);
}

export function CompanionView() {
  const [state, setState] = useState<CompanionWindowState | null>(null);
  const [draft, setDraft] = useState<ReturnType<typeof readCompanionDraft>>({
    text: '',
    requestId: crypto.randomUUID(),
  });
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [visible, setVisible] = useState(true);
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null);
  const [, languageChanged] = useState(0);
  const revision = useRef(0);
  const activeId = useRef<string | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const t = (key: string) => i18nService.t(key);
  const taskMode = draft.mode === CompanionComposerMode.Task;
  const cancelPendingLoad = useCallback(() => {
    revision.current++;
  }, []);
  const load = useCallback(async (petId?: string) => {
    const current = ++revision.current;
    const api = window.companion;
    if (!api) {
      setError('companionLoadFailed');
      return;
    }
    try {
      const next = petId ? await api.select(petId) : await api.bootstrap();
      if (revision.current !== current) return;
      applyContext(next.context);
      if (activeId.current !== next.activePetId) {
        activeId.current = next.activePetId;
        setDraft(readCompanionDraft(next.activePetId));
      }
      setState(next);
      setError(null);
    } catch {
      if (revision.current === current) setError('companionLoadFailed');
    }
  }, []);

  useEffect(() => {
    void load();
    const unsubscribeLanguage = i18nService.subscribe(() => languageChanged(value => value + 1));
    const unsubscribeContext = window.companion?.onContext(applyContext);
    const unsubscribeVisibility = window.companion?.onVisibility(next => {
      setVisible(next);
      if (next) textarea.current?.focus();
    });
    const unsubscribeTasks = window.companion?.onTasks((petId, tasks) => {
      setState(current =>
        current && current.activePetId === petId ? { ...current, tasks } : current,
      );
    });
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.isComposing && !event.defaultPrevented) {
        event.preventDefault();
        void window.companion?.hide();
      }
    };
    document.addEventListener('keydown', keydown);
    return () => {
      cancelPendingLoad();
      unsubscribeLanguage();
      unsubscribeContext?.();
      unsubscribeVisibility?.();
      unsubscribeTasks?.();
      document.removeEventListener('keydown', keydown);
    };
  }, [load, cancelPendingLoad]);

  const pending = state?.conversation.pending;
  useEffect(() => {
    if (state?.activePetId && visible) textarea.current?.focus();
  }, [state?.activePetId, visible]);
  useEffect(() => {
    if (!pending || !visible) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const check = async () => {
      try {
        const answer = await window.companion!.answer(pending);
        if (!active) return;
        if (answer.state !== CompanionRequestState.Accepted) {
          await load();
          if (active && answer.state === CompanionRequestState.Unanswered)
            setError('companionFailed');
          return;
        }
      } catch {
        if (active) {
          setError('companionLoadFailed');
          return;
        }
      }
      if (active) timer = setTimeout(check, 500);
    };
    void check();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [pending, visible, load]);

  const updateDraft = (text: string, patch: Partial<typeof draft> = {}) => {
    const next = { ...draft, ...patch, text, requestId: crypto.randomUUID() };
    setDraft(next);
    if (activeId.current) writeCompanionDraft(activeId.current, next);
  };

  const submit = async () => {
    if (!state || !draft.text.trim() || sending || (!taskMode && pending) || !window.companion)
      return;
    const sent = draft;
    const petId = state.activePetId;
    setSending(true);
    setError(null);
    try {
      if (taskMode) {
        if (!sent.workspaceId) {
          setError('companionChooseWorkspace');
          return;
        }
        const result = await window.companion.submitTask({
          petId,
          requestId: sent.requestId,
          text: sent.text,
          workspaceId: sent.workspaceId,
        });
        if (!result.receipt) {
          setError('companionNoModel');
          return;
        }
        setDraft(current => {
          if (current.requestId !== sent.requestId) return current;
          const next = { ...current, text: '', requestId: crypto.randomUUID() };
          writeCompanionDraft(petId, next);
          return next;
        });
        const tasks = await window.companion.tasks();
        setState(current =>
          current && current.activePetId === petId ? { ...current, tasks } : current,
        );
        return;
      }
      const result = await window.companion.submit({ requestId: sent.requestId, text: sent.text });
      setState(current => current && { ...current, availability: result.availability });
      if (!result.receipt) {
        setError('companionNoModel');
        return;
      }
      setDraft(current => {
        if (current.requestId !== sent.requestId) return current;
        const next = { ...current, text: '', requestId: crypto.randomUUID() };
        writeCompanionDraft(petId, next);
        return next;
      });
      setState(
        current =>
          current && {
            ...current,
            availability: result.availability,
            conversation: {
              messages: [
                ...current.conversation.messages,
                { id: -result.receipt!.submissionId, role: 'user', text: sent.text },
              ],
              pending: result.receipt,
            },
          },
      );
    } catch {
      setError(taskMode ? 'companionTaskSubmitFailed' : 'companionFailed');
      void load();
    } finally {
      setSending(false);
    }
  };

  const stop = async () => {
    try {
      await window.companion?.stop();
      await load();
    } catch {
      setError('companionFailed');
    }
  };

  return (
    <main ref={setPortalContainer} className="flex h-dvh min-h-0 flex-col">
      <PageHeader
        title={t('companionTitle')}
        windowControls={null}
        actions={
          <>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t('companionWorkbench')}
              onClick={() => void window.companion?.openWorkbench()}
            >
              <PanelLeft />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t('companionHide')}
              onClick={() => void window.companion?.hide()}
            >
              <X />
            </Button>
          </>
        }
      />
      <div className="flex shrink-0 items-center justify-between gap-3 px-4 py-3">
        <Select
          value={state?.activePetId ?? ''}
          disabled={!state || sending || Boolean(pending)}
          onValueChange={id => {
            if (id) void load(id);
          }}
        >
          <SelectTrigger className="w-44" aria-label={t('companionChoose')}>
            <SelectValue>
              {state
                ? t(
                    COMPANION_NAME_KEYS[
                      state.profiles.find(profile => profile.petId === state.activePetId)!.personaId
                    ],
                  )
                : t('companionChoose')}
            </SelectValue>
          </SelectTrigger>
          <SelectContent listLabel={t('companionChoose')} portalContainer={portalContainer}>
            {state?.profiles.map(profile => (
              <SelectItem key={profile.petId} value={profile.petId}>
                {t(COMPANION_NAME_KEYS[profile.personaId])}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="theme-home-caption">
          {t(
            state?.availability.capability === CompanionCapability.Chat
              ? 'companionChatReady'
              : 'companionLocalOnly',
          )}
        </span>
      </div>
      <Conversation className="flex min-h-0 flex-1 flex-col">
        <ConversationContent className="flex flex-col gap-4 px-4">
          {taskMode ? (
            state?.tasks.length ? (
              state.tasks.map(task => (
                <div key={task.receipt.taskId} className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    className="min-w-0 flex-1 justify-between gap-3"
                    disabled={task.missing}
                    onClick={() =>
                      void window.companion
                        ?.openWorkbench(task.receipt.sessionId)
                        .catch(() => setError('companionTaskOpenFailed'))
                    }
                  >
                    <span className="min-w-0 truncate">
                      {task.title || t('companionTaskMissing')}
                    </span>
                    <span className="theme-home-caption shrink-0">
                      {t(
                        task.missing
                          ? 'companionTaskMissing'
                          : `companionTaskStatus_${task.status}`,
                      )}
                    </span>
                  </Button>
                  {!task.missing &&
                  (
                    [
                      WorkbenchRunStatus.Queued,
                      WorkbenchRunStatus.Running,
                      WorkbenchRunStatus.WaitingApproval,
                      WorkbenchRunStatus.Verifying,
                    ] as readonly WorkbenchRunStatus[]
                  ).includes(task.status) ? (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t('companionTaskStop')}
                      onClick={async () => {
                        try {
                          await window.companion!.stopTask(task.receipt.sessionId);
                          const tasks = await window.companion!.tasks();
                          setState(current =>
                            current?.activePetId === task.receipt.petId
                              ? { ...current, tasks }
                              : current,
                          );
                        } catch {
                          setError('companionTaskStopFailed');
                        }
                      }}
                    >
                      <Square />
                    </Button>
                  ) : null}
                </div>
              ))
            ) : (
              <div className="flex flex-1 items-center justify-center">
                <p className="theme-home-caption">{t('companionTaskEmpty')}</p>
              </div>
            )
          ) : state?.conversation.messages.length ? (
            state.conversation.messages.map(message => (
              <Message key={`${message.id}-${message.role}`} from={message.role}>
                <MessageContent>
                  <MessageResponse>{message.text}</MessageResponse>
                </MessageContent>
              </Message>
            ))
          ) : (
            <div className="flex flex-1 items-center justify-center">
              <p className="theme-home-caption">{t('companionEmpty')}</p>
            </div>
          )}
          {pending && !taskMode ? (
            <p role="status" className="theme-home-caption">
              {t('companionWorking')}
            </p>
          ) : null}
        </ConversationContent>
      </Conversation>
      <div className="flex shrink-0 flex-col gap-3 px-4 pb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <FluidTabs
            disabled={sending}
            aria-label={t('companionInputMode')}
            value={taskMode ? CompanionComposerMode.Task : CompanionComposerMode.Chat}
            onValueChange={mode => updateDraft(draft.text, { mode })}
            items={[
              { value: CompanionComposerMode.Chat, label: t('companionModeChat') },
              { value: CompanionComposerMode.Task, label: t('companionModeTask') },
            ]}
          />
          {taskMode ? (
            <Select
              value={draft.workspaceId ?? ''}
              disabled={!state || sending}
              onValueChange={id => {
                if (id) updateDraft(draft.text, { workspaceId: id });
              }}
            >
              <SelectTrigger className="w-44" aria-label={t('companionWorkspace')}>
                <SelectValue>
                  {state?.workspaces.find(workspace => workspace.id === draft.workspaceId)?.name ??
                    t('companionChooseWorkspace')}
                </SelectValue>
              </SelectTrigger>
              <SelectContent listLabel={t('companionWorkspace')} portalContainer={portalContainer}>
                {state?.workspaces.map(workspace => (
                  <SelectItem key={workspace.id} value={workspace.id}>
                    {workspace.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
        </div>
        {error ? (
          <div role="alert" className="flex items-center justify-between gap-3">
            <span className="theme-home-caption">{t(error)}</span>
            <Button variant="ghost" size="sm" onClick={() => void load()}>
              {t('companionRefresh')}
            </Button>
          </div>
        ) : null}
        {state && !state.shortcutAvailable ? (
          <p className="theme-home-caption">{t('companionShortcutUnavailable')}</p>
        ) : null}
        <PromptInput
          onSubmit={submit}
          maxFiles={0}
          onError={() => setError('companionAttachmentsWorkbench')}
        >
          <PromptInputTextarea
            ref={textarea}
            value={draft.text}
            onChange={event => updateDraft(event.target.value)}
            placeholder={t(taskMode ? 'companionTaskPlaceholder' : 'companionPlaceholder')}
            aria-label={t(taskMode ? 'companionTaskPlaceholder' : 'companionPlaceholder')}
            maxLength={32_000}
            disabled={!state}
            autoFocus
          />
          <PromptInputFooter>
            <span />
            <PromptInputSubmit
              status={pending && !taskMode ? 'streaming' : 'ready'}
              disabled={!state || sending || ((!pending || taskMode) && !draft.text.trim())}
              onStop={() => void stop()}
              aria-label={t(
                pending && !taskMode
                  ? 'companionStop'
                  : taskMode
                    ? 'companionTaskSend'
                    : 'companionSend',
              )}
            />
          </PromptInputFooter>
        </PromptInput>
      </div>
    </main>
  );
}
