export const SidebarModeTab = {
  Work: 'work',
  Chat: 'chat',
} as const;

export type SidebarModeTab = (typeof SidebarModeTab)[keyof typeof SidebarModeTab];
