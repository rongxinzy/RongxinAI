import { useId } from 'react';
import {
  COMPANION_BUBBLE_ART_WIDTH,
  CompanionBubbleSide,
  type CompanionBubblePlacement,
} from '../../shared/companion/bubble';
import { DesktopPetBuiltinId } from '../../shared/desktopPet/catalog';

/** Original frame artwork, not an icon. Only its graphite edge receives the dry-pencil texture. */
export function CompanionBubbleFrame({
  placement,
  characterId = DesktopPetBuiltinId.Xiaoyuan,
}: {
  placement: CompanionBubblePlacement;
  characterId?: DesktopPetBuiltinId;
}) {
  const id = useId().replaceAll(':', '');
  const texture = `${id}-texture`;
  const shadow = `${id}-shadow`;
  const above = placement.side === CompanionBubbleSide.Above;
  const point = Math.max(44, Math.min(COMPANION_BUBBLE_ART_WIDTH - 44, placement.anchorX));
  const tail = above
    ? `L ${point - 13} 380 C ${point - 6} 380 ${point - 3} 391 ${point} 394 C ${point + 3} 391 ${point + 6} 380 ${point + 13} 380`
    : '';
  const topTail = !above
    ? `L ${point + 13} 18 C ${point + 6} 18 ${point + 3} 9 ${point} 6 C ${point - 3} 9 ${point - 6} 18 ${point - 13} 18`
    : '';
  const outline = `M 28 18 Q 10 18 10 36 C 9.5 140 10.5 260 10 362 Q 10 380 28 380
    ${tail} L 452 380 Q 470 380 470 362 C 470.5 260 469.5 140 470 36
    Q 470 18 452 18 ${topTail} Z`;
  return (
    <svg
      data-character={characterId}
      className="theme-companion-sketch pointer-events-none absolute inset-0 h-full w-full"
      viewBox={`0 0 ${COMPANION_BUBBLE_ART_WIDTH} 400`}
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <filter id={shadow} x="-6%" y="-6%" width="112%" height="114%">
          <feDropShadow dx="0" dy="4" stdDeviation="5" floodColor="#0f172a" floodOpacity="0.10" />
        </filter>
        <filter id={texture} x="-5%" y="-5%" width="110%" height="110%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.75"
            numOctaves="2"
            seed="7"
            result="grain"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="grain"
            scale="0.45"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
      </defs>
      <path className="theme-companion-sketch-paper" d={outline} filter={`url(#${shadow})`} />
      <g
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        filter={`url(#${texture})`}
      >
        <path
          d={outline}
          strokeWidth="1.5"
          strokeOpacity="0.82"
          vectorEffect="non-scaling-stroke"
        />
        <path
          d="M 11.2 40 C 11 140 11.2 250 11.2 358 Q 11.2 378.5 30 378.8 M 450 19.2 Q 468.8 19.5 468.8 38 C 469 150 468.6 260 468.8 358"
          strokeWidth="0.65"
          strokeOpacity="0.32"
          vectorEffect="non-scaling-stroke"
        />
      </g>
    </svg>
  );
}
