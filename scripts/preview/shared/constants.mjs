export const PREVIEW_VIEWPORT = { width: 1440, height: 900 };
export const PREVIEW_LOCALE = 'en-US';
export const FIXED_TIME_MS = Date.UTC(2026, 10, 16, 12, 0, 0);

export const PreviewScenario = {
  Default: 'default',
  Empty: 'empty',
  Error: 'error',
  Loading: 'loading',
};

export const PreviewEdition = {
  Zhiyuan: 'zhiyuan',
  Xiaoruan: 'xiaoruan',
};

export const settingsTabs = [
  ['settings-general', 'General'],
  ['settings-appearance', 'Appearance'],
  ['settings-shortcuts', 'Shortcuts'],
  ['settings-model', 'Model'],
  ['settings-platform-models', 'Platform Models'],
  ['settings-model-routing', 'Model Routing'],
  ['settings-memory', 'Memory'],
  ['settings-im', 'IM Bot'],
  ['settings-email', 'Email'],
  ['settings-about', 'About'],
];

export const sidebarViews = [
  ['local-inference', 'Local Inference'],
  ['coding', 'Coding'],
  ['todo', 'Todo'],
  ['scheduled-tasks', 'Automation', 'Daily sales digest'],
  ['activity', 'Activity', '正在查询'],
  ['expert', 'Expert'],
];
