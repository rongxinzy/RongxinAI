import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

const pages = readFileSync('scripts/installer-ui/zy-pages.nsh', 'utf8');
const theme = readFileSync('scripts/installer-ui/zy-theme.nsh', 'utf8');
const installer = readFileSync('scripts/nsis-installer.nsh', 'utf8');
function body(name: string) {
  const start = pages.indexOf(`Function ${name}\n`);
  expect(start).toBeGreaterThanOrEqual(0);
  return pages.slice(start, pages.indexOf('FunctionEnd', start));
}

test('lets NSIS advance the hidden-Next progress page only after section success', () => {
  expect(body('ZYProgressShow')).toContain('SetAutoClose true');
  expect(body('ZYProgressShow')).not.toContain('ZY_ClickWizardNext');
  expect(installer).toContain('!define MUI_PAGE_CUSTOMFUNCTION_LEAVE ZY_MuiPageLeave');
  expect(installer).toContain('Page custom ZYFinishCreate ZYFinishLeave');
});

test('destroys all wizard-owned progress controls before displaying completion', () => {
  const leave = body('ZY_MuiPageLeave');
  for (const handle of [
    'zyProgressBackground',
    'zyProgressTrack',
    'zyFill',
    'zyMask',
    'zyComplete',
  ]) {
    expect(body('ZYProgressShow')).toContain(`StrCpy $${handle} $R6`);
    expect(leave).toContain(`!insertmacro ZY_DestroyBitmap $${handle}`);
  }
  for (const handle of ['zyProgressTitle', 'zyPhaseLabel']) {
    expect(leave).toContain(`DestroyWindow(p $${handle})`);
    expect(leave).toContain(`StrCpy $${handle} ""`);
  }
  expect(theme).toContain('SendMessage ${CONTROL} ${STM_SETIMAGE} ${IMAGE_BITMAP} 0 $R0');
  expect(theme).toContain('gdi32::DeleteObject(p R0)');
  expect(theme).toContain('!insertmacro ZY_DestroyBitmap $zyHeaderBitmap');
  expect(body('ZYFinishLeave')).toContain('DestroyWindow(p $zyFinishTitle)');
});

test('enforces consent on page leave and preserves optional local inference', () => {
  expect(body('ZYHeroLeave')).toMatch(/NSD_GetState.*heroLicense[\s\S]*Abort/);
  expect(body('ZYHeroLeave')).toContain('${NSD_GetState} $heroInference $installLocalInference');
  expect(installer).toContain('pending-local-inference-install');
  for (const key of [
    'channel-runtime',
    'skills',
    'mcps',
    'portable-git',
    'python',
    'skill-python',
    'uv',
  ]) {
    expect(installer).toContain(`!insertmacro RecordOfflineComponentReady "${key}"`);
  }
});

test('keeps a failed launch on the usable finish page and resets launch intent', () => {
  const leave = body('ZYFinishLeave');
  expect(leave).toContain('StrCpy $zyLaunchApp "0"');
  expect(leave).toContain('${If} $1 != "ok"');
  expect(leave).toContain('${AndIf} $1 != "fallback"');
  expect(leave).toMatch(/ZY_UI_LAUNCH_FAILED\)"\s+Abort/);
  expect(body('ZYFinishCloseClick')).toContain('StrCpy $zyLaunchApp "0"');
});

test('matches directory boundaries correctly and preserves Unicode backup paths', () => {
  expect(installer).not.toContain('[char]0x27');
  expect(installer).toContain('TrimEnd([char]0x5c) + [char]0x5c');
  expect(installer).toContain('FileWriteUTF16LE /BOM $8 "$3"');
});
