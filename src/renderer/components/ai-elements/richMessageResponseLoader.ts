const RICH_CONTENT_PATTERN = /```|~~~|\$\$|\\\(|\\\[|\$[^$\n]+?\$|(?:^|\n)(?: {4,}|\t+)\S/;

export const hasRichMessageContent = (content: string): boolean =>
  RICH_CONTENT_PATTERN.test(content);

type RichMessageResponseModule = typeof import('./richMessageResponse');

let loadedModule: RichMessageResponseModule | null = null;
let pendingModule: Promise<RichMessageResponseModule> | null = null;

export const loadRichMessageResponse = (): Promise<RichMessageResponseModule> => {
  pendingModule ??= import('./richMessageResponse').then(module => {
    loadedModule = module;
    return module;
  });
  return pendingModule;
};

export const getLoadedRichMessageResponse = () => loadedModule?.default ?? null;
