import { expect } from '@playwright/test';
import path from 'node:path';
import { COMPANION_NAME_KEYS } from '../../src/shared/companion/constants.ts';
import { companionMessages } from '../../src/shared/companion/messages.ts';

export const COMPANION_MEMORY_NATIVE_MARKER = 'native-companion-paper-kite-cobalt';

/** Uses only the isolated acceptance app, its real bridge, Engram and loopback model fixture. */
export async function verifyCompanionMemory(application, main, chat, userData, requests) {
  const capture = async name => {
    await application.evaluate(({ BrowserWindow }, url) => {
      const window = BrowserWindow.getAllWindows().find(
        window => window.webContents.getURL() === url,
      );
      if (!window) throw new Error('Companion acceptance window missing.');
      window.show();
      window.focus();
    }, chat.url());
    await chat.bringToFront();
    await chat.screenshot({ path: path.join(userData, name) });
  };
  const state = await chat.evaluate(() => window.companion.bootstrap());
  const a = state.activePetId;
  const b = state.profiles.find(profile => profile.petId !== a).petId;
  const select = async petId => {
    const profile = state.profiles.find(profile => profile.petId === petId);
    const label = companionMessages.zh[COMPANION_NAME_KEYS[profile.personaId]];
    await chat.evaluate(petId => window.companion.select(petId), petId);
    // A bridge reply precedes React's bootstrap refresh; act only on the selected UI identity.
    await expect(
      chat.getByRole('combobox', { name: '切换伙伴' }).locator('[data-slot="select-value"]'),
    ).toHaveText(label);
  };
  const ask = async expected => {
    const count = requests.length;
    const receipt = await chat.evaluate(async () => {
      const api = window.companion;
      return (
        await api.submit({
          petId: (await api.bootstrap()).activePetId,
          requestId: crypto.randomUUID(),
          text: 'Native shared conversation: paper kite',
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
      .toBe('answered');
    expect(requests.length).toBe(count + 1);
    expect(requests.at(-1).companionMemory).toBe(expected);
  };
  const openMemory = async () => {
    await chat.getByRole('button', { name: '记忆', exact: true }).click();
    return chat.getByRole('dialog');
  };
  let dialog = await openMemory();
  await dialog.getByRole('button', { name: '添加记忆', exact: true }).click();
  await dialog.getByRole('textbox', { name: '标题', exact: true }).fill('Paper kite');
  await dialog
    .getByRole('textbox', { name: '内容', exact: true })
    .fill(COMPANION_MEMORY_NATIVE_MARKER);
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(dialog.getByText(COMPANION_MEMORY_NATIVE_MARKER, { exact: true })).toBeVisible();
  const [saved] = await chat.evaluate(petId => window.companion.listMemories(petId), a);
  expect(saved.memoryId).not.toBeNull();
  await capture('memory-native-private.png');
  await chat.keyboard.press('Escape');
  await ask(true);
  await select(b);
  expect(await chat.evaluate(petId => window.companion.listMemories(petId), b)).toEqual([]);
  await ask(false);
  await select(a);
  dialog = await openMemory();
  await dialog.getByRole('button', { name: '删除: Paper kite' }).click();
  await chat.getByRole('button', { name: '删除', exact: true }).click();
  await expect(dialog.getByText('还没有记忆。')).toBeVisible();
  await chat.keyboard.press('Escape');
  await ask(false);
  // A confirmed personal copy is a separate record; it must not be created by opening the dialog.
  const next = await chat.evaluate(
    async ({ petId, marker }) =>
      window.companion.saveMemory({
        petId,
        requestId: crypto.randomUUID(),
        title: 'Paper kite',
        content: marker,
        kind: 'preference',
      }),
    { petId: a, marker: COMPANION_MEMORY_NATIVE_MARKER },
  );
  dialog = await openMemory();
  await dialog.getByRole('button', { name: '共享记忆: Paper kite' }).click();
  const before = await main.evaluate(() => window.electron.memory.list({}));
  expect(before.data?.some(record => record.promotedFromLinkId === next.id)).toBe(false);
  await capture('memory-native-share.png');
  await dialog.getByRole('button', { name: '确认共享', exact: true }).click();
  await expect(dialog.getByRole('status')).toHaveText('已共享');
  await chat.keyboard.press('Escape');
  await select(b);
  await ask(true);
  const shared = await main.evaluate(() => window.electron.memory.list({}));
  expect(shared.data?.find(record => record.promotedFromLinkId === next.id)?.scope).toBe(
    'personal',
  );
  await select(a);
  return {
    privateRecall: true,
    otherCompanionIsolated: true,
    forgottenContextRemoved: true,
    confirmedPersonalRecall: true,
    savedViaNativeUi: true,
    requests: 4,
  };
}
