import { useId } from 'react';

interface LogoLoadingStateProps {
  label: string;
}

/** Content-area loading only; readiness never waits for an animation cycle. */
export function LogoLoadingState({ label }: LogoLoadingStateProps) {
  const id = useId().replace(/:/g, '');
  const wordmarkId = `${id}-wordmark`;
  const dotId = `${id}-dot`;
  const colorId = `${id}-color`;

  return (
    <div
      className="flex h-full min-h-0 flex-1 flex-col items-center justify-center gap-4"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div aria-hidden="true">
        <svg viewBox="0 0 1138 496" className="theme-logo-loading-mark">
          <defs>
            <filter id={colorId} colorInterpolationFilters="sRGB">
              <feFlood floodColor="currentColor" />
              <feComposite in2="SourceAlpha" operator="in" />
            </filter>
            <clipPath id={wordmarkId}>
              <path d="M0 0H1028V112H1138V496H0Z" />
            </clipPath>
            <clipPath id={dotId}>
              <rect x="1028" y="0" width="110" height="112" />
            </clipPath>
          </defs>
          {/* Preserve the artwork's alpha silhouette; theme color is inherited. */}
          <image
            href="zhiyuan-logo-light-1600.png"
            width="1138"
            height="496"
            clipPath={`url(#${wordmarkId})`}
            filter={`url(#${colorId})`}
          />
          <image
            href="zhiyuan-logo-light-1600.png"
            width="1138"
            height="496"
            clipPath={`url(#${dotId})`}
            filter={`url(#${colorId})`}
            className="theme-logo-loading-dot"
          />
        </svg>
      </div>
      <p className="theme-logo-loading-label text-center">{label}</p>
    </div>
  );
}
