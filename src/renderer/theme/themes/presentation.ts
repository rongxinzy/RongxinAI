import { themePresentations } from './presentations.generated';

export { themePresentations };

export function resolveThemePresentation(id: string) {
  return themePresentations.find(theme => theme.id === id) ?? themePresentations[0];
}
