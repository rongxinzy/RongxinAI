import { DEFAULT_THEME_PLUGIN_ID, resolveThemePlugin, themePlugins } from '../theme/themes/plugins';
import { allThemes, ThemeManager } from '../theme';
import { configService } from './config';

type ThemeType = 'light' | 'dark' | 'system';

class ThemeService {
  private mediaQuery: MediaQueryList | null = null;
  private currentTheme: ThemeType = 'system';
  private currentStyle = DEFAULT_THEME_PLUGIN_ID;
  private initialized = false;
  private mediaQueryListener: ((event: MediaQueryListEvent) => void) | null = null;
  private manager: ThemeManager;

  constructor() {
    if (typeof window !== 'undefined') {
      this.mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    }
    this.manager = new ThemeManager(allThemes, {
      storageKey: 'zhiyuan-theme-id',
      defaultTheme: resolveThemePlugin(DEFAULT_THEME_PLUGIN_ID).appearances.light.meta.id,
      followSystem: false,
    });
  }

  // 初始化主题
  initialize(): void {
    if (this.initialized) {
      return;
    }
    this.initialized = true;

    try {
      const config = configService.getConfig();
      this.currentStyle = resolveThemePlugin(config.themeStyle ?? DEFAULT_THEME_PLUGIN_ID).id;
      this.setTheme(config.theme);

      // 监听系统主题变化
      if (this.mediaQuery) {
        this.mediaQueryListener = e => {
          if (this.currentTheme === 'system') {
            this.applyAppearance(e.matches ? 'dark' : 'light');
          }
        };
        this.mediaQuery.addEventListener('change', this.mediaQueryListener);
      }
    } catch (error) {
      console.error('Failed to initialize theme:', error);
      this.setTheme('system');
    }
  }

  // 设置主题（浅色 / 深色 / 跟随系统）
  setTheme(theme: ThemeType): void {
    console.debug(`[Theme] theme set to ${theme}`);
    this.currentTheme = theme;
    if (theme === 'system') {
      this.applyAppearance(this.mediaQuery?.matches ? 'dark' : 'light');
    } else {
      this.applyAppearance(theme);
    }
  }

  // 获取当前主题设置
  getTheme(): ThemeType {
    return this.currentTheme;
  }

  // 获取当前实际生效的明暗外观
  getEffectiveTheme(): 'light' | 'dark' {
    const theme = this.manager.getTheme();
    return theme?.meta.appearance ?? 'light';
  }

  getStyle(): string {
    return this.currentStyle;
  }

  getStyles() {
    return themePlugins;
  }

  setStyle(id: string): void {
    this.currentStyle = resolveThemePlugin(id).id;
    this.setTheme(this.currentTheme);
  }

  private applyAppearance(appearance: 'light' | 'dark'): void {
    void this.manager
      .setTheme(resolveThemePlugin(this.currentStyle).appearances[appearance].meta.id)
      .catch(error => console.error('[Theme] Failed to persist theme:', error));
  }
}

export const themeService = new ThemeService();
