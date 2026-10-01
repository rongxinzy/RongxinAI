import { useRef } from 'react';

import {
  SettingsAnimatedBoxIcon,
  type SettingsAnimatedBoxIconHandle,
} from '../icons/SettingsAnimatedBoxIcon';
import {
  SidebarAnimatedUsersIcon,
  type SidebarAnimatedUsersIconHandle,
} from '../icons/SidebarAnimatedUsersIcon';
import { EnterpriseSettingsPageId } from './constants';

export function useEnterpriseSettingsNavigationIcons(tabForPage: (pageId: string) => string) {
  const accountRef = useRef<SidebarAnimatedUsersIconHandle>(null);
  const modelsRef = useRef<SettingsAnimatedBoxIconHandle>(null);

  return {
    refs: {
      [tabForPage(EnterpriseSettingsPageId.Account)]: accountRef,
      [tabForPage(EnterpriseSettingsPageId.Models)]: modelsRef,
    },
    iconForPage: (pageId: string) =>
      pageId === EnterpriseSettingsPageId.Models ? (
        <SettingsAnimatedBoxIcon ref={modelsRef} />
      ) : (
        <SidebarAnimatedUsersIcon ref={accountRef} />
      ),
  };
}
