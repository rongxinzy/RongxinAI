'use client';

import { GRAINS } from '@/companion/looseleaf/ink/builder';
import { inkDefsSvg } from '@/companion/looseleaf/ink/textures';

const instances = new Map<object, () => void>();

function ensureInkFonts(): void {
  // The host supplies its own Chinese-capable typeface; no remote font request.
}

export function ensureInkDefs(): void {
  ensureInkFonts();
  if (typeof document === 'undefined' || instances.size > 0) return;
  if (document.querySelector('[data-ll-defs]') || document.getElementById('ll-felt-0')) return;
  const holder = document.createElement('div');
  holder.innerHTML = inkDefsSvg({ kinds: GRAINS });
  const svg = holder.firstElementChild;
  if (!svg) return;
  svg.setAttribute('data-ll-defs', 'injected');
  document.body.appendChild(svg);
}
