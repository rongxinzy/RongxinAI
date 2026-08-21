import { type RefObject, useEffect, useRef } from 'react';

const COWORK_COMPOSER_INSET_PROPERTY = '--cowork-composer-inset';

export const COWORK_COMPOSER_INSET_VALUE = `var(${COWORK_COMPOSER_INSET_PROPERTY}, 8rem)`;

export function useCoworkComposerInset(
  rootRef: RefObject<HTMLElement | null>,
): RefObject<HTMLDivElement | null> {
  const composerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    const composer = composerRef.current;
    if (!root || !composer) return undefined;

    const updateInset = () => {
      const height = Math.ceil(composer.getBoundingClientRect().height);
      root.style.setProperty(COWORK_COMPOSER_INSET_PROPERTY, `${height}px`);
    };

    updateInset();

    const resizeObserver =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateInset);
    resizeObserver?.observe(composer);

    return () => {
      resizeObserver?.disconnect();
      root.style.removeProperty(COWORK_COMPOSER_INSET_PROPERTY);
    };
  }, [rootRef]);

  return composerRef;
}
