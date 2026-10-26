import { Menu } from 'electron';
import { vi } from 'vitest';

/** Open the real controller's native menu against its owned-window fixture. */
export function petMenuItem(open: (event: unknown) => void, contents: { mainFrame: object }) {
  open({ sender: contents, senderFrame: contents.mainFrame });
  type Item = {
    label?: string;
    type?: string;
    checked?: boolean;
    enabled?: boolean;
    click?: () => void;
    submenu?: Item[];
  };
  const template = vi.mocked(Menu.buildFromTemplate).mock.calls.at(-1)![0] as Item[];
  const find = (items: Item[], label: string): Item | undefined => {
    for (const item of items) {
      if (item.label === label) return item;
      if (Array.isArray(item.submenu)) {
        const nested = find(item.submenu, label);
        if (nested) return nested;
      }
    }
    return undefined;
  };
  return (label: string) => find(template, label)!;
}
