import { i18nService } from './i18n';

/**
 * Neutralize internal runtime names before raw error strings reach the UI.
 *
 * Main-process and upstream gateway failures can embed the internal gateway
 * name in their messages. Copy we control is already neutral at the source;
 * this is the display-side backstop for pass-through text (diagnostics badges,
 * usage load errors, preview dialogs).
 */
export function neutralRuntimeName(text: string): string {
  const neutralName = i18nService.getLanguage() === 'zh' ? '本地模型服务' : 'local model service';
  return text.replace(/magpie/gi, neutralName);
}
