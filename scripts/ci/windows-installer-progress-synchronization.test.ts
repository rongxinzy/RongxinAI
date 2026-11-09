import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';

const helper = readFileSync(path.join(__dirname, 'windows-installer-ui.cs'), 'utf8');

test('waits for the persistent action before enumerating transitioned fixture controls', () => {
  const regression = readFileSync(
    path.join(__dirname, 'windows-installer-progress-regression.ps1'),
    'utf8',
  );
  const wait = regression.split('function Wait-FixtureAction {')[1]?.split('\nfunction ')[0];
  expect(wait).toContain('::Control($Handle)');
  expect(wait).not.toContain('::Controls(');
  expect(wait).toContain('$control.ProcessId -ne $ProcessId');
  expect(wait).toContain('$control.ParentHandle -ne $Parent');
  expect(wait).toContain("$control.ClassName -ne 'Button'");
  expect(wait).toContain('$control.ControlId -ne 1100');
  expect(wait).toContain(
    '$control.Visible -and $control.Enabled -and $control.Text -eq $Text',
  );
  for (const [start, end, expected] of [
    ['::Click($advance.Handle)', '$expectedProgress =', 'Finish fixture'],
    ['::Click($finish.Handle)', '$finishIds =', 'Fixture finished'],
  ]) {
    const transition = regression.slice(regression.indexOf(start), regression.indexOf(end));
    expect(transition).toContain(
      `Wait-FixtureAction $advance.Handle $window.Handle $child.Id '${expected}'`,
    );
    expect(transition).not.toContain('::Controls(');
  }
  const single = helper.slice(
    helper.indexOf('public static WindowInfo Control('),
    helper.indexOf('public static WindowInfo[] Windows()'),
  );
  expect(single).toContain('return Inspect(new IntPtr(handle));');
  expect(single).not.toContain('catch');
});
