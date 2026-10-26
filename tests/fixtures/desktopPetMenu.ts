import { Menu } from 'electron';
import { vi } from 'vitest';

/** Open the real controller's native menu against its owned-window fixture. */
export function petMenuItem(open: (event: unknown) => void, contents: { mainFrame: object }) {
  open({ sender: contents, senderFrame: contents.mainFrame });
  const template = vi.mocked(Menu.buildFromTemplate).mock.calls.at(-1)![0] as Array<{
    label?: string;
    click?: () => void;
  }>;
  return (label: string) => template.find(item => item.label === label)!;
}
