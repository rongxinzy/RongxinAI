import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';

const FileIntake = { Picker: 'picker', Drop: 'drop', Paste: 'paste' };

export async function createTaskFileFixture(output) {
  const file = path.join(output, 'attachment-notes.md');
  const marker = `COMPANION_FILE_PROOF_${randomUUID()}`;
  await fs.writeFile(file, `# Selected task evidence\n\n${marker}\n`);
  const requestedIntake = process.env.COMPANION_VERIFY_FILE_TRANSFER;
  const intake =
    requestedIntake === FileIntake.Drop || requestedIntake === FileIntake.Paste
      ? requestedIntake
      : FileIntake.Picker;
  return { file, marker, intake, requested: false, observed: false };
}

/** Only the dialog's result is substituted; owned IPC, catalog and task tools are real. */
export async function chooseTaskFile(application, chat, fixture, output) {
  await application.evaluate(({ dialog }, file) => {
    globalThis.companionAcceptanceDialog = dialog.showOpenDialog;
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  }, fixture.file);
  try {
    if (fixture.intake === FileIntake.Picker) {
      await chat.getByRole('button', { name: '添加附件', exact: true }).click();
    } else {
      const bytes = [...(await fs.readFile(fixture.file))];
      await chat.getByRole('textbox').evaluate(
        (input, { bytes, name, intake }) => {
          const transfer = new DataTransfer();
          transfer.items.add(new File([new Uint8Array(bytes)], name, { type: 'text/markdown' }));
          const event =
            intake === 'drop'
              ? new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer })
              : new ClipboardEvent('paste', {
                  bubbles: true,
                  cancelable: true,
                  clipboardData: transfer,
                });
          input.dispatchEvent(event);
        },
        { bytes, name: path.basename(fixture.file), intake: fixture.intake },
      );
    }
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
    if (fixture.intake !== FileIntake.Picker) {
      const source = fixture.file;
      fixture.file = await application.evaluate(({ app }, id) => {
        const require = process
          .getBuiltinModule('module')
          .createRequire(process.cwd() + '/package.json');
        const Database = require('better-sqlite3');
        const db = new Database(app.getPath('userData') + '/zhiyuan.sqlite', { readonly: true });
        try {
          return db.prepare('SELECT path FROM companion_attachments WHERE id = ?').get(id).path;
        } finally {
          db.close();
        }
      }, attachments[0].id);
      expect(fixture.file).not.toBe(source);
      expect(await fs.readFile(fixture.file)).toEqual(await fs.readFile(source));
      fixture.binaryMatchesSource = true;
    }
    return attachments.map(item => item.id);
  } finally {
    await application.evaluate(({ dialog }) => {
      dialog.showOpenDialog = globalThis.companionAcceptanceDialog;
      delete globalThis.companionAcceptanceDialog;
    });
  }
}
