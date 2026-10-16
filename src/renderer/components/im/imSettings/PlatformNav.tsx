/**
 * Left-side platform navigation for the IM settings view.
 *
 * Extracted from IMSettings.tsx (issue #1069). The per-platform theme class
 * variants must stay exactly as they were; they are keyed by platform in
 * NAV_ITEM_VARIANTS below.
 */
import { Button } from '@shared/components/ui/button';
import { Switch } from '@shared/components/ui/switch';
import { cn } from '@shared/lib/utils';
import type { Platform } from '@shared/platform';
import { ChevronDown, ChevronRight } from 'lucide-react';
import React from 'react';

import { imPlatformLogo } from '../../../assets/imLogos';
import { i18nService } from '../../../services/i18n';
import type { IMGatewayConfig, IMGatewayStatus } from '../../../types/im';
import {
  getNavInstances,
  getNavInstanceStatuses,
  isMultiInstancePlatform,
  type IMNavInstance,
  type IMNavInstanceStatus,
  type MultiInstancePlatform,
} from './platformStatus';

interface NavVariantClasses {
  header: { base: string; active: string; inactive: string };
  item: { base: string; selected: string; unselected: string };
}

/** Per-platform logo alt text and theme button variants (keep in sync with themes). */
const NAV_ITEM_VARIANTS: Record<MultiInstancePlatform, { logoAlt: string } & NavVariantClasses> = {
  dingtalk: {
    logoAlt: 'DingTalk',
    header: {
      base: 'theme-page-imsettings-button-variant-1 w-full justify-start',
      active: 'theme-page-imsettings-button-variant-2',
      inactive: 'theme-page-imsettings-button-variant-3',
    },
    item: {
      base: 'theme-page-imsettings-button-variant-4 w-full justify-start',
      selected: 'theme-page-imsettings-button-variant-5',
      unselected: 'theme-page-imsettings-button-variant-6',
    },
  },
  feishu: {
    logoAlt: 'Feishu',
    header: {
      base: 'theme-page-imsettings-button-variant-7 w-full justify-start',
      active: 'theme-page-imsettings-button-variant-8',
      inactive: 'theme-page-imsettings-button-variant-9',
    },
    item: {
      base: 'theme-page-imsettings-button-variant-10 w-full justify-start',
      selected: 'theme-page-imsettings-button-variant-11',
      unselected: 'theme-page-imsettings-button-variant-12',
    },
  },
  qq: {
    logoAlt: 'QQ',
    header: {
      base: 'theme-page-imsettings-button-variant-13 w-full justify-start',
      active: 'theme-page-imsettings-button-variant-14',
      inactive: 'theme-page-imsettings-button-variant-15',
    },
    item: {
      base: 'theme-page-imsettings-button-variant-16 w-full justify-start',
      selected: 'theme-page-imsettings-button-variant-17',
      unselected: 'theme-page-imsettings-button-variant-18',
    },
  },
  wecom: {
    logoAlt: 'WeCom',
    header: {
      base: 'theme-page-imsettings-button-variant-19 w-full justify-start',
      active: 'theme-page-imsettings-button-variant-20',
      inactive: 'theme-page-imsettings-button-variant-21',
    },
    item: {
      base: 'theme-page-imsettings-button-variant-22 w-full justify-start',
      selected: 'theme-page-imsettings-button-variant-23',
      unselected: 'theme-page-imsettings-button-variant-24',
    },
  },
  telegram: {
    logoAlt: 'Telegram',
    header: {
      base: 'theme-page-imsettings-button-variant-25 w-full justify-start',
      active: 'theme-page-imsettings-button-variant-26',
      inactive: 'theme-page-imsettings-button-variant-27',
    },
    item: {
      base: 'theme-page-imsettings-button-variant-28 w-full justify-start',
      selected: 'theme-page-imsettings-button-variant-29',
      unselected: 'theme-page-imsettings-button-variant-30',
    },
  },
  discord: {
    logoAlt: 'Discord',
    header: {
      base: 'theme-page-imsettings-button-variant-31 w-full justify-start',
      active: 'theme-page-imsettings-button-variant-32',
      inactive: 'theme-page-imsettings-button-variant-33',
    },
    item: {
      base: 'theme-page-imsettings-button-variant-34 w-full justify-start',
      selected: 'theme-page-imsettings-button-variant-35',
      unselected: 'theme-page-imsettings-button-variant-36',
    },
  },
};

interface MultiInstanceNavItemProps {
  platform: MultiInstancePlatform;
  label: string;
  logoAlt: string;
  active: boolean;
  expanded: boolean;
  instances: IMNavInstance[];
  instanceStatuses: IMNavInstanceStatus[] | undefined;
  activeInstanceId: string | null;
  headerClasses: NavVariantClasses['header'];
  itemClasses: NavVariantClasses['item'];
  onHeaderClick: () => void;
  onInstanceClick: (instanceId: string) => void;
}

