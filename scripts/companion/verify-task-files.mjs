import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';

export async function createTaskFileFixture(output) {
  const file = path.join(output, 'attachment-notes.md');
  const marker = `COMPANION_FILE_PROOF_${randomUUID()}`;
  await fs.writeFile(file, `# Selected task evidence\n\n${marker}\n`);
  return { file, marker, requested: false, observed: false };
}

/** Only the dialog's result is substituted; owned IPC, catalog and task tools are real. */
export async function chooseTaskFile(application, chat, fixture, output) {
  await application.evaluate(({ dialog }, file) => {
    globalThis.companionAcceptanceDialog = dialog.showOpenDialog;
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  }, fixture.file);
  try {
    await chat.getByRole('button', { name: '添加附件', exact: true }).click();
    await expect(chat.getByText(path.basename(fixture.file), { exact: true })).toBeVisible();
    await chat.evaluate(async () => {
      await Promise.all(
        document.getAnimations().map(animation => animation.finished.catch(() => {})),
      );
    });
    console.log(
      JSON.stringify({
        fileDraftWindow: await application.evaluate(({ BrowserWindow }) => {
          const window = BrowserWindow.getAllWindows().find(window =>
            window.webContents.getURL().includes('companion.html'),
          );
          return {
            visible: window.isVisible(),
            focused: window.isFocused(),
            bounds: window.getBounds(),
          };
        }),
        fileDraftDocument: await chat.evaluate(() => ({
          visibility: document.visibilityState,
          focused: document.hasFocus(),
          readyState: document.readyState,
        })),
      }),
    );
    await chat.screenshot({ path: path.join(output, 'task-file-draft.png'), timeout: 5000 });
    const attachments = await chat.evaluate(async () => {
      const { activePetId } = await window.companion.bootstrap();
      return JSON.parse(localStorage.getItem(`zhiyuan-companion-draft:${activePetId}`)).attachments;
    });
    expect(attachments).toHaveLength(1);
    expect(Object.keys(attachments[0]).sort()).toEqual(['bytes', 'id', 'name']);
    return attachments.map(item => item.id);
  } finally {
    await application.evaluate(({ dialog }) => {
      dialog.showOpenDialog = globalThis.companionAcceptanceDialog;
      delete globalThis.companionAcceptanceDialog;
    });
  }
}
