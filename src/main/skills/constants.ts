export const SKILLS_DIR_NAME = 'SKILLs';
export const SKILL_FILE_NAME = 'SKILL.md';
export const SKILL_ICON_FILE_NAMES = [
  'icon.svg',
  'icon.png',
  'icon.webp',
  'icon.jpg',
  'icon.jpeg',
] as const;
export const SKILL_ICON_MIME_TYPES: Record<(typeof SKILL_ICON_FILE_NAMES)[number], string> = {
  'icon.svg': 'image/svg+xml',
  'icon.png': 'image/png',
  'icon.webp': 'image/webp',
  'icon.jpg': 'image/jpeg',
  'icon.jpeg': 'image/jpeg',
};
export const SKILLS_CONFIG_FILE = 'skills.config.json';
export const RONGX_DIR_NAME = 'zhiyuan';
export const RONGX_METADATA_FILE_NAME = 'metadata.yaml';
export const RONGX_PRIMARY_METADATA_FIELDS = ['name', 'description', 'author', 'license'] as const;
export const SKILL_STATE_KEY = 'skills_state';
export const WATCH_DEBOUNCE_MS = 250;
