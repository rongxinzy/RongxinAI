import { Menu, type BrowserWindow } from 'electron';
import { DesktopPetPlayableAction } from '../../shared/desktopPet/constants';
import { t } from '../i18n';
import { openCompanionWindow } from '../companion/window';

export function showDesktopPetMenu(options: {
  pet: BrowserWindow;
  label: string;
  hasTask: boolean;
  openTask(): void;
  greet(): void;
  playAction(action: DesktopPetPlayableAction): void;
  reset(): void;
  hide(): void;
}): void {
  const { pet, label, hasTask, openTask, greet, playAction, reset, hide } = options;
  Menu.buildFromTemplate([
    { label, enabled: false },
    { type: 'separator' },
    { label: t(hasTask ? 'desktopPetOpenTask' : 'desktopPetOpen'), click: openTask },
    { label: t('companionTalk'), click: openCompanionWindow },
    { label: t('desktopPetGreet'), click: greet },
    {
      label: t('desktopPetActionPeek'),
      click: () => playAction(DesktopPetPlayableAction.Peek),
    },
    {
      label: t('desktopPetActionNod'),
      click: () => playAction(DesktopPetPlayableAction.Nod),
    },
    {
      label: t('desktopPetActionFlutter'),
      click: () => playAction(DesktopPetPlayableAction.Flutter),
    },
    { label: t('desktopPetReset'), click: reset },
    { type: 'separator' },
    { label: t('desktopPetHide'), click: hide },
  ]).popup({ window: pet });
}
