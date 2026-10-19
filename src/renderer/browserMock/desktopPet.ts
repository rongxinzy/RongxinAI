import { DESKTOP_PET_DEFAULT_SETTINGS } from '../../shared/desktopPet/constants';
import type { DesktopPetApi, DesktopPetSettings } from '../../shared/desktopPet/types';
import type { BrowserMockRuntime } from './runtime';

export function createDesktopPetPreview(runtime: BrowserMockRuntime): Partial<DesktopPetApi> {
  let settings: DesktopPetSettings = { ...DESKTOP_PET_DEFAULT_SETTINGS };
  return {
    getSettings: () => Promise.resolve({ ...settings }),
    setSettings: patch => {
      settings = { ...settings, ...patch };
      runtime.emit('desktopPet.onSettingsChanged', { ...settings });
      return Promise.resolve({ ...settings });
    },
    getPendingTask: () => Promise.resolve(null),
    resolveTask: () => Promise.resolve(),
  };
}
