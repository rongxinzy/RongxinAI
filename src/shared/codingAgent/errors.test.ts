import { describe, expect, test } from 'vitest';

import {
  CodingErrorDetailMessage,
  CodingErrorI18nKey,
  CodingErrorMessage,
  resolveCodingErrorTranslation,
} from './errors';

describe('coding error catalogue', () => {
  test('resolves an exact message to its own key', () => {
    expect(resolveCodingErrorTranslation(CodingErrorMessage.WorkspaceSourceInUse)).toEqual({
      key: CodingErrorI18nKey[CodingErrorMessage.WorkspaceSourceInUse],
    });
  });

  test('resolves a message padded with whitespace as the same message', () => {
    expect(resolveCodingErrorTranslation(`  ${CodingErrorMessage.PromptRequired}  `)).toEqual({
      key: CodingErrorI18nKey[CodingErrorMessage.PromptRequired],
    });
  });

  test('keeps the detail of an interpolated message', () => {
    expect(
      resolveCodingErrorTranslation(`${CodingErrorDetailMessage.WorkspaceSourceMissing} D:\\proj`),
    ).toEqual({
      key: CodingErrorI18nKey[CodingErrorDetailMessage.WorkspaceSourceMissing],
      detail: 'D:\\proj',
    });
  });

  test('keeps a detail that itself contains the separator', () => {
    expect(
      resolveCodingErrorTranslation(
        `${CodingErrorDetailMessage.AcpRequestTimedOut} session/new: 30s`,
      ),
    ).toEqual({
      key: CodingErrorI18nKey[CodingErrorDetailMessage.AcpRequestTimedOut],
      detail: 'session/new: 30s',
    });
  });

  test('resolves an ACP request failure that carries a method and code', () => {
    expect(resolveCodingErrorTranslation('ACP request session/new failed-32000: boom.')).toEqual({
      key: 'codingErrorAcpRequestFailed',
    });
  });

  test('leaves third-party text unresolved', () => {
    expect(resolveCodingErrorTranslation('git commit failed with exit code 128.')).toBeNull();
    expect(resolveCodingErrorTranslation('')).toBeNull();
  });
});
