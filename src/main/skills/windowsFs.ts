import { spawn, spawnSync } from 'child_process';
import fs from 'fs';

export function isWindowsDeletePermissionError(error: unknown): boolean {
  if (process.platform !== 'win32') return false;
  if (!(error instanceof Error)) return false;
  const code = (error as NodeJS.ErrnoException).code;
  return code === 'EPERM' || code === 'EACCES' || code === 'EBUSY';
}

export function tryWindowsDeleteFallbackAsync(
  targetDir: string,
): Promise<{ success: boolean; detail?: string }> {
  if (process.platform !== 'win32')
    return Promise.resolve({ success: false, detail: 'not-windows' });

  return new Promise<void>(resolve => setTimeout(resolve, 50)).then(() => {
    const escapedPath = targetDir.replace(/"/g, '""');
    const command = `icacls "${escapedPath}" /reset /t /c >nul 2>&1 & attrib -r -s -h "${escapedPath}" /s /d >nul 2>&1 & rmdir /s /q "${escapedPath}"`;

    return new Promise<{ success: boolean; detail?: string }>(resolve => {
      let settled = false;
      const settle = (result: { success: boolean; detail?: string }) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };

      const child = spawn('cmd.exe', ['/d', '/s', '/c', command], {
        stdio: 'pipe',
        windowsHide: true,
      });

      let stderr = '';
      let stdout = '';
      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString('utf-8');
      });
      child.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString('utf-8');
      });

      const timer = setTimeout(() => {
        child.kill();
        settle({ success: false, detail: 'timeout' });
      }, 10000);

      child.on('close', () => {
        clearTimeout(timer);
        if (!fs.existsSync(targetDir)) {
          settle({ success: true });
        } else {
          const detail = stderr.trim() || stdout.trim() || 'unknown';
          settle({ success: false, detail });
        }
      });

      child.on('error', err => {
        clearTimeout(timer);
        settle({ success: false, detail: err.message });
      });
    });
  });
}

export function normalizeWindowsSkillDirectoryAttrs(targetDir: string): {
  success: boolean;
  detail?: string;
} {
  if (process.platform !== 'win32') return { success: true };

  const escapedPath = targetDir.replace(/"/g, '""');
  const result = spawnSync(
    'cmd.exe',
    ['/d', '/s', '/c', `attrib -r -s -h "${escapedPath}" /s /d`],
    {
      stdio: 'pipe',
      windowsHide: true,
      timeout: 10000,
    },
  );

  if (result.status === 0) {
    return { success: true };
  }

  const stderr = result.stderr?.toString('utf-8').trim();
  const stdout = result.stdout?.toString('utf-8').trim();
  const detail = stderr || stdout || result.error?.message || `status=${result.status ?? 'null'}`;
  return { success: false, detail };
}

export function cleanupPathSafely(targetPath: string | null): void {
  if (!targetPath) return;
  try {
    fs.rmSync(targetPath, {
      recursive: true,
      force: true,
      maxRetries: process.platform === 'win32' ? 5 : 0,
      retryDelay: process.platform === 'win32' ? 200 : 0,
    });
  } catch (error) {
    console.warn('[skills] Failed to cleanup temporary directory:', targetPath, error);
  }
}
