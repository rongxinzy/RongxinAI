import React, { useEffect, useMemo, useState } from 'react';
import { ShieldCheck } from 'lucide-react';

import { i18nService } from '../../services/i18n';

const PHRASE_KEYS = [
  'securityPhraseGuard',
  'securityPhraseSkillScan',
  'securityPhraseCommandBlock',
  'securityPhraseApproval',
  'securityPhraseLocalWatch',
] as const;

const HOLD_MS = 3200;
const FADE_OUT_MS = 180;

const useReducedMotionPreference = (): boolean => {
  const [reduced, setReduced] = useState(
    () =>
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handleChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    setReduced(mediaQuery.matches);
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);
  return reduced;
};

/** Tracks document visibility so the phrase cycle pauses while hidden. */
const useDocumentVisible = (): boolean => {
  const [visible, setVisible] = useState(
    () => typeof document === 'undefined' || document.visibilityState !== 'hidden',
  );
  useEffect(() => {
    const handleVisibilityChange = () => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);
  return visible;
};

/**
 * Security status in the title bar: cycles through localized security phrases
 * with a subtle 180ms fade transition. Falls back to the first static phrase
 * when reduced motion is requested.
 */
const SecurityStatusIndicator: React.FC = () => {
  const [phrases, setPhrases] = useState(() => PHRASE_KEYS.map(key => i18nService.t(key)));
  const reducedMotion = useReducedMotionPreference();
  const documentVisible = useDocumentVisible();
  const [phraseIndex, setPhraseIndex] = useState(0);
  const [isFadingOut, setIsFadingOut] = useState(false);

  useEffect(() => {
    setPhrases(PHRASE_KEYS.map(key => i18nService.t(key)));
    return i18nService.subscribe(() => {
      setPhrases(PHRASE_KEYS.map(key => i18nService.t(key)));
    });
  }, []);

  const paused = reducedMotion || !documentVisible;

  useEffect(() => {
    if (paused || isFadingOut) return;
    const holdTimer = window.setTimeout(() => setIsFadingOut(true), HOLD_MS);
    return () => window.clearTimeout(holdTimer);
  }, [paused, isFadingOut, phraseIndex]);

  useEffect(() => {
    if (!isFadingOut || paused) return;
    const timer = window.setTimeout(() => {
      setIsFadingOut(false);
      setPhraseIndex(index => (index + 1) % phrases.length);
    }, FADE_OUT_MS);
    return () => window.clearTimeout(timer);
  }, [isFadingOut, phrases.length, paused]);

  // Reserve the width of the longest phrase so the header doesn't jitter.
  const minWidthEm = useMemo(
    () => Math.max(...phrases.map(phrase => phrase.length)) + 1,
    [phrases],
  );

  const text = reducedMotion ? phrases[0] : (phrases[phraseIndex] ?? phrases[0]);

  return (
    <div className="flex items-center gap-1.5 mr-2 px-2.5 py-1">
      <ShieldCheck className="theme-home-status-icon shrink-0" aria-hidden />
      <span
        className={`theme-home-status whitespace-nowrap ${isFadingOut && !reducedMotion ? 'theme-home-status-fading' : ''}`}
        style={{ minWidth: `${minWidthEm}em` }}
      >
        {text}
      </span>
    </div>
  );
};

export default SecurityStatusIndicator;
