import { describe, expect, test } from 'vitest';

import { appSystemContract } from './appSystemContract';
import * as appSystemChannels from './appSystemContract.channels';

/**
 * Schema fidelity tests: fixtures below are copied from real renderer call
 * sites so a schema drift that would reject a valid production invoke fails
 * here, and representative bad inputs are proven rejected.
 */

// --- store ----------------------------------------------------------------

test('store get/set/remove accept the localStore adapter payloads', () => {
  // src/renderer/services/store.ts localStore: string keys, arbitrary JSON values
  expect(appSystemContract.storeGet.args.safeParse(['theme']).success).toBe(true);
  expect(appSystemContract.storeSet.args.safeParse(['theme', { mode: 'dark' }]).success).toBe(true);
  expect(appSystemContract.storeSet.args.safeParse(['seenVersions', ['1.0.0']]).success).toBe(true);
  expect(appSystemContract.storeRemove.args.safeParse(['theme']).success).toBe(true);
  expect(appSystemContract.storeGet.args.safeParse([42]).success).toBe(false);
});

// --- window / app info ---------------------------------------------------------

test('window and app info methods take no arguments', () => {
  expect(appSystemContract.windowIsMaximized.args.safeParse([]).success).toBe(true);
  expect(appSystemContract.appGetInferenceEdition.result.safeParse('cuda').success).toBe(true);
  expect(appSystemContract.appGetInferenceEdition.result.safeParse('tensorrt').success).toBe(false);
});

// --- app config ----------------------------------------------------------------

test('checkApiConfig accepts the optional probe flag', () => {
  // coworkService.checkApiConfig passes { probeModel: true } from settings
  expect(appSystemContract.checkApiConfig.args.safeParse([{ probeModel: true }]).success).toBe(
    true,
  );
  expect(appSystemContract.checkApiConfig.args.safeParse([undefined]).success).toBe(true);
  expect(appSystemContract.checkApiConfig.args.safeParse([]).success).toBe(true);
  expect(appSystemContract.checkApiConfig.args.safeParse([{ probeModel: 'yes' }]).success).toBe(
    false,
  );
});

test('generateSessionTitle accepts nullable user input', () => {
  // coworkService passes the raw prompt (or null for untitled sessions)
  expect(appSystemContract.generateSessionTitle.args.safeParse(['写一个爬虫']).success).toBe(true);
  expect(appSystemContract.generateSessionTitle.args.safeParse([null]).success).toBe(true);
  expect(appSystemContract.generateSessionTitle.args.safeParse([undefined]).success).toBe(false);
});

test('getRecentCwds accepts an optional numeric limit', () => {
  expect(appSystemContract.getRecentCwds.args.safeParse([5]).success).toBe(true);
  expect(appSystemContract.getRecentCwds.args.safeParse([undefined]).success).toBe(true);
  expect(appSystemContract.getRecentCwds.args.safeParse([]).success).toBe(true);
  expect(appSystemContract.getRecentCwds.args.safeParse(['5']).success).toBe(false);
});

// --- dialog ----------------------------------------------------------------

test('dialog selectDirectory accepts the optional defaultPath', () => {
  // FolderSelectorPopover / workspace picker pass { defaultPath }
  expect(
    appSystemContract.dialogSelectDirectory.args.safeParse([{ defaultPath: '/home/me/projects' }])
      .success,
  ).toBe(true);
  expect(appSystemContract.dialogSelectDirectory.args.safeParse([undefined]).success).toBe(true);
  expect(appSystemContract.dialogSelectDirectory.args.safeParse([]).success).toBe(true);
});

