import { delimiter } from 'path';
import { describe, expect, test } from 'vitest';

import {
  appendEnvPath,
  convertWindowsPathToMsys,
  normalizeWindowsPath,
  singleWindowsPathToPosix,
  truncateDiagnostic,
} from './pathUtils';

describe('appendEnvPath', () => {
  test('prepends additions before the current value', () => {
    expect(
      appendEnvPath(`${delimiter}usr${delimiter}bin`, [`${delimiter}opt${delimiter}homebrew`]),
    ).toBe(`${delimiter}opt${delimiter}homebrew${delimiter}usr${delimiter}bin`);
  });

  test('drops duplicate and empty entries while keeping first occurrence', () => {
    expect(appendEnvPath('/a', ['/a', '', '/b'])).toBe('/a:/b');
  });

  test('returns the current value unchanged when additions are empty entries', () => {
    expect(appendEnvPath('/a', ['', ''])).toBe('/a');
  });

  test('keeps undefined current value undefined when nothing is added', () => {
    expect(appendEnvPath(undefined, [''])).toBeUndefined();
  });

  test('builds a value from additions alone when current is undefined', () => {
    expect(appendEnvPath(undefined, ['/a', '/b'])).toBe('/a:/b');
  });
});

describe('normalizeWindowsPath', () => {
  test('returns null for missing or blank input', () => {
    expect(normalizeWindowsPath(undefined)).toBeNull();
    expect(normalizeWindowsPath('   ')).toBeNull();
    expect(normalizeWindowsPath('\r\n')).toBeNull();
  });

  test('trims whitespace, carriage returns and surrounding quotes', () => {
    expect(normalizeWindowsPath('  "C:\\Program Files\\Git\\bin\\bash.exe"\r\n')).toBe(
      'C:\\Program Files\\Git\\bin\\bash.exe',
    );
  });

  test('converts forward slashes to backslashes', () => {
    expect(normalizeWindowsPath('C:/Git/bin/bash.exe')).toBe('C:\\Git\\bin\\bash.exe');
  });
});

describe('singleWindowsPathToPosix', () => {
  test('converts a drive path with non-ASCII characters', () => {
    expect(singleWindowsPathToPosix('C:\\Users\\中文用户\\AppData\\Roaming')).toBe(
      '/c/Users/中文用户/AppData/Roaming',
    );
  });

  test('lowercases the drive letter and drops trailing separators', () => {
    expect(singleWindowsPathToPosix('D:\\tools\\git\\')).toBe('/d/tools/git');
    expect(singleWindowsPathToPosix('C:\\')).toBe('/c');
  });

  test('falls back to plain backslash conversion without a drive letter', () => {
    expect(singleWindowsPathToPosix('relative\\dir')).toBe('relative/dir');
  });

  test('returns empty string unchanged', () => {
    expect(singleWindowsPathToPosix('')).toBe('');
  });
});

describe('convertWindowsPathToMsys', () => {
  test('converts each semicolon-separated entry to POSIX', () => {
    expect(convertWindowsPathToMsys('C:\\nodejs;C:\\Python311\\Scripts')).toBe(
      '/c/nodejs:/c/Python311/Scripts',
    );
  });

  test('keeps already-POSIX entries and converts relative backslash entries', () => {
    expect(convertWindowsPathToMsys('/usr/bin:/bin;relative\\dir')).toBe(
      '/usr/bin:/bin:relative/dir',
    );
  });

  test('drops empty and whitespace-only entries', () => {
    expect(convertWindowsPathToMsys('C:\\a;;  ;C:\\b; ')).toBe('/c/a:/c/b');
  });

  test('returns empty string unchanged', () => {
    expect(convertWindowsPathToMsys('')).toBe('');
  });
});

describe('truncateDiagnostic', () => {
  test('returns short messages unchanged', () => {
    expect(truncateDiagnostic('short message')).toBe('short message');
  });

  test('truncates long messages with an ellipsis at the limit', () => {
    const message = 'x'.repeat(501);
    const truncated = truncateDiagnostic(message);
    expect(truncated.length).toBe(500);
    expect(truncated.endsWith('...')).toBe(true);
    expect(truncated.slice(0, 497)).toBe(message.slice(0, 497));
  });
});
