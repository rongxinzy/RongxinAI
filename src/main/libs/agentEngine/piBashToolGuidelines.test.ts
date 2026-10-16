import { describe, expect, it } from 'vitest';

import {
  createPiBashToolSystemPrompt,
  getPiBashCommandViolation,
  getPiBashPythonEnvViolation,
  normalizePiBashTimeoutSeconds,
  PI_BASH_DEFAULT_TIMEOUT_SECONDS,
  PI_BASH_MAX_TIMEOUT_SECONDS,
  PiBashToolSystemPrompt,
} from './piBashToolGuidelines';

describe('piBashToolGuidelines', () => {
  it('adds the shell contract and timeout policy for every platform', () => {
    expect(createPiBashToolSystemPrompt('win32')).toContain(PiBashToolSystemPrompt);
    expect(createPiBashToolSystemPrompt('linux')).toContain('default timeout');
    expect(createPiBashToolSystemPrompt('linux')).toContain(
      `clamped to ${PI_BASH_MAX_TIMEOUT_SECONDS} seconds`,
    );
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

  it('does not block pip or uv commands in bash', () => {
    expect(getPiBashPythonEnvViolation('pip install pandas')).toBeUndefined();
    expect(getPiBashPythonEnvViolation('pip3 install --user requests')).toBeUndefined();
    expect(getPiBashPythonEnvViolation('python3 -m pip install openpyxl')).toBeUndefined();
    expect(getPiBashPythonEnvViolation('.venv/bin/pip install pandas')).toBeUndefined();
    expect(getPiBashPythonEnvViolation('uv add pandas')).toBeUndefined();
    expect(getPiBashPythonEnvViolation('pip list')).toBeUndefined();
  });

  it('redirects direct python invocations of bundled Skill scripts', () => {
    const skillsRoot = '/home/user/app/SKILLs';
    expect(
      getPiBashPythonEnvViolation(
        `python3 ${skillsRoot}/xlsx/scripts/xlsx_reader.py in.xlsx`,
        skillsRoot,
      ),
    ).toContain('run_skill_script');
    expect(getPiBashPythonEnvViolation('python "$SKILLS_ROOT/pdf/scripts/render.py"')).toContain(
      'run_skill_script',
    );
    expect(
      getPiBashPythonEnvViolation('python3 /tmp/adhoc/analyze.py', skillsRoot),
    ).toBeUndefined();
  });

  it('evaluates bundled Skill script violations on every platform', () => {
    expect(
      getPiBashCommandViolation('python "$SKILLS_ROOT/pdf/scripts/render.py"', 'linux'),
    ).toContain('run_skill_script');
    expect(
      getPiBashCommandViolation('python "$SKILLS_ROOT/pdf/scripts/render.py"', 'win32'),
    ).toContain('run_skill_script');
    expect(getPiBashCommandViolation('ls -la', 'win32')).toBeUndefined();
  });
});
