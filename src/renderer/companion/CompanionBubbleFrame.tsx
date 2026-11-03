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
  const bottomEdge = above
    ? `L ${point - 13} 380 ${tail} L 452 380`
    : 'C 170 381.5 320 378.5 452 380';
  const topEdge = above ? 'C 322 16.5 164 19.5 28 18' : `${topTail} L 28 18`;
  const spareEdge = above
    ? 'M 24 20 C 73 18 117 20 157 19 M 323 19 C 367 20 412 17 454 20'
    : 'M 27 378 C 74 380 111 378 148 379 M 329 379 C 373 378 418 381 451 378';
  const outline = `M 28 18 C 16 17 10 24 10 36 C 8.5 91 11.5 137 10 190
    C 8.5 250 11.5 308 10 362 C 10 374 16 381 28 380
    ${bottomEdge} C 464 381 470 374 470 362
    C 471.5 306 468.5 250 470 195 C 471.5 139 468.5 86 470 36
    C 470 24 464 17 452 18 ${topEdge} Z`;
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
          d={`${spareEdge} M 12 45 C 10 96 13 145 11 182 M 11 246 C 13 288 10 330 12 359
            M 468 42 C 466 92 470 142 468 182 M 469 240 C 467 283 470 328 468 358`}
          strokeWidth="0.85"
          strokeOpacity="0.42"
          vectorEffect="non-scaling-stroke"
        />
      </g>
    </svg>
  );
}
