import { CoworkPermissionMode } from '@shared/cowork/constants';
import React from 'react';

import { i18nService } from '../../services/i18n';

interface SecurityStatusIndicatorProps {
  permissionMode?: CoworkPermissionMode;
}

/**
 * Title-bar status slot: one current, user-readable state with a 6px dot.
 * It reflects the saved permission mode instead of cycling marketing phrases.
 */
const SecurityStatusIndicator: React.FC<SecurityStatusIndicatorProps> = ({ permissionMode }) => {
  const allowAll = permissionMode === CoworkPermissionMode.AllowAll;
  const label = i18nService.t(allowAll ? 'permissionModeAllowAll' : 'securityStatusLocalSafe');
  const description = i18nService.t(
    allowAll ? 'permissionModeAllowAllDescription' : 'securityStatusLocalSafeDescription',
  );

  return (
    <div className="flex items-center gap-1.5 mr-2 px-2" title={description}>
      <span
        className={
          allowAll ? 'theme-shell-status-dot-warning shrink-0' : 'theme-shell-status-dot shrink-0'
        }
        aria-hidden="true"
      />
      <span className="theme-home-status whitespace-nowrap">{label}</span>
    </div>
  );
};

export default SecurityStatusIndicator;
