import { ShieldCheck } from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';

import { i18nService } from '../../services/i18n';

const PHRASE_KEYS = [
  'securityPhraseGuard',
  'securityPhraseSkillScan',
  'securityPhraseCommandBlock',
  'securityPhraseApproval',
  'securityPhraseLocalWatch',
] as const;

const TYPE_INTERVAL_MS = 55;
const HOLD_MS = 3200;
const FADE_OUT_MS = 180;

const prefersReducedMotion = (): boolean =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Security status in the title bar: cycles through security-related phrases
 * with a typewriter effect (type in → hold → fade to next), so the indicator
 * reads as an active guard rather than a static label. Falls back to the
 * first static phrase when reduced motion is requested.
 */
const SecurityStatusIndicator: React.FC = () => {
  const phrases = useMemo(() => PHRASE_KEYS.map(key => i18nService.t(key)), []);
  const [reducedMotion] = useState(prefersReducedMotion);
  const [phraseIndex, setPhraseIndex] = useState(0);
  const [typedLength, setTypedLength] = useState(0);
  const [isFadingOut, setIsFadingOut] = useState(false);

  const currentPhrase = phrases[phraseIndex];
  const isTyping = typedLength < currentPhrase.length;

  // Type the current phrase character by character, then hold.
  useEffect(() => {
    if (reducedMotion) return;
    if (isTyping) {
      const timer = window.setTimeout(() => setTypedLength(len => len + 1), TYPE_INTERVAL_MS);
      return () => window.clearTimeout(timer);
    }
    const holdTimer = window.setTimeout(() => setIsFadingOut(true), HOLD_MS);
    return () => window.clearTimeout(holdTimer);
  }, [isTyping, reducedMotion]);

  // After the fade-out, advance to the next phrase and start typing again.
  useEffect(() => {
    if (!isFadingOut) return;
    const timer = window.setTimeout(() => {
      setIsFadingOut(false);
      setTypedLength(0);
      setPhraseIndex(index => (index + 1) % phrases.length);
    }, FADE_OUT_MS);
    return () => window.clearTimeout(timer);
  }, [isFadingOut, phrases.length]);

  // Reserve the width of the longest phrase so the header doesn't jitter.
  const minWidthEm = useMemo(
    () => Math.max(...phrases.map(phrase => phrase.length)) + 1,
    [phrases],
  );

  const text = reducedMotion ? phrases[0] : currentPhrase.slice(0, typedLength);

  return (
    <div className="flex items-center gap-1.5 mr-2 px-2.5 py-1">
      <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-success" />
      <span
        className={`whitespace-nowrap text-xs text-success transition-opacity duration-200 ${isFadingOut ? 'opacity-0' : 'opacity-100'}`}
        style={{ minWidth: `${minWidthEm}em` }}
      >
        {text}
        {!reducedMotion && (
          <span className="animate-pulse" aria-hidden>
            {isTyping ? '▏' : ''}
          </span>
        )}
      </span>
    </div>
  );
};

export default SecurityStatusIndicator;
