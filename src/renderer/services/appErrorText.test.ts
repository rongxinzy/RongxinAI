import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  CodingErrorDetailMessage,
  CodingErrorI18nKey,
  CodingErrorMessage,
} from '../../shared/codingAgent/errors';
import { WorkbenchErrorI18nKey } from '../../shared/workbenchTask/errors';
import { normalizeError } from './errorNormalization';
import { appErrorText, reportAppError } from './appErrorText';
import { i18nService } from './i18n';

const CJK = /[\u4e00-\u9fff]/;
const LATIN = /[A-Za-z]{3,}/;

beforeEach(() => i18nService.setLanguage('zh', { persist: false }));
afterEach(() => i18nService.setLanguage('zh', { persist: false }));

describe('coding error text', () => {
  test('translates a message the coding feature produced itself', () => {
    const text = appErrorText(CodingErrorMessage.WorkspaceSourceInUse);
    expect(text).toBe(i18nService.t('codingErrorWorkspaceSourceInUse'));
    expect(text).toMatch(CJK);
    expect(text).not.toMatch(/coding workspace/i);
  });

  test('translates an Error instance by its message', () => {
    expect(appErrorText(new Error(CodingErrorMessage.ProfileNotReady))).toBe(
      i18nService.t('codingErrorProfileNotReady'),
    );
  });

  test('keeps the folder after an interpolated message', () => {
    expect(appErrorText(`${CodingErrorDetailMessage.WorkspaceSourceMissing} D:\\project`)).toBe(
      i18nService.t('codingErrorWorkspaceSourceMissing').replace('{detail}', 'D:\\project'),
    );
  });

  test('drops an extracted detail the copy has no place for', () => {
    expect(appErrorText(`${CodingErrorDetailMessage.AcpRequestTimedOut} session/new`)).toBe(
      '编程 Agent 请求超时，请重试。',
    );
  });

  test('classifies an aborted turn instead of printing the raw engine text', () => {
    const text = appErrorText('This operation was aborted');
    expect(text).toBe(i18nService.t('coworkErrorStreamInterrupted'));
    expect(text).toMatch(CJK);
  });

  test('classifies a stalled turn that only carries the watchdog message', () => {
    expect(appErrorText('The model produced no output for 120s, so the turn was stopped.')).toBe(
      i18nService.t('coworkErrorTurnTimeout'),
    );
  });

  test('keeps a cleaned reason for third-party failures', () => {
    const text = appErrorText('git push failed with exit code 128.');
    expect(text).toBe('操作失败：git push failed with exit code 128');
  });

  test('falls back to the caller copy when there is no error', () => {
    expect(appErrorText(undefined)).toBe(i18nService.t('codingAgentActionFailed'));
    expect(appErrorText('', 'codingGitActionFailed')).toBe(i18nService.t('codingGitActionFailed'));
  });

  test('survives a second normalization pass', () => {
    // The toast pipeline normalizes whatever a component dispatches, so the
    // translated sentence must come back unchanged.
    const once = appErrorText(CodingErrorMessage.QueueLoadFailed);
    expect(normalizeError(once)).toBe(once);
  });

  test('sends the raw detail to the application log', () => {
    const fromRenderer = vi.fn();
    vi.stubGlobal('window', { electron: { log: { fromRenderer } } });
    try {
      const text = reportAppError(
        new Error(CodingErrorMessage.PromptRequired),
        undefined,
        'Coding',
      );
      expect(text).toBe(i18nService.t('codingErrorPromptRequired'));
      expect(fromRenderer).toHaveBeenCalledWith(
        'error',
        'Coding',
        CodingErrorMessage.PromptRequired,
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('coding error translations', () => {
  // A missing key makes i18nService.t() return the key itself, so an entry
  // without copy shows the user "codingErrorProfileNotReady" instead of a
  // sentence. Both catalogs must carry every key the resolver can return.
  const keys = [
    ...new Set([...Object.values(CodingErrorI18nKey), ...Object.values(WorkbenchErrorI18nKey)]),
  ];

  test.each(keys)('%s has Chinese and English copy', key => {
    i18nService.setLanguage('zh', { persist: false });
    const zh = i18nService.t(key);
    expect(zh, `${key} must not fall back to its own key`).not.toBe(key);
    expect(zh, `${key} needs Chinese copy`).toMatch(CJK);

    i18nService.setLanguage('en', { persist: false });
    const en = i18nService.t(key);
    expect(en, `${key} must not fall back to its own key`).not.toBe(key);
    expect(CJK.test(en), `${key} needs English copy`).toBe(false);
    expect(LATIN.test(en), `${key} needs an English sentence`).toBe(true);
  });
});
