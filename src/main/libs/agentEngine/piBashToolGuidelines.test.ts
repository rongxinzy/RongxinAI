import { describe, expect, it } from 'vitest';

import {
  createPiBashToolSystemPrompt,
  getPiBashCommandViolation,
  PiBashToolSystemPrompt,
} from './piBashToolGuidelines';

describe('piBashToolGuidelines', () => {
  it('adds the Git Bash contract only on Windows', () => {
    expect(createPiBashToolSystemPrompt('win32')).toBe(PiBashToolSystemPrompt);
    expect(createPiBashToolSystemPrompt('linux')).toBe('');
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
});
