import { describe, expect, it } from 'vitest';

import {
  createPiBashToolSystemPrompt,
  getPiBashCommandViolation,
  normalizePiBashTimeoutSeconds,
  PI_BASH_DEFAULT_TIMEOUT_SECONDS,
  PI_BASH_MAX_TIMEOUT_SECONDS,
  PiBashToolSystemPrompt,
} from './piBashToolGuidelines';

describe('piBashToolGuidelines', () => {
  it('adds the shell contract and timeout policy for every platform', () => {
    expect(createPiBashToolSystemPrompt('win32')).toContain(PiBashToolSystemPrompt);
    expect(createPiBashToolSystemPrompt('linux')).toContain('default timeout');
  });

  it('blocks high-confidence Windows command dialects on Git Bash', () => {
    expect(getPiBashCommandViolation('dir "C:\\work" /s', 'win32')).toContain('Git Bash');
    expect(getPiBashCommandViolation('Get-ChildItem -Recurse', 'win32')).toContain('PowerShell');
    expect(getPiBashCommandViolation('tar -xzf "C:\\work\\archive.tgz"', 'win32')).toContain(
      'forward slashes',
    );
  });

  it('allows POSIX commands and explicit native shell invocations', () => {
    expect(getPiBashCommandViolation('find . -type f', 'win32')).toBeUndefined();
    expect(
      getPiBashCommandViolation('powershell.exe -NoProfile -Command "Get-ChildItem"', 'win32'),
    ).toBeUndefined();
    expect(getPiBashCommandViolation('dir /s', 'linux')).toBeUndefined();
  });

  it('bounds missing, invalid, and excessive Bash timeouts', () => {
    expect(normalizePiBashTimeoutSeconds(undefined)).toBe(PI_BASH_DEFAULT_TIMEOUT_SECONDS);
    expect(normalizePiBashTimeoutSeconds('300')).toBe(PI_BASH_DEFAULT_TIMEOUT_SECONDS);
    expect(normalizePiBashTimeoutSeconds(0)).toBe(PI_BASH_DEFAULT_TIMEOUT_SECONDS);
    expect(normalizePiBashTimeoutSeconds(30)).toBe(30);
    expect(normalizePiBashTimeoutSeconds(PI_BASH_MAX_TIMEOUT_SECONDS + 1)).toBe(
      PI_BASH_MAX_TIMEOUT_SECONDS,
    );
  });
});
