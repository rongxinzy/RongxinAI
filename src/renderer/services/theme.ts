import { resolveThemePresentation, themePresentations } from '../theme/themes/presentation';
import { applyThemeBackground } from '../theme/background/background';
import { configService } from './config';

type ThemeType = 'light' | 'dark' | 'system';
type ThemeAppearance = Exclude<ThemeType, 'system'>;

class ThemeService {
  private mediaQuery: MediaQueryList | null = null;
  private currentTheme: ThemeType = 'system';
  private effectiveTheme: ThemeAppearance = 'light';
  private currentStyle: string = themePresentations[0].id;
  private initialized = false;

  constructor() {
    if (typeof window !== 'undefined') {
      this.mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    }
  }

  // 初始化主题
  initialize(): void {
    if (this.initialized) {
      return;
    }
    this.initialized = true;

    try {
      const config = configService.getConfig();
      this.currentStyle = resolveThemePresentation(config.themeStyle ?? this.currentStyle).id;
      this.setTheme(config.theme);

      // 监听系统主题变化
      this.mediaQuery?.addEventListener('change', event => {
        if (this.currentTheme === 'system') this.applyAppearance(event.matches ? 'dark' : 'light');
      });
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
  getEffectiveTheme(): ThemeAppearance {
    return this.effectiveTheme;
  }

  getStyle(): string {
    return this.currentStyle;
  }

  setStyle(id: string): void {
    this.currentStyle = resolveThemePresentation(id).id;
    this.setTheme(this.currentTheme);
  }

  private applyAppearance(appearance: ThemeAppearance): void {
    this.effectiveTheme = appearance;
    if (typeof document === 'undefined') return;

    const theme = resolveThemePresentation(this.currentStyle).appearances[appearance];
    const root = document.documentElement;
    if (root.dataset.theme !== theme.id) {
      applyThemeBackground(theme.background ?? undefined);
      root.dataset.theme = theme.id;
    }
    root.classList.toggle('dark', appearance === 'dark');
    root.classList.toggle('light', appearance === 'light');
  }
}

export const themeService = new ThemeService();
