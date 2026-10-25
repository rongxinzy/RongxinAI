import { useId } from 'react';
import { CompanionBubbleSide, type CompanionBubblePlacement } from '../../shared/companion/bubble';

/** Original frame artwork, not an icon. Only its graphite edge receives the dry-pencil texture. */
export function CompanionBubbleFrame({ placement }: { placement: CompanionBubblePlacement }) {
  const texture = useId().replaceAll(':', '');
  const above = placement.side === CompanionBubbleSide.Above;
  const point = Math.max(32, Math.min(448, placement.anchorX));
  const tail = above
    ? `L ${point + 12} 380 Q ${point + 4} 384 ${point} 394 L ${point - 12} 381`
    : '';
  const topTail = !above
    ? `L ${point - 12} 19 Q ${point - 4} 16 ${point} 6 L ${point + 12} 20`
    : '';
  const outline = `M 20 19 Q 12 20 11 30 L 9 112 L 12 222 L 10 358 Q 10 379 29 380
    ${tail} L 450 378 Q 469 379 469 359 L 471 270 L 468 164
    L 470 39 Q 470 20 450 20 ${topTail} Z`;
  return (
    <svg
      className="theme-companion-sketch pointer-events-none absolute inset-0 h-full w-full"
      viewBox="0 0 480 400"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <filter id={texture} x="-5%" y="-5%" width="110%" height="110%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.8"
            numOctaves="2"
            seed="7"
            result="grain"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="grain"
            scale="0.65"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
      </defs>
      <path className="theme-companion-sketch-paper" d={outline} />
      <g fill="none" stroke="currentColor" filter={`url(#${texture})`}>
        <path d={outline} strokeWidth="1.4" strokeOpacity="0.7" vectorEffect="non-scaling-stroke" />
        <path
          d="M 18 24 L 12 111 L 16 217 M 14 355 Q 14 375 32 374 L 112 375 M 376 23 L 447 25 Q 466 24 464 42 L 466 137 M 465 283 L 464 355 Q 464 373 448 373"
          strokeWidth="0.6"
          strokeOpacity="0.35"
          vectorEffect="non-scaling-stroke"
        />
      </g>
      <g
        fill="none"
        strokeLinecap="round"
        strokeWidth="1.3"
        opacity="0.7"
        filter={`url(#${texture})`}
      >
        <path
          className="theme-companion-pencil-warm"
          d="M 31 18 L 56 15 M 35 21 L 62 17 M 39 23 L 60 20"
          stroke="currentColor"
        />
        <path
          className="theme-companion-pencil-cool"
          d="M 424 381 L 448 377 M 428 384 L 453 379 M 433 386 L 451 382"
          stroke="currentColor"
        />
      </g>
    </svg>
  );
}
