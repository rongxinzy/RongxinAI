// Released media only. Dormant characters remain in the authoring preview bundle.
export const desktopPetMediaSources = import.meta.glob<string>(
  '../assets/desktop-pet/motion/xiaoyuan-original/*.{webm,png}',
  { eager: true, query: '?url', import: 'default' },
);
