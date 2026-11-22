import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { expect, test, vi } from 'vitest';
import { CompanionRequestState } from '../../shared/companion/constants';
import { DesktopPetBuiltinId } from '../../shared/desktopPet/catalog';
import { piCompanionChatSessionId, type PiRuntime } from '../libs/agentEngine/piRuntimeTypes';
import { ActivityService } from '../activity/activityService';
import { CodingRoomRepository } from '../codingAgent/codingRoomRepository';
import { SqliteScheduledTaskStore } from '../../scheduledTask/sqliteScheduledTaskStore';
import { recoverInterruptedWork } from '../appBootstrap/recoverInterruptedWork';
import { SqliteStore } from '../sqliteStore';
import { WorkbenchTaskService } from '../workbenchTask/taskService';
import type { MagpieModelService } from '../magpie/modelService';
import { CompanionChat, type CompanionActivity } from './chat';
import { initializeCompanionSchema } from './schema';

vi.mock('electron', () => ({
  app: { getAppPath: () => process.cwd(), getPath: () => os.tmpdir() },
}));

function fixture() {
  const profile = {
    petId: randomUUID(),
    personaId: DesktopPetBuiltinId.Xiaoyuan,
    characterId: DesktopPetBuiltinId.Xiaoyuan,
    createdAt: 1,
  };
  const models = {
    resolveAutomatic: vi.fn<MagpieModelService['resolveAutomatic']>(async () => ({
      modelId: 'test/vision',
      imageInput: true,
    })),
  };
  const runtime = {
    continueSession: vi.fn<PiRuntime['continueSession']>(async () => {}),
    stopSession: vi.fn<PiRuntime['stopSession']>(),
  };
  return { profile, models, runtime };
}

