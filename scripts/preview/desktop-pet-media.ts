// Vite's development alias loads all retained characters without shipping their media.
const sources = import.meta.glob<string>(
  [
    '/src/renderer/assets/desktop-pet/motion/*/*.{webm,png}',
    '!/src/renderer/assets/desktop-pet/motion/xiaoyuan/*',
  ],
  { eager: true, query: '?url', import: 'default' },
);

export const desktopPetMediaSources: Record<string, string> = Object.fromEntries(
  Object.entries(sources).map(([key, value]) => [key.replace('/src/renderer', '..'), value]),
);
