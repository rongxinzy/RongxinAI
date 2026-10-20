import React, { useEffect, useState } from 'react';

import { i18nService } from '../../services/i18n';

/**
 * Security status in the title bar: a static status line with a 6px dot.
 * v4: no cycling phrases — the status is quiet and stable.
 */
const SecurityStatusIndicator: React.FC = () => {
  const [text, setText] = useState(() => i18nService.t('securityPhraseGuard'));

  useEffect(
    () =>
      i18nService.subscribe(() => {
        setText(i18nService.t('securityPhraseGuard'));
      }),
    [],
  );

  return (
    <div className="flex items-center gap-1.5 mr-2 px-2.5 py-1">
      <span className="size-1.5 shrink-0 rounded-full bg-success" aria-hidden />
      <span className="theme-home-status whitespace-nowrap">{text}</span>
    </div>
  );
};

export default SecurityStatusIndicator;
