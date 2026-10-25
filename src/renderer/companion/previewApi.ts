import { RELEASED_DESKTOP_PETS } from '../../shared/desktopPet/availability';
import type { DesktopPetBuiltinId } from '../../shared/desktopPet/catalog';
import {
  CompanionCapability,
  CompanionRequestState,
  CompanionUnavailableReason,
} from '../../shared/companion/constants';
import type { CompanionAttachment } from '../../shared/companion/attachments';
import type {
  CompanionMessage,
  CompanionWindowApi,
  CompanionWindowContext,
  CompanionReceipt,
} from '../../shared/companion/types';
import type { CompanionTaskProjection } from '../../shared/companion/tasks';
import { WorkbenchRunStatus } from '../../shared/workbenchTask';
import { createCompanionMemoryPreview } from './memoryPreviewApi';

/** DEV browser fixture only. It exercises the window UI, never models or production storage. */
export function createCompanionPreviewApi(
  characters: readonly DesktopPetBuiltinId[] = RELEASED_DESKTOP_PETS.map(pet => pet.id),
): CompanionWindowApi {
  const params = new URLSearchParams(typeof location === 'undefined' ? '' : location.search);
  const profiles = characters.map((id, index) => ({
    petId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    personaId: id,
    characterId: id,
    createdAt: 1,
  }));
  let active = profiles[0].petId;
  const messages = new Map<string, CompanionMessage[]>();
  const files = new Map<string, CompanionAttachment & { petId: string }>();
  const requests = new Map<string, { receipt: CompanionReceipt; text: string; at: number }>();
  const lastReplies = new Map<string, CompanionReceipt & { state: CompanionRequestState }>();
  let sequence = 0;
  const changedListeners = new Set<() => void>();
  const workbenchListeners = new Set<() => void>();
  const changed = () => {
    for (const listener of changedListeners) listener();
  };
  const tasks = new Map<string, CompanionTaskProjection[]>();
  let taskRevision = 0;
  const taskSnapshot = () => ({
    petId: active,
    revision: ++taskRevision,
    tasks: tasks.get(active) ?? [],
  });
  const workspaces =
    params.get('noWorkspace') === '1' ? [] : [{ id: 'preview-workspace', name: 'Preview project' }];
  const context: CompanionWindowContext = {
    language: params.get('language') === 'en' ? 'en' : 'zh',
    theme: params.get('theme') === 'dark' ? 'dark' : 'light',
    themeStyle: '',
  };
  const availability = {
    capability:
      params.get('offline') === '1' ? CompanionCapability.Local : CompanionCapability.Chat,
    modelId: params.get('offline') === '1' ? null : 'preview',
    imageInput: false,
    toolUse: false as const,
  };
  const snapshot = async () => ({
    context,
    activePetId: active,
    profiles,
    availability,
    shortcutAvailable: true,
    workspaces,
    tasks: tasks.get(active) ?? [],
    taskRevision: ++taskRevision,
    conversation: {
      messages: messages.get(active) ?? [],
      pending: requests.get(active)?.receipt ?? null,
      lastReply: lastReplies.get(active),
    },
  });
  return {
    visibility: async () => true,
    ...createCompanionMemoryPreview(() => active),
    bootstrap: snapshot,
    select: async id => {
      if (!profiles.some(profile => profile.petId === id)) throw new Error('Unknown companion');
      active = id;
      changed();
      return snapshot();
    },
    submit: async request => {
      if (request.petId !== active) throw new Error('Companion selection changed');
      if (availability.capability === CompanionCapability.Local)
        return { availability, receipt: null };
      if (request.attachmentIds?.length && params.get('noVision') === '1')
        return {
          availability: {
            ...availability,
            capability: CompanionCapability.Local,
            modelId: null,
            reason: CompanionUnavailableReason.ImageUnavailable,
          },
          receipt: null,
        };
      const attachments = request.attachmentIds?.map(id => {
        const file = files.get(id);
        if (!file || file.petId !== active) throw new Error('Attachment is unavailable');
        return { id, name: file.name };
      });
      const receipt = { petId: active, requestId: request.requestId, submissionId: ++sequence };
      messages.set(active, [
        ...(messages.get(active) ?? []),
        {
          id: ++sequence,
          role: 'user',
          text: request.text,
          ...(attachments?.length ? { attachments } : {}),
        },
      ]);
      requests.set(active, { receipt, text: request.text, at: Date.now() });
      lastReplies.set(active, { ...receipt, state: CompanionRequestState.Accepted });
      changed();
      return { availability, receipt };
    },
    answer: async receipt => {
      const request = requests.get(receipt.petId);
      const settled = lastReplies.get(receipt.petId);
      if (!request && settled?.submissionId === receipt.submissionId)
        return { ...settled, text: '' };
      if (request && Date.now() - request.at < 800)
        return { ...receipt, text: '', state: CompanionRequestState.Accepted };
      if (request) {
        messages.set(receipt.petId, [
          ...(messages.get(receipt.petId) ?? []),
          {
            id: ++sequence,
            role: 'assistant',
            text:
              context.language === 'zh'
                ? '先把最想解决的一件事说给我听。'
                : 'Tell me the first thing you want to work through.',
          },
        ]);
        requests.delete(receipt.petId);
        lastReplies.set(receipt.petId, { ...receipt, state: CompanionRequestState.Answered });
      }
      return { ...receipt, text: '', state: CompanionRequestState.Answered };
    },
    stop: async petId => {
      if (petId !== active) throw new Error('Companion selection changed');
      const pending = requests.get(active);
      if (pending)
        lastReplies.set(active, { ...pending.receipt, state: CompanionRequestState.Stopped });
      requests.delete(active);
      changed();
    },
    submitTask: async request => {
      if (availability.capability === CompanionCapability.Local) return { receipt: null };
      const existing = tasks
        .get(request.petId)
        ?.find(task => task.receipt.requestId === request.requestId);
      if (existing) return { receipt: existing.receipt };
      const receipt = {
        petId: request.petId,
        requestId: request.requestId,
        sessionId: crypto.randomUUID(),
        taskId: crypto.randomUUID(),
        runId: crypto.randomUUID(),
      };
      tasks.set(request.petId, [
        { receipt, title: request.text, status: WorkbenchRunStatus.Queued, missing: false },
        ...(tasks.get(request.petId) ?? []),
      ]);
      return { receipt };
    },
    tasks: async () => taskSnapshot(),
    chooseWorkspace: async () => {
      const selected = { id: 'preview-workspace', name: 'Preview project' };
      if (!workspaces.length) workspaces.push(selected);
      return selected;
    },
    chooseFiles: async petId => {
      if (petId !== active) throw new Error('Companion selection changed');
      return [{ id: crypto.randomUUID(), name: 'project-notes.md', bytes: 128 }];
    },
    stageFile: async (petId, file) => {
      if (petId !== active) throw new Error('Companion selection changed');
      const selected = { id: crypto.randomUUID(), name: file.name, bytes: file.data.byteLength };
      files.set(selected.id, { ...selected, petId });
      return selected;
    },
    stopTask: async sessionId => {
      tasks.set(
        active,
        (tasks.get(active) ?? []).map(task =>
          task.receipt.sessionId === sessionId
            ? { ...task, status: WorkbenchRunStatus.Cancelled }
            : task,
        ),
      );
    },
    hide: async () => {
      document.documentElement.dataset.companionHidden = 'true';
    },
    openWorkbench: async sessionId => {
      document.documentElement.dataset.companionWorkbench = 'true';
      if (sessionId) document.documentElement.dataset.companionTask = sessionId;
      for (const listener of workbenchListeners) listener();
    },
    onContext: () => () => {},
    onVisibility: () => () => {},
    onTasks: () => () => {},
    onChanged: listener => {
      changedListeners.add(listener);
      return () => {
        changedListeners.delete(listener);
      };
    },
    onWorkbench: listener => {
      workbenchListeners.add(listener);
      return () => {
        workbenchListeners.delete(listener);
      };
    },
  };
}
