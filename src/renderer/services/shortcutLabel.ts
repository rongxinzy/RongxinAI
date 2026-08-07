export function formatShortcutLabel(shortcut: string, isMacPlatform: boolean): string {
  if (!isMacPlatform) return shortcut.replace(/CmdOrCtrl/g, 'Ctrl');

  return shortcut
    .replace(/CmdOrCtrl/g, '⌘')
    .replace('Cmd', '⌘')
    .replace('Option', '⌥')
    .replace('Alt', '⌥');
}
