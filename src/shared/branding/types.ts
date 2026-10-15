export interface ProductBrandingConfig {
  /** Edition identifier, e.g. 'zhiyuan' (default upstream) or 'xiaoruan' (custom edition) */
  editionId: string;

  /** Full Chinese product name, e.g. '知远智能体' */
  productName: string;

  /** Short Chinese product name, e.g. '知远' */
  shortName: string;

  /** Full English product name, e.g. 'ZhiYuan Agent' */
  englishName: string;

  /** Internal application identifier, e.g. 'zhiyuan' */
  appId: string;

  /** Windows Application User Model ID, e.g. 'com.zhiyuanagent.app' */
  appUserModelId: string;

  /** Application data root directory name in OS AppData / Application Support */
  dataDirName: string;

  /** SQLite database file name, e.g. 'zhiyuan.sqlite' */
  dbFileName: string;

  /** Default theme ID applied on clean installs, e.g. 'classic-light' */
  defaultTheme: string;

  /** System prompt identity statements used by agent engines and handlers */
  promptIdentity: {
    chinese: string;
    english: string;
    instructions: string;
  };

  /** Feature flags for branding, services and exclusive extensions */
  features: {
    /** Whether to enable upstream community authentication and cloud sync */
    enableCommunityAuth: boolean;

    /**
     * Whether to enable upstream community free models (知远免费模型 / model pool).
     * Rule: Free models are exclusive to the official upstream brand, disabled in custom editions.
     */
    enableCommunityFreeModels: boolean;

    /** Whether to enable upstream online auto-updates */
    enableOnlineUpdate: boolean;

    /** Whether to enable AISphere custom platform model gateway & settings */
    enableAISphere: boolean;
  };
}
