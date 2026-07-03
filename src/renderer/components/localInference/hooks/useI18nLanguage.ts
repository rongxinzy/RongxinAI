import { useEffect, useState } from 'react';

import { i18nService } from '../../../services/i18n';

export function useI18nLanguage(): ReturnType<typeof i18nService.getLanguage> {
  const [language, setLanguage] = useState(i18nService.getLanguage());

  useEffect(() => {
    return i18nService.subscribe(() => {
      setLanguage(i18nService.getLanguage());
    });
  }, []);

  return language;
}

