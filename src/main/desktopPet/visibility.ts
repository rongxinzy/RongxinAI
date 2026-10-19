import { powerMonitor, type BrowserWindow } from 'electron';

import type { DesktopPetSettings } from '../../shared/desktopPet/types';

/** Uses Electron lifecycle events without polling or inspecting other applications. */
export function watchDesktopPetVisibility(window: BrowserWindow | null, changed: () => void) {
  let locked = powerMonitor.getSystemIdleState(1) === 'locked';
  let suspended = false;
  const lock = () => {
    locked = true;
    changed();
  };
  const unlock = () => {
    locked = false;
    changed();
  };
  const suspend = () => {
    suspended = true;
    changed();
  };
  const resume = () => {
    suspended = false;
    changed();
  };
  powerMonitor.on('lock-screen', lock);
  powerMonitor.on('unlock-screen', unlock);
  powerMonitor.on('suspend', suspend);
  powerMonitor.on('resume', resume);
  window?.on('enter-full-screen', changed);
  window?.on('leave-full-screen', changed);
  return {
    suppressed: (settings: DesktopPetSettings): boolean =>
      settings.doNotDisturb ||
      locked ||
      suspended ||
      Boolean(
        settings.hideInFullscreen && window && !window.isDestroyed() && window.isFullScreen(),
      ),
    dispose: () => {
      powerMonitor.removeListener('lock-screen', lock);
      powerMonitor.removeListener('unlock-screen', unlock);
      powerMonitor.removeListener('suspend', suspend);
      powerMonitor.removeListener('resume', resume);
      window?.removeListener('enter-full-screen', changed);
      window?.removeListener('leave-full-screen', changed);
    },
  };
}
