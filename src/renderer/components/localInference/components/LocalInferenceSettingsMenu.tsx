import { Button } from '@shared/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@shared/components/ui/dropdown-menu';
import { useReducedMotion } from 'motion/react';
import React, { useCallback, useRef } from 'react';

import { i18nService } from '../../../services/i18n';
import { GalleryThumbnailsIcon } from '../../icons/GalleryThumbnailsIcon';
import { LocalInferenceAnimatedFolderDownIcon } from '../../icons/LocalInferenceAnimatedFolderDownIcon';
import { LocalInferenceAnimatedWifiPenIcon } from '../../icons/LocalInferenceAnimatedWifiPenIcon';
import { SettingsAnimatedSlidersHorizontalIcon } from '../../icons/SettingsAnimatedSlidersHorizontalIcon';
import { SidebarAnimatedCpuIcon } from '../../icons/SidebarAnimatedCpuIcon';
import { localInferenceCompactButtonClass } from '../constants';

type AnimatedIconHandle = {
  startAnimation: () => void;
  stopAnimation: () => void;
};

type LocalInferenceSettingsMenuProps = {
  onOpenRuntimeSettings: () => void;
  onOpenAccessSettings: () => void;
  onOpenMemorySettings: () => void;
  onOpenLibrarySettings: () => void;
};

/** The settings dropdown on the local inference page header. */
export const LocalInferenceSettingsMenu: React.FC<LocalInferenceSettingsMenuProps> = ({
  onOpenRuntimeSettings,
  onOpenAccessSettings,
  onOpenMemorySettings,
  onOpenLibrarySettings,
}) => {
  const prefersReducedMotion = useReducedMotion();
  const runtimeSettingsIconRef = useRef<AnimatedIconHandle>(null);
  const accessSettingsIconRef = useRef<AnimatedIconHandle>(null);
  const memorySettingsIconRef = useRef<AnimatedIconHandle>(null);
  const librarySettingsIconRef = useRef<AnimatedIconHandle>(null);
  const startMenuIconAnimation = useCallback(
    (iconRef: React.RefObject<AnimatedIconHandle | null>) => {
      if (!prefersReducedMotion) iconRef.current?.startAnimation();
    },
    [prefersReducedMotion],
  );
  const stopMenuIconAnimation = useCallback(
    (iconRef: React.RefObject<AnimatedIconHandle | null>) => {
      iconRef.current?.stopAnimation();
    },
    [],
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="outline"
            className={`${localInferenceCompactButtonClass} theme-page-local-inference-view-button-variant-1`}
            size="sm"
          >
            <SettingsAnimatedSlidersHorizontalIcon className="size-4" size={16} />
            <span>{i18nService.t('localInferenceSettings')}</span>
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="min-w-32">
        <DropdownMenuItem
          onClick={onOpenRuntimeSettings}
          onFocus={() => startMenuIconAnimation(runtimeSettingsIconRef)}
          onMouseEnter={() => startMenuIconAnimation(runtimeSettingsIconRef)}
          onMouseLeave={() => stopMenuIconAnimation(runtimeSettingsIconRef)}
        >
          <SidebarAnimatedCpuIcon ref={runtimeSettingsIconRef} />
          {i18nService.t('localInferenceRuntimeSettings')}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={onOpenAccessSettings}
          onFocus={() => startMenuIconAnimation(accessSettingsIconRef)}
          onMouseEnter={() => startMenuIconAnimation(accessSettingsIconRef)}
          onMouseLeave={() => stopMenuIconAnimation(accessSettingsIconRef)}
        >
          <LocalInferenceAnimatedWifiPenIcon ref={accessSettingsIconRef} />
          {i18nService.t('localInferenceAccessMenuItem')}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={onOpenMemorySettings}
          onFocus={() => startMenuIconAnimation(memorySettingsIconRef)}
          onMouseEnter={() => startMenuIconAnimation(memorySettingsIconRef)}
          onMouseLeave={() => stopMenuIconAnimation(memorySettingsIconRef)}
        >
          <GalleryThumbnailsIcon ref={memorySettingsIconRef} />
          {i18nService.t('localInferenceMemoryMenuItem')}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={onOpenLibrarySettings}
          onFocus={() => startMenuIconAnimation(librarySettingsIconRef)}
          onMouseEnter={() => startMenuIconAnimation(librarySettingsIconRef)}
          onMouseLeave={() => stopMenuIconAnimation(librarySettingsIconRef)}
        >
          <LocalInferenceAnimatedFolderDownIcon ref={librarySettingsIconRef} />
          {i18nService.t('localInferenceLibraryMenuItem')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
