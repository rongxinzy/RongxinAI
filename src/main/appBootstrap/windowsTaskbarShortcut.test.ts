import { expect, test } from 'vitest';

import { findStaleTaskbarShortcuts, type StartMenuShortcut } from './windowsTaskbarShortcut';

const PRODUCT_APP_USER_MODEL_ID = 'com.zhiyuanagent.app';
const INSTALLED_EXE = 'C:\\Users\\me\\AppData\\Local\\Programs\\zhiyuan-agent\\知远.exe';
const DEV_EXE =
  'C:\\Users\\me\\workspace\\zhiyuan-agent\\node_modules\\electron\\dist\\electron.exe';
const PROGRAMS_DIR = 'C:\\Users\\me\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs';

const shortcut = (
  name: string,
  target: string | undefined,
  appUserModelId: string | undefined = PRODUCT_APP_USER_MODEL_ID,
): StartMenuShortcut => ({
  shortcutPath: `${PROGRAMS_DIR}\\${name}`,
  appUserModelId,
  target,
});

test('removes the leftover development shortcut that claims the product identity', () => {
  const stale = findStaleTaskbarShortcuts([shortcut('Electron.lnk', DEV_EXE)], {
    execPath: INSTALLED_EXE,
    appUserModelIds: [PRODUCT_APP_USER_MODEL_ID],
  });

  expect(stale.map(entry => entry.shortcutPath)).toEqual([`${PROGRAMS_DIR}\\Electron.lnk`]);
});

test('keeps the installed shortcut that launches the current executable', () => {
  const stale = findStaleTaskbarShortcuts([shortcut('知远智能体.lnk', INSTALLED_EXE)], {
    execPath: INSTALLED_EXE,
    appUserModelIds: [PRODUCT_APP_USER_MODEL_ID],
  });

  expect(stale).toEqual([]);
});

test('keeps the development shortcut while running the development executable', () => {
  const stale = findStaleTaskbarShortcuts([shortcut('ZhiYuan-Dev.lnk', DEV_EXE)], {
    execPath: DEV_EXE,
    appUserModelIds: [PRODUCT_APP_USER_MODEL_ID],
  });

  expect(stale).toEqual([]);
});

test('keeps shortcuts that belong to another application identity', () => {
  const stale = findStaleTaskbarShortcuts(
    [shortcut('Electron.lnk', DEV_EXE, 'com.example.other')],
    {
      execPath: INSTALLED_EXE,
      appUserModelIds: [PRODUCT_APP_USER_MODEL_ID],
    },
  );

  expect(stale).toEqual([]);
});

test('keeps another installed copy of the product executable', () => {
  const perMachineExe = 'C:\\Program Files\\ZhiYuan\\知远.exe';
  const stale = findStaleTaskbarShortcuts([shortcut('知远智能体.lnk', perMachineExe)], {
    execPath: INSTALLED_EXE,
    appUserModelIds: [PRODUCT_APP_USER_MODEL_ID],
  });

  expect(stale).toEqual([]);
});

test('ignores shortcuts without a target or without an application identity', () => {
  const stale = findStaleTaskbarShortcuts(
    [
      shortcut('NoTarget.lnk', undefined),
      {
        shortcutPath: `${PROGRAMS_DIR}\\NoIdentity.lnk`,
        target: DEV_EXE,
      },
      {
        shortcutPath: `${PROGRAMS_DIR}\\Empty.lnk`,
        appUserModelId: PRODUCT_APP_USER_MODEL_ID,
        target: '',
      },
    ],
    { execPath: INSTALLED_EXE, appUserModelIds: [PRODUCT_APP_USER_MODEL_ID] },
  );

  expect(stale).toEqual([]);
});

test('compares executable paths case-insensitively and ignores trailing separators', () => {
  const stale = findStaleTaskbarShortcuts([shortcut('ZhiYuan-Dev.lnk', `${DEV_EXE}\\`)], {
    execPath: DEV_EXE.toUpperCase(),
    appUserModelIds: [PRODUCT_APP_USER_MODEL_ID],
  });

  expect(stale).toEqual([]);
});
