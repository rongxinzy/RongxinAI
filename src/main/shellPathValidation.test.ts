import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  isAllowedShellOpenPath,
  isAllowedShellProbePath,
  isPathInsideRoot,
  isSensitivePath,
} from './shellPathValidation';

describe('shellPathValidation', () => {
  const allowedWorkspace = path.resolve('/workspace/my-project');
  const allowedUserData = path.resolve('/data/app-userdata');
  const allowedRoots = [allowedWorkspace, allowedUserData];

  describe('isPathInsideRoot', () => {
    it('returns true when target is identical or child of root', () => {
      expect(isPathInsideRoot(allowedWorkspace, allowedWorkspace)).toBe(true);
      expect(
        isPathInsideRoot(path.join(allowedWorkspace, 'src', 'index.ts'), allowedWorkspace),
      ).toBe(true);
    });

    it('returns false when target is outside root', () => {
      expect(isPathInsideRoot('/other/dir/file.txt', allowedWorkspace)).toBe(false);
      expect(
        isPathInsideRoot(path.join(allowedWorkspace, '..', 'escape.txt'), allowedWorkspace),
      ).toBe(false);
    });
  });

  describe('isSensitivePath', () => {
    it('detects sensitive paths and credentials', () => {
      expect(isSensitivePath('/home/user/.ssh/id_rsa')).toBe(true);
      expect(isSensitivePath('C:\\Users\\user\\.aws\\credentials')).toBe(true);
      expect(isSensitivePath('/var/data/.env')).toBe(true);
      expect(isSensitivePath('/etc/passwd')).toBe(true);
      expect(isSensitivePath('C:\\Windows\\System32\\cmd.exe')).toBe(true);
      expect(isSensitivePath('/workspace/project/zhiyuan.sqlite')).toBe(true);
    });

    it('returns false for normal paths', () => {
      expect(isSensitivePath('/workspace/project/src/index.ts')).toBe(false);
      expect(isSensitivePath('/data/notes.md')).toBe(false);
    });
  });

  describe('isAllowedShellProbePath', () => {
    it('permits probing inside allowed roots', () => {
      const target = path.join(allowedWorkspace, 'src', 'App.tsx');
      expect(isAllowedShellProbePath(target, allowedRoots)).toBe(true);
    });

    it('rejects probing outside allowed roots', () => {
      expect(isAllowedShellProbePath('/etc/hosts', allowedRoots)).toBe(false);
      expect(isAllowedShellProbePath('/Users/other/.bashrc', allowedRoots)).toBe(false);
    });

    it('rejects sensitive files even if inside allowed root', () => {
      const gitDir = path.join(allowedWorkspace, '.git', 'config');
      expect(isAllowedShellProbePath(gitDir, allowedRoots)).toBe(false);

      const envFile = path.join(allowedWorkspace, '.env');
      expect(isAllowedShellProbePath(envFile, allowedRoots)).toBe(false);
    });

    it('rejects illegal, null byte, or malformed paths', () => {
      expect(isAllowedShellProbePath('', allowedRoots)).toBe(false);
      expect(isAllowedShellProbePath('   ', allowedRoots)).toBe(false);
      expect(isAllowedShellProbePath('/valid/path\0something', allowedRoots)).toBe(false);
      expect(isAllowedShellProbePath('a'.repeat(2000), allowedRoots)).toBe(false);
    });
  });

  describe('isAllowedShellOpenPath', () => {
    it('permits opening safe document and code files', () => {
      expect(isAllowedShellOpenPath('/workspace/report.pdf').allowed).toBe(true);
      expect(isAllowedShellOpenPath('/workspace/src/App.tsx').allowed).toBe(true);
      expect(isAllowedShellOpenPath('/workspace/image.png').allowed).toBe(true);
    });

    it('blocks dangerous executable files', () => {
      const exe = isAllowedShellOpenPath('/workspace/payload.exe');
      expect(exe.allowed).toBe(false);
      expect(exe.reason).toContain('blocked for security');

      const bat = isAllowedShellOpenPath('/workspace/script.bat');
      expect(bat.allowed).toBe(false);

      const cmd = isAllowedShellOpenPath('C:\\tools\\run.cmd');
      expect(cmd.allowed).toBe(false);

      const ps1 = isAllowedShellOpenPath('/workspace/deploy.ps1');
      expect(ps1.allowed).toBe(false);
    });

    it('blocks sensitive system paths', () => {
      const ssh = isAllowedShellOpenPath('/home/user/.ssh/id_rsa');
      expect(ssh.allowed).toBe(false);
      expect(ssh.reason).toContain('sensitive');
    });

    it('blocks illegal characters', () => {
      expect(isAllowedShellOpenPath('/path\0bad').allowed).toBe(false);
    });
  });
});
