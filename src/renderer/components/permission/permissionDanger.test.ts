import { expect, test } from 'vitest';

import { i18nService } from '../../services/i18n';
import {
  PermissionDangerLevel,
  detectDangerLevelFromCommand,
  detectPermissionDanger,
} from './permissionDanger';

test('classifies commands by destructive, caution and safe patterns', () => {
  expect(detectDangerLevelFromCommand('rm -rf build')).toBe(PermissionDangerLevel.Destructive);
  expect(detectDangerLevelFromCommand('git push --force origin main')).toBe(
    PermissionDangerLevel.Destructive,
  );
  expect(detectDangerLevelFromCommand('git push origin main')).toBe(PermissionDangerLevel.Caution);
  expect(detectDangerLevelFromCommand('npm test')).toBe(PermissionDangerLevel.Safe);
});

test('prefers the adapter-provided level and its mapped reason', () => {
  i18nService.setLanguage('zh', { persist: false });

  expect(
    detectPermissionDanger({
      command: 'echo safe',
      dangerLevel: PermissionDangerLevel.Caution,
      dangerReason: 'file-delete',
    }),
  ).toEqual({
    level: PermissionDangerLevel.Caution,
    reasonText: i18nService.t('dangerReasonFileDelete'),
  });
});

test('ignores an unknown level and an unmapped reason', () => {
  expect(detectPermissionDanger({ command: 'npm test', dangerLevel: 'apocalyptic' })).toEqual({
    level: PermissionDangerLevel.Safe,
    reasonText: '',
  });
  expect(
    detectPermissionDanger({ command: 'rm -rf build', dangerReason: 'made-up-reason' }),
  ).toEqual({
    level: PermissionDangerLevel.Destructive,
    reasonText: '',
  });
});

test('scans only a string command and tolerates missing input', () => {
  expect(detectPermissionDanger(null)).toEqual({
    level: PermissionDangerLevel.Safe,
    reasonText: '',
  });
  expect(detectPermissionDanger({ command: null })).toEqual({
    level: PermissionDangerLevel.Safe,
    reasonText: '',
  });
  expect(detectPermissionDanger({ command: 'rm -rf build' }).level).toBe(
    PermissionDangerLevel.Destructive,
  );
});
