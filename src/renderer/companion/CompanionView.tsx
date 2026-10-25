import { useCallback, useEffect, useRef, useState } from 'react';
import { FolderOpen, Paperclip } from 'lucide-react';
import { cn } from '@shared/lib/utils';
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
  PromptInputButton,
} from '@shared/components/ai-elements/prompt-input';
import type {
  CompanionWindowApi,
  CompanionWindowContext,
  CompanionWindowState,
} from '../../shared/companion/types';
import {
  COMPANION_NAME_KEYS,
  CompanionCapability,
  CompanionComposerMode,
  CompanionSurface,
  CompanionAttachmentIssue,
} from '../../shared/companion/constants';
import PageHeader from '../components/PageHeader';
import { i18nService } from '../services/i18n';
import { themeService } from '../services/theme';
import { readCompanionDraft, writeCompanionDraft } from './draft';
import { useTaskSnapshots } from './useTaskSnapshots';
import { CompanionConversation } from './CompanionConversation';
import { CompanionPortrait } from './CompanionPortrait';
import { CoworkInlineAttachments } from '../components/cowork/CoworkInlineAttachments';
import { useCompanionFiles } from './useCompanionFiles';
import { CompanionHeaderActions } from './CompanionHeaderActions';
import { createCompanionRefreshQueue } from './refreshQueue';
import { useCompanionAnswer } from './useCompanionAnswer';

function applyContext(context: CompanionWindowContext): void {
  themeService.initialize();
  i18nService.setLanguage(context.language, { persist: false });
  themeService.setStyle(context.themeStyle);
  themeService.setTheme(context.theme);
}

interface Props {
  api?: CompanionWindowApi;
  surface?: CompanionSurface;
  isSidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
}

