export function formatShortcutLabel(shortcut: string, isMacPlatform: boolean): string {
  const portable = shortcut.replace(
    /(^|\+)(CmdOrCtrl|CommandOrControl)(?=\+|$)/gi,
    `$1${isMacPlatform ? '⌘' : 'Ctrl'}`,
  );
  if (!isMacPlatform) return portable;

  return portable.replace('Cmd', '⌘').replace('Option', '⌥').replace('Alt', '⌥');
}