test('dialog selectFiles validates single-selection Skill zip and multi-selection attachment payloads', () => {
  expect(
    appSystemContract.dialogSelectFiles.args.safeParse([
      { multiple: false, filters: [{ name: 'Zip', extensions: ['zip'] }] },
    ]).success,
  ).toBe(true);
  expect(
    appSystemContract.dialogSelectFiles.args.safeParse([
      { title: '选择附件', filters: [{ name: 'Images', extensions: ['png', 'jpg'] }] },
    ]).success,
  ).toBe(true);
  expect(
    appSystemContract.dialogSelectFiles.args.safeParse([{ filters: [{ name: 'Zip' }] }]).success,
  ).toBe(false);
  expect(appSystemContract.dialogSelectFiles.args.safeParse([{ multiple: 'no' }]).success).toBe(
    false,
  );
});

test('dialog saveInlineFile accepts the usePromptAttachments payload', () => {
  // usePromptAttachments paste/drop flow sends { dataBase64, fileName, mimeType, cwd }
  expect(
    appSystemContract.dialogSaveInlineFile.args.safeParse([
      {
        dataBase64: 'aGVsbG8=',
        fileName: 'pasted-image.png',
        mimeType: 'image/png',
        cwd: '/home/me/projects/demo',
      },
    ]).success,
  ).toBe(true);
  // mimeType/cwd are optional; dataBase64 is required.
  expect(
    appSystemContract.dialogSaveInlineFile.args.safeParse([{ dataBase64: 'aGVsbG8=' }]).success,
  ).toBe(true);
  expect(appSystemContract.dialogSaveInlineFile.args.safeParse([{}]).success).toBe(false);
});

test('dialog file readers accept artifact paths', () => {
  expect(appSystemContract.dialogReadFileAsDataUrl.args.safeParse(['/tmp/a.png']).success).toBe(
    true,
  );
  expect(
    appSystemContract.dialogCheckArtifactFile.args.safeParse(['file:///tmp/a.html']).success,
  ).toBe(true);
  expect(appSystemContract.dialogReadFileAsDataUrl.args.safeParse([null]).success).toBe(false);
});

// --- shell ----------------------------------------------------------------

test('shell methods accept the paths and optional cwd they get today', () => {
  // MarkdownContent local link resolve sends (candidate, cwd)
  expect(
    appSystemContract.shellResolveLocalPath.args.safeParse([
      '/home/me/projects/demo/a.ts',
      '/home/me',
    ]).success,
  ).toBe(true);
  expect(appSystemContract.shellResolveLocalPath.args.safeParse(['/home/me/a.ts']).success).toBe(
    true,
  );
  expect(appSystemContract.shellResolveLocalPath.args.safeParse([]).success).toBe(false);
  expect(appSystemContract.shellOpenExternal.args.safeParse(['https://example.com']).success).toBe(
    true,
  );
  expect(appSystemContract.shellOpenHtmlInBrowser.args.safeParse(['<b>hi</b>']).success).toBe(true);
});

// --- auto-launch / prevent-sleep ------------------------------------------------

test('autoLaunch and preventSleep take booleans', () => {
  expect(appSystemContract.autoLaunchSet.args.safeParse([true]).success).toBe(true);
  expect(appSystemContract.autoLaunchSet.args.safeParse(['on']).success).toBe(false);
  expect(appSystemContract.preventSleepSet.args.safeParse([false]).success).toBe(true);
});

// --- app update ----------------------------------------------------------------

test('appUpdate setChannel accepts the stable/beta preference', () => {
  expect(appSystemContract.appUpdateSetChannel.args.safeParse(['beta']).success).toBe(true);
  expect(appSystemContract.appUpdateSetChannel.args.safeParse(['nightly']).success).toBe(false);
  expect(appSystemContract.appUpdateCheckNow.args.safeParse([{ manual: true }]).success).toBe(true);
  expect(appSystemContract.appUpdateCheckNow.args.safeParse([]).success).toBe(true);
});

describe('contract/channel consistency', () => {
  test('channel map stays in sync with the contract', () => {
    const preloadChannels = Object.values(appSystemChannels).flatMap(map => Object.values(map));
    const contractChannels = Object.values(appSystemContract).map(method => method.channel);
    expect(preloadChannels.sort()).toEqual(contractChannels.sort());
  });
});