test('persists admitted turns, deduplicates retries, and leaves unfinished replies interrupted on reopen', async () => {
  const { profile, models, runtime } = fixture();
  const root = mkdtempSync(path.join(os.tmpdir(), 'companion-chat-'));
  let db = (await SqliteStore.create(root)).getDatabase();
  try {
    const chat = new CompanionChat(db, models, runtime);
    const activity = vi.fn((_event: CompanionActivity) => chat.history(profile).lastReply?.state);
    chat.onActivity(activity);
    const first = (await chat.submit(profile, 'first', 'Ask a question')).receipt!;
    expect(runtime.continueSession).toHaveBeenCalledWith(
      piCompanionChatSessionId(profile.petId),
      'Ask a question',
      expect.objectContaining({ companionChat: true, modelOverride: 'test/vision' }),
    );
    expect(chat.history(profile).pending).toEqual(first);
    expect((await chat.submit(profile, 'first', 'Retry')).receipt).toEqual(first);
    await expect(chat.submit(profile, 'busy', 'Another question')).rejects.toThrow('unfinished');
    runtime.continueSession.mock.calls[0][2]?.onSettled?.({ ok: true, output: 'The answer' });
    expect(activity.mock.calls.map(([item]) => item.state)).toEqual([
      CompanionRequestState.Accepted,
      CompanionRequestState.Answered,
    ]);
    expect(activity.mock.results.map(result => result.value)).toEqual([
      CompanionRequestState.Accepted,
      CompanionRequestState.Answered,
    ]);
    const unfinished = (await chat.submit(profile, 'unfinished', 'Second question')).receipt!;
    db.close();
    db = (await SqliteStore.create(root)).getDatabase();
    expect(
      recoverInterruptedWork(
        db,
        new WorkbenchTaskService(db),
        new SqliteScheduledTaskStore(db),
        new ActivityService(db),
        new CodingRoomRepository(db),
      ),
    ).toEqual({
      runs: 0,
      companionReplies: 1,
      scheduledRuns: 0,
      activityRuns: 0,
      prunedActivity: 0,
      codingLanes: 0,
    });

    const reopened = new CompanionChat(db, models, runtime);
    expect(reopened.history(profile)).toMatchObject({
      pending: null,
      lastReply: { ...unfinished, state: CompanionRequestState.Unanswered },
      messages: [
        { role: 'user', text: 'Ask a question' },
        { role: 'assistant', text: 'The answer' },
        { role: 'user', text: 'Second question' },
      ],
    });
    expect((await reopened.submit(profile, 'unfinished', 'Lost receipt retry')).receipt).toEqual(
      unfinished,
    );
    const other = { ...profile, petId: randomUUID() };
    expect(reopened.history(other).messages).toEqual([]);
    expect(runtime.continueSession).toHaveBeenCalledTimes(2);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('keeps explicit stop distinct from late provider settlement and quit', async () => {
  const { profile, models, runtime } = fixture();
  const db = new Database(':memory:');
  initializeCompanionSchema(db);
  try {
    const chat = new CompanionChat(db, models, runtime);
    const receipt = (await chat.submit(profile, 'stop', 'Wait')).receipt!;
    chat.stop(profile);
    expect(runtime.stopSession).toHaveBeenCalledWith(piCompanionChatSessionId(profile.petId), {
      companionChat: true,
    });
    runtime.continueSession.mock.calls[0][2]?.onSettled?.({ ok: true, output: 'Late answer' });
    expect(chat.history(profile)).toMatchObject({
      lastReply: { ...receipt, state: CompanionRequestState.Stopped },
      messages: [{ role: 'user', text: 'Wait' }],
    });

    const next = (await chat.submit(profile, 'quit', 'Wait again')).receipt!;
    chat.interrupt();
    runtime.continueSession.mock.calls[1][2]?.onSettled?.({ ok: false, error: 'App quit' });
    expect(chat.history(profile)).toMatchObject({
      lastReply: { ...next, state: CompanionRequestState.Unanswered },
      messages: [
        { role: 'user', text: 'Wait' },
        { role: 'user', text: 'Wait again' },
      ],
    });
  } finally {
    db.close();
  }
});

test('constructing a chat consumer preserves a reply admitted in the current process', async () => {
  const { profile, models, runtime } = fixture();
  const db = new Database(':memory:');
  initializeCompanionSchema(db);
  try {
    const chat = new CompanionChat(db, models, runtime);
    const receipt = (await chat.submit(profile, 'live', 'Wait for a response')).receipt!;
    const consumer = new CompanionChat(db, models, runtime);

    expect(consumer.history(profile).pending).toEqual(receipt);
    runtime.continueSession.mock.calls[0][2]?.onSettled?.({ ok: true, output: 'The answer' });
    expect(consumer.history(profile)).toMatchObject({
      lastReply: { ...receipt, state: CompanionRequestState.Answered },
      messages: [
        { role: 'user', text: 'Wait for a response' },
        { role: 'assistant', text: 'The answer' },
      ],
    });
    expect(runtime.continueSession).toHaveBeenCalledOnce();
  } finally {
    db.close();
  }
});

test('keeps unaccepted drafts out of history and forwards only resolved image inputs to Pi', async () => {
  const { profile, models, runtime } = fixture();
  const db = new Database(':memory:');
  initializeCompanionSchema(db);
  try {
    const chat = new CompanionChat(db, models, runtime);
    const id = randomUUID();
    const imageInput = {
      ids: [id],
      resolve: vi.fn(async () => [
        { id, name: 'photo.png', mimeType: 'image/png' as const, data: 'cGl4ZWxz' },
      ]),
    };
    models.resolveAutomatic.mockResolvedValueOnce(null);
    expect((await chat.submit(profile, 'image', '', imageInput)).receipt).toBeNull();
    expect(imageInput.resolve).not.toHaveBeenCalled();
    expect(chat.history(profile).messages).toEqual([]);

    expect((await chat.submit(profile, 'image', '', imageInput)).receipt).toBeTruthy();
    expect(models.resolveAutomatic).toHaveBeenLastCalledWith(new Set(), { imageInput: true });
    expect(runtime.continueSession.mock.calls[0][2]?.imageAttachments).toEqual([
      { name: 'photo.png', mimeType: 'image/png', base64Data: 'cGl4ZWxz' },
    ]);
    expect(chat.history(profile).messages[0]).toMatchObject({
      attachments: [{ id, name: 'photo.png' }],
    });
    chat.stop(profile);
    models.resolveAutomatic.mockResolvedValueOnce({
      modelId: 'test/text',
      imageInput: false,
    });
    expect((await chat.submit(profile, 'text', 'Ask without a photo')).receipt).toBeTruthy();
    expect(models.resolveAutomatic).toHaveBeenLastCalledWith(new Set(), { imageInput: false });
  } finally {
    db.close();
  }
});
