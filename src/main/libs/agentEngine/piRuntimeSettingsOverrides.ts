/** In-memory Pi settings plus application transport and platform tool defaults. */

import { applyPiEmbeddedHttpIdleTimeout } from './piHttpIdleTimeout';
import { type PiModules, type PiSettingsManager } from './piRuntimeSessionState';

export function applyPiPlatformToolOverrides(
  settingsManager: PiSettingsManager | null,
  platform: NodeJS.Platform = process.platform,
): void {
  if (!settingsManager || platform !== 'win32') return;
  // Windows uses Pi's native PowerShell tool instead of Git Bash.
  settingsManager.applyOverrides({
    defaultTools: ['read', 'powershell', 'edit', 'write'],
  });
}

export function createPiSettingsManager(pi: PiModules, cwd: string): PiSettingsManager | null {
  if (!pi.SettingsManager) return null;
  // Cowork owns its runtime configuration. Loading Pi's user/project settings here can
  // trigger package installation or third-party extensions that differ between machines.
  const settingsManager =
    pi.SettingsManager.inMemory?.() ?? pi.SettingsManager.create(cwd, pi.getAgentDir());
  applyPiEmbeddedHttpIdleTimeout(settingsManager);
  applyPiPlatformToolOverrides(settingsManager);
  return settingsManager;
}
