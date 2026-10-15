import { AISphere } from '../../../shared/aisphere';
import { aisphereService } from './service';

export function selectAISphereModel(
  config: { model?: { defaultModel?: string; defaultModelProvider?: string } },
  ref?: string,
) {
  if (ref !== undefined) {
    const prefix = AISphere.Provider + '/';
    return aisphereService.selection(
      ref.startsWith(prefix) ? ref.slice(prefix.length) : '',
      AISphere.Provider,
    );
  }
  return aisphereService.selection(config.model?.defaultModel, config.model?.defaultModelProvider);
}
