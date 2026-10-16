import { WorkMode, type WorkMode as WorkModeValue } from './store/workMode/constants';

// 配置类型定义
export interface AppConfig {
  // 主题配置
  theme: 'light' | 'dark' | 'system';
  themeStyle?: string;
  // 语言配置
  language: 'zh' | 'en';
  // 是否使用系统代理
  useSystemProxy: boolean;
  // 是否启用 SQLite 自动备份与恢复
  sqliteAutoBackupEnabled?: boolean;
  // 语言初始化标记 (用于判断是否是首次启动)
  language_initialized?: boolean;
  // 应用配置
  app: {
    port: number;
    isDevelopment: boolean;
  };
  // 工作模式
  workMode?: WorkModeValue;
  // 快捷键配置
  shortcuts?: {
    newChat: string;
    search: string;
    settings: string;
    sendMessage: string;
    [key: string]: string | undefined;
  };
  // API 与模型可选配置（向下兼容）
  api?: {
    key?: string;
    baseUrl?: string;
  };
  model?: {
    availableModels?: Array<{
      id: string;
      name: string;
      supportsImage?: boolean;
      capabilities?: Record<string, unknown>;
    }>;
    defaultModel?: string;
    defaultModelProvider?: string;
  };
  providers?: Record<string, unknown>;
}

export const DEFAULT_SHORTCUTS = {
  newChat: 'CmdOrCtrl+N',
  search: 'CmdOrCtrl+F',
  settings: 'CmdOrCtrl+,',
  sendMessage: 'Enter',
} as const;

// 默认配置
export const defaultConfig: AppConfig = {
  theme: 'system',
  language: 'zh',
  workMode: WorkMode.Work,
  useSystemProxy: false,
  sqliteAutoBackupEnabled: false,
  app: {
    port: 3000,
    isDevelopment: process.env.NODE_ENV === 'development',
  },
  shortcuts: {
    ...DEFAULT_SHORTCUTS,
  },
};

// 配置存储键
export const CONFIG_KEYS = {
  APP_CONFIG: 'app_config',
  AUTH: 'auth_state',
  CONVERSATIONS: 'conversations',
};
