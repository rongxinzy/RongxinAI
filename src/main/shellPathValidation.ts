import path from 'node:path';

export const SENSITIVE_PATH_PATTERNS = [
  '/.ssh/',
  '/.ssh',
  '/.gnupg/',
  '/.gnupg',
  '/.aws/',
  '/.aws',
  '/.env',
  '/.git/',
  '/.git',
  'node_modules',
  'zhiyuan.sqlite',
  'zhiyuan.sqlite-wal',
  'zhiyuan.sqlite-shm',
  '/etc/passwd',
  '/etc/shadow',
  '/private/etc',
  '/dev/',
  '/proc/',
  '/sys/',
  'windows/system32',
  'windows/syswow64',
];

export const DANGEROUS_EXEC_EXTENSIONS = new Set([
  '.exe',
  '.bat',
  '.cmd',
  '.com',
  '.scr',
  '.vbs',
  '.vbe',
  '.js',
  '.jse',
  '.wsf',
  '.wsh',
  '.ps1',
  '.ps1xml',
  '.ps2',
  '.ps2xml',
  '.psc1',
  '.psc2',
  '.msh',
  '.msh1',
  '.msh2',
  '.mshxml',
  '.msh1xml',
  '.msh2xml',
  '.scf',
  '.lnk',
  '.inf',
  '.reg',
]);

export function isPathInsideRoot(target: string, root: string): boolean {
  const normalizedTarget = path.resolve(target);
  const normalizedRoot = path.resolve(root);
  const relative = path.relative(normalizedRoot, normalizedTarget);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function isSensitivePath(targetPath: string): boolean {
  const posixPath = path.resolve(targetPath).replace(/\\/g, '/').toLowerCase();
  for (const pattern of SENSITIVE_PATH_PATTERNS) {
    if (posixPath.includes(pattern)) {
      return true;
    }
  }
  return false;
}

/**
 * 校验路径是否允许被渲染进程通过 ShellIpc.PathExists 进行存在性探测。
 *
 * 规则：
 * 1. 路径必须是非空字符串，长度不超过 1024，不含 null byte 或不可见换行符。
 * 2. 严禁命中敏感路径（凭据、系统敏感配置等）。
 * 3. 必须位于受信任的根目录列表之一（例如活跃工作区、应用工作区、UserData、Documents、Downloads 等）。
 */
export function isAllowedShellProbePath(candidatePath: string, allowedRoots: string[]): boolean {
  if (typeof candidatePath !== 'string' || !candidatePath.trim()) {
    return false;
  }
  if (candidatePath.length > 1024 || candidatePath.includes('\0') || /[\r\n]/.test(candidatePath)) {
    return false;
  }

  const resolved = path.resolve(candidatePath);
  if (isSensitivePath(resolved)) {
    return false;
  }

  if (!allowedRoots || allowedRoots.length === 0) {
    return false;
  }

  return allowedRoots.some(root => isPathInsideRoot(resolved, root));
}

/**
 * 校验路径是否允许被 ShellIpc.OpenPath 直接打开。
 * 对危险可执行脚本进行拦截，避免通过点击链接触发意外执行。
 */
export function isAllowedShellOpenPath(filePath: string): { allowed: boolean; reason?: string } {
  if (typeof filePath !== 'string' || !filePath.trim()) {
    return { allowed: false, reason: 'Invalid file path' };
  }
  if (filePath.length > 1024 || filePath.includes('\0') || /[\r\n]/.test(filePath)) {
    return { allowed: false, reason: 'Path contains illegal characters' };
  }

  const resolved = path.resolve(filePath);
  if (isSensitivePath(resolved)) {
    return { allowed: false, reason: 'Access to sensitive system paths is blocked' };
  }

  const ext = path.extname(resolved).toLowerCase();
  if (DANGEROUS_EXEC_EXTENSIONS.has(ext)) {
    return {
      allowed: false,
      reason: `Opening executable files with extension '${ext}' is blocked for security`,
    };
  }

  return { allowed: true };
}
