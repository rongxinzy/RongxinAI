import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

describe('Windows update installation handoff', () => {
  test('preserves the branded interactive NSIS handoff and cancellation recovery', async () => {
    const updaterSource = await fs.promises.readFile(
      path.resolve(process.cwd(), 'src/main/libs/appUpdateInstaller.ts'),
      'utf8',
    );

    expect(updaterSource).toContain('Launching interactive installer: $installerPath');
    expect(updaterSource).toContain('Start-Process -FilePath $installerPath -Wait -PassThru');
    expect(updaterSource).not.toContain("-ArgumentList '/S'");
    expect(updaterSource).toContain(
      'Existing app relaunched after installer cancellation or failure',
    );
  });
});