/** Expandable platform header plus its instance sub-items. */
const MultiInstanceNavItem: React.FC<MultiInstanceNavItemProps> = ({
  platform,
  label,
  logoAlt,
  active,
  expanded,
  instances,
  instanceStatuses,
  activeInstanceId,
  headerClasses,
  itemClasses,
  onHeaderClick,
  onInstanceClick,
}) => (
  <div key={platform}>
    {/* Platform Header - clickable to expand/collapse */}
    <Button
      type="button"
      variant="ghost"
      onClick={onHeaderClick}
      className={cn(headerClasses.base, active ? headerClasses.active : headerClasses.inactive)}
    >
      <div className="flex flex-1 items-center">
        <div className="mr-2 flex size-7 items-center justify-center">
          <img
            src={imPlatformLogo(platform)}
            alt={logoAlt}
            className="size-6 object-contain rounded-md"
          />
        </div>
        <span className="truncate text-sm font-medium">{label}</span>
      </div>
      {expanded ? <ChevronDown data-icon="inline-end" /> : <ChevronRight data-icon="inline-end" />}
    </Button>
    {/* Instance Sub-items */}
    {expanded && (
      <div className="ml-5 mt-1 flex flex-col gap-1">
        {instances.map(inst => {
          const instStatus = instanceStatuses?.find(s => s.instanceId === inst.instanceId);
          const isSelected = active && activeInstanceId === inst.instanceId;
          const dotColor = !inst.enabled
            ? 'bg-muted-foreground'
            : instStatus?.connected
              ? 'bg-success'
              : 'bg-warning';
          return (
            <Button
              type="button"
              variant="ghost"
              key={inst.instanceId}
              onClick={() => onInstanceClick(inst.instanceId)}
              className={cn(
                itemClasses.base,
                isSelected ? itemClasses.selected : itemClasses.unselected,
              )}
            >
              <span className={cn('mr-2 size-2 shrink-0 rounded-full', dotColor)} />
              <span className="flex-1 truncate">{inst.instanceName}</span>
            </Button>
          );
        })}
      </div>
    )}
  </div>
);

export interface IMPlatformNavProps {
  platforms: Platform[];
  activePlatform: Platform;
  config: IMGatewayConfig;
  status: IMGatewayStatus;
  navExpanded: Record<MultiInstancePlatform, boolean>;
  activeInstanceIds: Record<MultiInstancePlatform, string | null>;
  togglingPlatform: Platform | null;
  isEnabled: (platform: Platform) => boolean;
  canStart: (platform: Platform) => boolean;
  onSelectPlatform: (platform: Platform) => void;
  onToggleMultiInstanceHeader: (platform: MultiInstancePlatform) => void;
  onSelectInstance: (platform: MultiInstancePlatform, instanceId: string) => void;
  onPlatformToggle: (platform: Platform) => void;
}

export const IMPlatformNav: React.FC<IMPlatformNavProps> = ({
  platforms,
  activePlatform,
  config,
  status,
  navExpanded,
  activeInstanceIds,
  togglingPlatform,
  isEnabled,
  canStart,
  onSelectPlatform,
  onToggleMultiInstanceHeader,
  onSelectInstance,
  onPlatformToggle,
}) => (
  <div className="w-48 shrink-0 border-r border-border pr-3 flex flex-col gap-2 overflow-y-auto">
    {platforms.map(platform => {
      const logo = imPlatformLogo(platform);
      const platformEnabled = isEnabled(platform);
      const canToggle = platformEnabled || canStart(platform);

      if (isMultiInstancePlatform(platform)) {
        const variants = NAV_ITEM_VARIANTS[platform];
        return (
          <MultiInstanceNavItem
            key={platform}
            platform={platform}
            label={i18nService.t(platform)}
            logoAlt={variants.logoAlt}
            active={activePlatform === platform}
            expanded={navExpanded[platform]}
            instances={getNavInstances(config, platform)}
            instanceStatuses={getNavInstanceStatuses(status, platform)}
            activeInstanceId={activeInstanceIds[platform]}
            headerClasses={variants.header}
            itemClasses={variants.item}
            onHeaderClick={() => onToggleMultiInstanceHeader(platform)}
            onInstanceClick={instanceId => onSelectInstance(platform, instanceId)}
          />
        );
      }

      return (
        <div
          key={platform}
          className={cn(
            'flex items-center rounded-lg border transition-colors',
            activePlatform === platform
              ? 'border-primary bg-primary-muted'
              : 'border-transparent bg-surface hover:bg-surface-raised',
          )}
        >
          <Button
            type="button"
            variant="ghost"
            onClick={() => onSelectPlatform(platform)}
            aria-current={activePlatform === platform ? 'page' : undefined}
            className="theme-control-sizing-17 theme-control-content-height min-w-0 flex-1 justify-start"
          >
            <span className="mr-2 flex size-7 items-center justify-center">
              <img
                src={logo}
                alt={i18nService.t(platform)}
                className="size-6 rounded-md object-contain"
              />
            </span>
            <span className="truncate text-sm font-medium">{i18nService.t(platform)}</span>
          </Button>
          <Switch
            className="mr-2"
            checked={platformEnabled}
            disabled={!canToggle || togglingPlatform === platform}
            aria-label={`${i18nService.t(platform)} ${i18nService.t('enabled')}`}
            onCheckedChange={() => onPlatformToggle(platform)}
          />
        </div>
      );
    })}
  </div>
);
