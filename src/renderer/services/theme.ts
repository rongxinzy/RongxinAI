import { allThemes, ThemeManager } from '../theme';
import { configService } from './config';

type ThemeType = 'light' | 'dark' | 'system';

/** Theme setting → concrete theme definition ID. */
const THEME_IDS: Record<'light' | 'dark', string> = {
  light: 'classic-light',
  dark: 'classic-dark',
};

class ThemeService {
  private mediaQuery: MediaQueryList | null = null;
  private currentTheme: ThemeType = 'system';
  private initialized = false;
  private mediaQueryListener: ((event: MediaQueryListEvent) => void) | null = null;
  private manager: ThemeManager;

  constructor() {
    if (typeof window !== 'undefined') {
      this.mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    }
    this.manager = new ThemeManager(allThemes, {
      storageKey: 'zhiyuan-theme-id',
      defaultTheme: THEME_IDS.light,
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

  private applyAppearance(appearance: 'light' | 'dark'): void {
    void this.manager.setTheme(THEME_IDS[appearance]);
  }
}

export const themeService = new ThemeService();
