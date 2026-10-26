import { useEffect, useRef, useState } from 'react';
import { i18nService } from '../../services/i18n';
import welcomeArt from '../../assets/desktop-pet/companions-welcome.png';

interface Props {
  exiting: boolean;
  failed?: boolean;
  onExitComplete(): void;
}

/** The welcome follows initialization; it never delays readiness for image loading or a minimum show time. */
export function CompanionWelcomeScreen({ exiting, failed = false, onExitComplete }: Props) {
  const [artFailed, setArtFailed] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(
    () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
  );
  const finished = useRef(false);
  const complete = useRef(onExitComplete);
  useEffect(() => {
    complete.current = onExitComplete;
  }, [onExitComplete]);
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!media) return;
    const change = () => setReducedMotion(media.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  useEffect(() => {
    if (!exiting) return;
    const timer = window.setTimeout(
      () => {
        if (finished.current) return;
        finished.current = true;
        complete.current();
      },
      reducedMotion ? 0 : 200,
    );
    return () => window.clearTimeout(timer);
  }, [exiting, reducedMotion]);

  return (
    <main
      className="theme-welcome-screen relative flex min-h-0 flex-1 flex-col items-center justify-center overflow-hidden"
      data-ending-style={exiting ? '' : undefined}
      data-testid="companion-welcome"
    >
      <div className="flex min-h-0 w-full flex-col items-center gap-6 px-6">
        <h1 className="theme-welcome-title text-center">
          {i18nService.t('welcomeCompanionsTitle')}
        </h1>
        <figure
          className="theme-welcome-art m-0 flex shrink-0 items-center justify-center"
          aria-hidden={artFailed ? true : undefined}
        >
          {!artFailed && (
            <img
              src={welcomeArt}
              width={1899}
              height={828}
              alt={i18nService.t('welcomeCompanionsAlt')}
              className="h-full w-full select-none object-contain"
              draggable={false}
              decoding="async"
              fetchPriority="high"
              onError={() => setArtFailed(true)}
            />
          )}
        </figure>
        <p role="status" aria-live="polite" className="theme-home-caption text-center">
          {i18nService.t(
            failed
              ? 'welcomeCompanionsFailed'
              : exiting
                ? 'welcomeCompanionsReady'
                : 'welcomeCompanionsPreparing',
          )}
        </p>
      </div>
    </main>
  );
}
