import { LanguageSupport } from '@codemirror/language';
import { useEffect, useState } from 'react';

import { resolveLanguage } from './language';

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export function useIsDark() {
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains('dark'));
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains('dark'));
    });
    observer.observe(document.documentElement, { attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);
  return isDark;
}

export function useLanguageSupport(languageName: string | null): LanguageSupport | null {
  const [support, setSupport] = useState<LanguageSupport | null>(() => {
    if (!languageName) return null;
    const desc = resolveLanguage(languageName);
    return desc?.support ?? null;
  });

  useEffect(() => {
    if (!languageName) {
      setSupport(null);
      return;
    }
    let cancelled = false;
    const desc = resolveLanguage(languageName);
    if (!desc) {
      setSupport(null);
      return;
    }
    if (desc.support) {
      setSupport(desc.support);
      return;
    }
    desc.load().then(loaded => {
      if (!cancelled) setSupport(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [languageName]);

  return support;
}
