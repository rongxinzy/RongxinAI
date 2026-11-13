import { describe, expect, it } from 'vitest';

import { getPiBashPythonEnvViolation } from './piBashToolGuidelines';

describe('piBashToolGuidelines', () => {
  it('does not block pip or uv commands in shell tools', () => {
    expect(getPiBashPythonEnvViolation('pip install pandas')).toBeUndefined();
    expect(getPiBashPythonEnvViolation('pip3 install --user requests')).toBeUndefined();
    expect(getPiBashPythonEnvViolation('python3 -m pip install openpyxl')).toBeUndefined();
    expect(getPiBashPythonEnvViolation('.venv/bin/pip install pandas')).toBeUndefined();
    expect(getPiBashPythonEnvViolation('uv add pandas')).toBeUndefined();
    expect(getPiBashPythonEnvViolation('pip list')).toBeUndefined();
  });

  it('redirects direct python invocations of bundled Skill scripts across bash and PowerShell', () => {
    const posixSkillsRoot = '/home/user/app/SKILLs';
    expect(
      getPiBashPythonEnvViolation(
        `python3 ${posixSkillsRoot}/xlsx/scripts/xlsx_reader.py in.xlsx`,
        posixSkillsRoot,
      ),
    ).toContain('run_skill_script');
    expect(getPiBashPythonEnvViolation('python "$SKILLS_ROOT/pdf/scripts/render.py"')).toContain(
      'run_skill_script',
    );
    expect(
      getPiBashPythonEnvViolation('& python.exe "$env:SKILLS_ROOT\\pdf\\scripts\\render.py"'),
    ).toContain('run_skill_script');
    expect(
      getPiBashPythonEnvViolation(
        'python.exe C:\\app\\SKILLs\\docx\\scripts\\cli.py inspect.docx',
        'C:\\app\\SKILLs',
      ),
    ).toContain('run_skill_script');
    expect(
      getPiBashPythonEnvViolation('python3 /tmp/adhoc/analyze.py', posixSkillsRoot),
    ).toBeUndefined();
  });
});
