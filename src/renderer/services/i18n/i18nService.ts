import { configService } from '../config';

import { translations } from './translations';
import type { LanguageType } from './types';

class I18nService {
  private currentLanguage: LanguageType = 'zh';
  private listeners = new Set<() => void>();

  constructor() {
    // 默认使用中文
    this.currentLanguage = 'zh';
  }

  // 初始化语言设置
  async initialize(): Promise<void> {
    try {
      const config = configService.getConfig();

      // 检查是否已经初始化过语言设置
      const languageInitialized = config.language_initialized;

      if (languageInitialized !== true) {
        // 可能是首次启动或旧版本用户升级
        // 为了保护旧用户的语言设置,检查是否有非默认的语言配置
        const hasCustomLanguage = config.language && config.language !== 'zh';

        if (hasCustomLanguage) {
          // 旧用户已手动设置过语言(非默认值),保留他们的设置
          console.log(`[i18n] Legacy user detected with custom language: ${config.language}`);
          this.currentLanguage = config.language;
          configService.updateConfig({
            language_initialized: true,
          });
        } else {
          // 新用户或使用默认中文的旧用户:检测系统语言
          try {
            const systemLocale = await window.electron.appInfo.getSystemLocale();
            const defaultLanguage = this.inferLanguageFromLocale(systemLocale);

            console.log(
              `[i18n] First run detected. System locale: ${systemLocale}, default language: ${defaultLanguage}`,
            );

            this.currentLanguage = defaultLanguage;

            // 保存语言配置和初始化标记
            configService.updateConfig({
              language: defaultLanguage,
              language_initialized: true,
            });
          } catch (error) {
            console.error('Failed to get system locale:', error);
            // 如果获取系统语言失败,默认使用英文
            this.currentLanguage = 'en';
            configService.updateConfig({
              language: 'en',
              language_initialized: true,
            });
          }
        }
      } else {
        // 非首次启动:使用已保存的语言配置
        if (config.language && (config.language === 'zh' || config.language === 'en')) {
          this.currentLanguage = config.language;
        } else {
          // 如果配置无效,fallback 到英文
          this.currentLanguage = 'en';
          configService.updateConfig({
            language: 'en',
          });
        }
      }
    } catch (error) {
      console.error('Failed to initialize language:', error);
      // 默认使用英文
      this.currentLanguage = 'en';
    }
  }

  // 根据系统语言推断应用语言
  private inferLanguageFromLocale(systemLocale: string): LanguageType {
    // 只有 zh-CN (简体中文) 才使用中文,其他所有情况都使用英文
    if (systemLocale === 'zh-CN') {
      return 'zh';
    }
    return 'en'; // 默认英文 (包括 zh-TW, zh-HK, en-*, 以及其他所有语言)
  }

  // 设置语言
  setLanguage(language: LanguageType, options: { persist?: boolean } = {}): void {
    const { persist = true } = options;
    const hasChanged = this.currentLanguage !== language;
    this.currentLanguage = language;

    if (hasChanged) {
      this.listeners.forEach(listener => listener());
    }

    if (!persist) {
      return;
    }

    // 更新配置
    try {
      const config = configService.getConfig();
      configService.updateConfig({
        ...config,
        language,
      });
    } catch (error) {
      console.error('Failed to save language setting:', error);
    }
  }

  // 获取当前语言
  getLanguage(): LanguageType {
    return this.currentLanguage;
  }

  // 获取翻译文本
  t(key: string): string {
    const translation = translations[this.currentLanguage][key];
    if (!translation) {
      console.warn(`Translation missing for key: ${key} in language: ${this.currentLanguage}`);
      // 尝试从另一种语言获取
      const fallbackTranslation = translations[this.currentLanguage === 'zh' ? 'en' : 'zh'][key];
      return fallbackTranslation || key;
    }
    return translation;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

export const i18nService = new I18nService();
