import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, test } from 'vitest';

const scriptPath = path.resolve('scripts/linux-before-install.sh');
const builderConfigPath = path.resolve('electron-builder.json');

describe('Linux deb upgrade pre-install hook', () => {
  test('is syntactically valid and installed as the deb preinst hook', () => {
    const syntax = spawnSync('sh', ['-n', scriptPath], { encoding: 'utf8' });
    expect(syntax.status, syntax.stderr || syntax.stdout).toBe(0);

    const builderConfig = JSON.parse(fs.readFileSync(builderConfigPath, 'utf8')) as {
      deb?: { fpm?: string[] };
    };
    expect(builderConfig.deb?.fpm).toContain('--before-install=scripts/linux-before-install.sh');
  });

  test('stops both current and legacy package paths before dpkg replaces files', () => {
    const script = fs.readFileSync(scriptPath, 'utf8');

    expect(script).toContain("DEB_INSTALL_PATTERN='/opt/(知远|ZhiYuanAgent)(/|$)'");
    expect(script).toContain("APPIMAGE_MOUNT_PATTERN='\\.mount_(知远|ZhiYuanAgent)'");
    expect(script).toContain('pkill -f "$DEB_INSTALL_PATTERN"');
    expect(script).toContain('pkill -f "$APPIMAGE_MOUNT_PATTERN"');
    expect(script).toContain('while [ "$i" -lt 10 ]');
    expect(script).toContain('pkill -KILL -f "$DEB_INSTALL_PATTERN"');
    expect(script).toContain('pkill -KILL -f "$APPIMAGE_MOUNT_PATTERN"');
    expect(script).toContain('exit 0');
  });
});
