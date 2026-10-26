// Only original-art packs. Rejected, separately redrawn rigs cannot enter production.
export const desktopPetMediaSources = import.meta.glob<string>(
  '../assets/desktop-pet/motion/*-original/*.{webm,png}',
  { eager: true, query: '?url', import: 'default' },
);
