import { expect } from '@playwright/test';
import path from 'node:path';
import {
  MemoryKind,
  MemoryLifecycleStatus,
  MemorySensitivity,
  MemorySourceKind,
} from '../../src/shared/memory/constants.ts';
import { AtomicMemorySourceKind } from '../../src/main/memory/constants.ts';
import { CompanionRequestState } from '../../src/shared/companion/constants.ts';

const marker = 'native-review-archive-folders';
const title = '项目资料归档';
const fact = `项目资料按合同、发票和会议三个目录归档。${marker}`;

export function createMemoryReviewFixture() {
  return {
    answer: fact,
    inspect: payload =>
      JSON.stringify(payload.messages?.find(message => message.role === 'system')).includes(marker),
    extract(payload) {
      const source = JSON.parse(
        payload.messages.findLast(message => message.role === 'user').content,
      ).evidenceSources.find(source => source.kind === AtomicMemorySourceKind.FinalAnswer);
      if (!source?.content.includes(marker)) throw new Error('Review fixture evidence is missing.');
      return {
        shouldSave: true,
        memories: [
          {
            title,
            content: fact,
            kind: MemoryKind.Decision,
            importance: 0.7,
            confidence: 0.9,
            sensitivity: MemorySensitivity.Normal,
            evidenceSourceIds: [source.id],
          },
        ],
      };
    },
  };
}

/** Real task extraction creates the candidate; both windows review the same projection. */
export async function verifyMemoryReview(application, main, chat, userData, requests) {
  const state = await chat.evaluate(() => window.companion.bootstrap());
  const a = state.activePetId;
  const b = state.profiles.find(profile => profile.petId !== a).petId;
  await expect
    .poll(
      async () =>
        (await chat.evaluate(petId => window.companion.listMemories(petId), a)).some(
          record => record.sourceKind === MemorySourceKind.TaskVerifier,
        ),
      { timeout: 30_000 },
    )
    .toBe(true);
  const ask = async expected => {
    const receipt = await chat.evaluate(async () => {
      const api = window.companion;
      return (
        await api.submit({
          petId: (await api.bootstrap()).activePetId,
          requestId: crypto.randomUUID(),
          text: 'Native shared conversation: 项目资料归档',
        })
      ).receipt;
    });
    expect(receipt).not.toBeNull();
    await expect
      .poll(
        async () =>
          (await chat.evaluate(receipt => window.companion.answer(receipt), receipt)).state,
        { timeout: 30_000 },
      )
      .toBe(CompanionRequestState.Answered);
    expect(requests.filter(request => request.kind === 'companion-chat').at(-1).reviewMemory).toBe(
      expected,
    );
  };
  await ask(false);
  await main.getByTestId('sidebar-view-companion').click();
  await main.getByRole('button', { name: '记忆', exact: true }).click();
  await expect(main.getByRole('dialog').getByText('待确认', { exact: true })).toBeVisible();
  await chat.getByRole('button', { name: '记忆', exact: true }).click();
  const dialog = chat.getByRole('dialog');
  await dialog.getByRole('button', { name: `查看: ${title}` }).click();
  await expect(dialog.getByRole('region')).toContainText(fact);
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  let [candidate] = await chat.evaluate(petId => window.companion.listMemories(petId), a);
  expect(candidate.status).toBe(MemoryLifecycleStatus.NeedsReview);
  expect(candidate.deliveryStatus).toBeNull();
  await dialog.getByRole('button', { name: `查看: ${title}` }).click();
  await application.evaluate(({ BrowserWindow }, url) => {
    const window = BrowserWindow.getAllWindows().find(
      window => window.webContents.getURL() === url,
    );
    window.show();
    window.focus();
  }, chat.url());
  await chat.bringToFront();
  await chat.screenshot({ path: path.join(userData, 'memory-review-native.png') });
  await dialog.getByRole('button', { name: '记住', exact: true }).click();
  await expect(dialog.getByRole('status')).toHaveText('已记住');
  await expect(main.getByRole('dialog').getByText('待确认', { exact: true })).toHaveCount(0);
  await expect(
    main.getByRole('dialog').getByRole('button', { name: `编辑记忆: ${title}` }),
  ).toBeEnabled();
  [candidate] = await chat.evaluate(petId => window.companion.listMemories(petId), a);
  expect(candidate.status).toBe(MemoryLifecycleStatus.Active);
  expect(candidate.memoryId).not.toBeNull();
  expect((await main.evaluate(() => window.electron.memory.list({}))).data).toEqual([]);
  await chat.keyboard.press('Escape');
  await main.keyboard.press('Escape');
  await ask(true);
  await chat.evaluate(petId => window.companion.select(petId), b);
  await ask(false);
  await chat.evaluate(petId => window.companion.select(petId), a);
  return {
    taskExtraction: true,
    noRecallBeforeReview: true,
    cancelLeavesCandidate: true,
    confirmedPrivateRecall: true,
    otherCompanionIsolated: true,
    otherWindowRefreshed: true,
    screenshot: path.join(userData, 'memory-review-native.png'),
  };
}
