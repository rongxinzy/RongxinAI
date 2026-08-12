import React, { useEffect, useMemo, useState } from 'react';

import { i18nService } from '../../services/i18n';

/** Custom shield-check glyph, drawn in the same family as the plus-menu icons. */
const GuardShieldIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
    className={className}
  >
    <path d="M8 1.7l5.2 2v4.1c0 3.3-2.2 5.4-5.2 6.6-3-1.2-5.2-3.3-5.2-6.6V3.7z" />
    <path d="M5.7 7.5l1.7 1.7 3.1-3.3" />
  </svg>
);

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
  // typedLength must be a dependency so the effect re-runs after each tick.
  useEffect(() => {
    if (reducedMotion) return;
    if (isTyping) {
      const timer = window.setTimeout(() => setTypedLength(len => len + 1), TYPE_INTERVAL_MS);
      return () => window.clearTimeout(timer);
    }
    const holdTimer = window.setTimeout(() => setIsFadingOut(true), HOLD_MS);
    return () => window.clearTimeout(holdTimer);
  }, [isTyping, typedLength, reducedMotion]);

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
      <GuardShieldIcon className="h-3.5 w-3.5 shrink-0 text-success" />
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