export function CompanionView({
  api = window.companion,
  surface = CompanionSurface.Quick,
  isSidebarCollapsed,
  onToggleSidebar,
}: Props = {}) {
  const [state, setState] = useState<CompanionWindowState | null>(null);
  const { remember: rememberTasks, update: updateTasks } = useTaskSnapshots(setState);
  const [draft, setDraft] = useState<ReturnType<typeof readCompanionDraft>>(() => ({
    text: '',
    requestId: crypto.randomUUID(),
  }));
  const [sending, setSending] = useState(false);
  const [choosingWorkspace, setChoosingWorkspace] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [visible, setVisible] = useState(true);
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null);
  const [, languageChanged] = useState(0);
  const revision = useRef(0);
  const activeId = useRef<string | null>(null);
  const draftRef = useRef(draft);
  const visibleRef = useRef(true);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const t = (key: string) => i18nService.t(key);
  const taskMode = draft.mode === CompanionComposerMode.Task;
  const cancelPendingLoad = useCallback(() => {
    revision.current++;
  }, []);
  const replaceDraft = useCallback(
    (next: ReturnType<typeof readCompanionDraft>, petId?: string) => {
      draftRef.current = next;
      if (petId) writeCompanionDraft(petId, next, surface);
      setDraft(next);
    },
    [surface],
  );
  const load = useCallback(
    async (petId?: string) => {
      const current = ++revision.current;
      if (!api) {
        setError('companionLoadFailed');
        return;
      }
      try {
        const next = petId ? await api.select(petId) : await api.bootstrap();
        if (revision.current !== current) return;
        if (surface === CompanionSurface.Quick) applyContext(next.context);
        if (activeId.current !== next.activePetId) {
          activeId.current = next.activePetId;
          replaceDraft(readCompanionDraft(next.activePetId, surface));
        }
        const snapshot = rememberTasks({
          petId: next.activePetId,
          revision: next.taskRevision,
          tasks: next.tasks,
        });
        setState({ ...next, tasks: snapshot.tasks, taskRevision: snapshot.revision });
        setError(null);
      } catch {
        if (revision.current === current) setError('companionLoadFailed');
      }
    },
    [api, surface, replaceDraft, rememberTasks],
  );

  useEffect(() => {
    const refresh = createCompanionRefreshQueue(() => load());
    void refresh.request();
    const unsubscribeLanguage = i18nService.subscribe(() => languageChanged(value => value + 1));
    const unsubscribeContext =
      surface === CompanionSurface.Quick ? api?.onContext(applyContext) : undefined;
    const unsubscribeChanged = api?.onChanged(() => {
      if (visibleRef.current) void refresh.request();
    });
    const unsubscribeVisibility = api?.onVisibility(next => {
      visibleRef.current = next;
      setVisible(next);
      if (next) {
        void refresh.request();
        textarea.current?.focus();
      }
    });
    const unsubscribeTasks = api?.onTasks(updateTasks);
    const keydown = (event: KeyboardEvent) => {
      if (
        surface === CompanionSurface.Quick &&
        event.key === 'Escape' &&
        !event.isComposing &&
        !event.defaultPrevented
      ) {
        event.preventDefault();
        void api?.hide();
      }
    };
    document.addEventListener('keydown', keydown);
    return () => {
      refresh.dispose();
      cancelPendingLoad();
      unsubscribeLanguage();
      unsubscribeContext?.();
      unsubscribeChanged?.();
      unsubscribeVisibility?.();
      unsubscribeTasks?.();
      document.removeEventListener('keydown', keydown);
    };
  }, [api, surface, load, cancelPendingLoad, updateTasks]);

  const pending = state?.conversation.pending;
  useEffect(() => {
    if (state?.activePetId && visible) textarea.current?.focus();
  }, [state?.activePetId, visible]);
  useCompanionAnswer({ api, pending, visible, reload: load, onError: setError });

  const updateDraft = (text: string, patch: Partial<typeof draft> = {}) => {
    const next = { ...draftRef.current, ...patch, text, requestId: crypto.randomUUID() };
    replaceDraft(next, activeId.current ?? undefined);
  };
  const { choosingFiles, chooseFiles } = useCompanionFiles({
    api,
    disabled: !state || sending || choosingWorkspace,
    activePetId: () => activeId.current,
    attachments: () => draftRef.current.attachments ?? [],
    onChange: attachments => updateDraft(draftRef.current.text, { attachments }),
    onError: setError,
    onFocus: () => textarea.current?.focus(),
  });

  const submit = async () => {
    if (taskMode && (choosingWorkspace || choosingFiles)) return;
    if (!state || !draft.text.trim() || sending || (!taskMode && pending) || !api) return;
    const sent = draftRef.current;
    const petId = state.activePetId;
    setSending(true);
    setError(null);
    const acknowledgeDraft = () => {
      const current =
        activeId.current === petId ? draftRef.current : readCompanionDraft(petId, surface);
      if (current.requestId !== sent.requestId) return;
      const next = {
        ...current,
        text: '',
        requestId: crypto.randomUUID(),
        attachments: taskMode ? [] : current.attachments,
      };
      if (activeId.current === petId) replaceDraft(next, petId);
      else writeCompanionDraft(petId, next, surface);
    };
    try {
      if (taskMode) {
        if (!sent.workspaceId) {
          setError('companionChooseWorkspace');
          return;
        }
        const result = await api.submitTask({
          petId,
          requestId: sent.requestId,
          text: sent.text,
          workspaceId: sent.workspaceId,
          attachmentIds: sent.attachments?.map(file => file.id),
        });
        if (!result.receipt) {
          if (activeId.current === petId) setError('companionNoModel');
          return;
        }
        acknowledgeDraft();
        updateTasks(await api.tasks());
        return;
      }
      const result = await api.submit({ petId, requestId: sent.requestId, text: sent.text });
      if (activeId.current === petId)
        setState(current => current && { ...current, availability: result.availability });
      if (!result.receipt) {
        if (activeId.current === petId) setError('companionNoModel');
        return;
      }
      acknowledgeDraft();
      await load();
    } catch (failure) {
      await load();
      if (activeId.current === petId)
        setError(
          taskMode &&
            failure instanceof Error &&
            failure.message.includes(CompanionAttachmentIssue.Unavailable)
            ? 'companionFileUnavailable'
            : taskMode
              ? 'companionTaskSubmitFailed'
              : 'companionFailed',
        );
    } finally {
      setSending(false);
    }
  };

  const stop = async () => {
    try {
      if (state) await api?.stop(state.activePetId);
      await load();
    } catch {
      setError('companionFailed');
    }
  };

  const chooseWorkspace = async () => {
    if (!state || sending || choosingWorkspace || !api) return;
    const petId = state.activePetId;
    setChoosingWorkspace(true);
    try {
      const workspace = await api.chooseWorkspace();
      if (!workspace) return;
      setState(
        current =>
          current && {
            ...current,
            workspaces: [...current.workspaces.filter(item => item.id !== workspace.id), workspace],
          },
      );
      if (activeId.current !== petId) return;
      replaceDraft(
        { ...draftRef.current, workspaceId: workspace.id, requestId: crypto.randomUUID() },
        petId,
      );
      setError(null);
      textarea.current?.focus();
    } catch {
      if (activeId.current === petId) setError('companionPickFolderFailed');
    } finally {
      setChoosingWorkspace(false);
    }
  };

  return (
    <main
      ref={setPortalContainer}
      className={cn(
        'flex min-h-0 flex-col',
        surface === CompanionSurface.Home ? 'h-full' : 'h-dvh',
      )}
    >
      <PageHeader
        title={t('companionTitle')}
        windowControls={surface === CompanionSurface.Home ? undefined : null}
        isSidebarCollapsed={isSidebarCollapsed}
        onToggleSidebar={onToggleSidebar}
        actions={
          <CompanionHeaderActions
            api={api}
            surface={surface}
            visible={visible}
            profile={state?.profiles.find(profile => profile.petId === state.activePetId)}
          />
        }
      />
      <div className="mx-auto flex w-full min-h-0 max-w-3xl flex-1 flex-col">
        <div className="flex shrink-0 items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            {state ? (
              <CompanionPortrait
                characterId={
                  state.profiles.find(profile => profile.petId === state.activePetId)!.characterId
                }
                label={t(
                  COMPANION_NAME_KEYS[
                    state.profiles.find(profile => profile.petId === state.activePetId)!.personaId
                  ],
                )}
              />
            ) : null}
            <Select
              value={state?.activePetId ?? ''}
              disabled={!state || sending || choosingWorkspace || choosingFiles || Boolean(pending)}
              onValueChange={id => {
                if (id) void load(id);
              }}
            >
              <SelectTrigger className="w-44" aria-label={t('companionChoose')}>
                <SelectValue>
                  {state
                    ? t(
                        COMPANION_NAME_KEYS[
                          state.profiles.find(profile => profile.petId === state.activePetId)!
                            .personaId
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
          </div>
          <span className="theme-home-caption">
            {t(
              state?.availability.capability === CompanionCapability.Chat
                ? 'companionChatReady'
                : 'companionLocalOnly',
            )}
          </span>
        </div>
        <CompanionConversation
          state={state}
          taskMode={taskMode}
          openTask={sessionId =>
            void api?.openWorkbench(sessionId).catch(() => setError('companionTaskOpenFailed'))
          }
          stopTask={async sessionId => {
            try {
              await api!.stopTask(sessionId);
              updateTasks(await api!.tasks());
            } catch {
              setError('companionTaskStopFailed');
            }
          }}
        />
        <div className="flex min-h-0 shrink flex-col gap-3 overflow-y-auto px-4 pb-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <FluidTabs
              disabled={!state || sending || choosingWorkspace || choosingFiles}
              aria-label={t('companionInputMode')}
              value={taskMode ? CompanionComposerMode.Task : CompanionComposerMode.Chat}
              onValueChange={mode => updateDraft(draftRef.current.text, { mode })}
              items={[
                { value: CompanionComposerMode.Chat, label: t('companionModeChat') },
                { value: CompanionComposerMode.Task, label: t('companionModeTask') },
              ]}
            />
            {taskMode ? (
              <div className="flex items-center gap-2">
                <Select
                  value={draft.workspaceId ?? ''}
                  disabled={!state || sending || choosingWorkspace || choosingFiles}
                  onValueChange={id => {
                    if (id) updateDraft(draftRef.current.text, { workspaceId: id });
                  }}
                >
                  <SelectTrigger className="w-44" aria-label={t('companionWorkspace')}>
                    <SelectValue>
                      {state?.workspaces.find(workspace => workspace.id === draft.workspaceId)
                        ?.name ?? t('companionChooseWorkspace')}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent
                    listLabel={t('companionWorkspace')}
                    portalContainer={portalContainer}
                  >
                    {state?.workspaces.map(workspace => (
                      <SelectItem key={workspace.id} value={workspace.id}>
                        {workspace.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('companionPickFolder')}
                  disabled={!state || sending || choosingWorkspace || choosingFiles}
                  onClick={() => void chooseWorkspace()}
                >
                  <FolderOpen />
                </Button>
              </div>
            ) : null}
          </div>
          {error ? (
            <div role="alert" className="flex items-center justify-between gap-3">
              <span className="theme-home-caption">{t(error)}</span>
              {!error.startsWith('companionFile') ? (
                <Button variant="ghost" size="sm" onClick={() => void load()}>
                  {t('companionRefresh')}
                </Button>
              ) : null}
            </div>
          ) : null}
          {state && !state.shortcutAvailable ? (
            <p className="theme-home-caption">{t('companionShortcutUnavailable')}</p>
          ) : null}
          {taskMode && draft.attachments?.length ? (
            <CoworkInlineAttachments
              className="max-h-16 flex-wrap overflow-y-auto"
              attachments={draft.attachments.map(file => ({ path: file.id, name: file.name }))}
              onRemove={id =>
                updateDraft(draftRef.current.text, {
                  attachments: draftRef.current.attachments?.filter(file => file.id !== id),
                })
              }
            />
          ) : null}
          <PromptInput
            onSubmit={submit}
            maxFiles={0}
            onError={() =>
              setError(taskMode ? 'companionFilesUsePicker' : 'companionAttachmentsWorkbench')
            }
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
              {taskMode ? (
                <PromptInputButton
                  aria-label={t('companionAddFiles')}
                  tooltip={t('companionAddFiles')}
                  disabled={!state || sending || choosingWorkspace || choosingFiles}
                  onClick={() => void chooseFiles()}
                >
                  <Paperclip />
                </PromptInputButton>
              ) : (
                <span />
              )}
              <PromptInputSubmit
                status={pending && !taskMode ? 'streaming' : 'ready'}
                disabled={
                  !state ||
                  sending ||
                  (taskMode && (choosingWorkspace || choosingFiles)) ||
                  ((!pending || taskMode) && !draft.text.trim())
                }
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
      </div>
    </main>
  );
}
