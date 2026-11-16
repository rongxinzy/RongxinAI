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
  const language =
    typeof i18nService?.getLanguage === 'function' ? i18nService.getLanguage() : 'zh';
  const neutralName = language === 'zh' ? '模型服务' : 'model service';
  return text.replace(/magpie|喜鹊|yetone/gi, neutralName);
}
