import React from 'react';

import { AppUpdateStatus } from '../../../shared/appUpdate/constants';
import { useAppUpdateState } from '../../app/useAppUpdateState';
import AppUpdateBadge from './AppUpdateBadge';

interface AppUpdateSidebarEntryProps {
  collapsed: boolean;
  onOpenAbout: () => void;
}

/**
 * Sidebar update entry. It subscribes to the update store itself so download
 * progress does not re-render the App shell.
 */
const AppUpdateSidebarEntry: React.FC<AppUpdateSidebarEntryProps> = ({
  collapsed,
  onOpenAbout,
}) => {
  const state = useAppUpdateState();
  const info = state.info;
  if (collapsed || !info) return null;
  const visible =
    state.status === AppUpdateStatus.Ready ||
    state.status === AppUpdateStatus.Error ||
    state.status === AppUpdateStatus.Downloading ||
    state.status === AppUpdateStatus.Verifying ||
    (state.status === AppUpdateStatus.Available && info.manualDownloadOnly);
  if (!visible) return null;
  return (
    <AppUpdateBadge
      latestVersion={info.latestVersion}
      status={state.status}
      onClick={onOpenAbout}
    />
  );
};

export default AppUpdateSidebarEntry;
