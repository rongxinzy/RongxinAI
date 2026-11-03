import * as React from 'react';

import { inkViewBox } from '@/companion/looseleaf/ink/builder';
import type { Frame } from '@/companion/looseleaf/ink/react/cache';

export function InkSvg({
  kind,
  frame,
  still,
  ref,
}: {
  kind: string;
  frame: Frame | null;
  still?: boolean;
  ref?: React.Ref<SVGSVGElement>;
}) {
  const pad = frame?.pad ?? 0;
  return (
    <svg
      ref={ref}
      data-ink={kind}
      data-still={still ? '' : undefined}
      aria-hidden="true"
      focusable="false"
      className="pointer-events-none absolute"
      viewBox={frame ? inkViewBox(frame) : undefined}
      preserveAspectRatio="none"
      style={{
        position: 'absolute',
        pointerEvents: 'none',
        left: -pad,
        top: -pad,
        width: `calc(100% + ${2 * pad}px)`,
        height: `calc(100% + ${2 * pad}px)`,
        overflow: 'visible',
        zIndex: -1,
      }}
    >
      {frame?.layers.map(name => (
        <g
          key={name}
          data-layer={name}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: frame.parts[name] ?? '' }}
        />
      ))}
    </svg>
  );
}
