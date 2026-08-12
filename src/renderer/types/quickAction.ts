/**
 * QuickAction 类型定义
 * 用于首页快捷操作功能
 */

/**
 * 预制提示词（原始结构，从JSON加载）
 */
export interface Prompt {
  /** 唯一标识 */
  id: string;
}

/**
 * 本地化后的预制提示词（包含翻译后的文本）
 */
export interface LocalizedPrompt {
  /** 唯一标识 */
  id: string;
  /** 显示标题 */
  label: string;
  /** 简短描述 */
  description?: string;
  /** 完整提示词内容 */
  prompt: string;
}

/**
 * 快捷操作主项（原始结构，从JSON加载）
 */
export interface QuickAction {
  /** 唯一标识 */
  id: string;
  /** 图标名称（Heroicons） */
  icon: string;
  /** 主题色（hex） */
  color: string;
  /** 映射到 Skill ID */
  skillMapping: string;
  /** 预制提示词列表 */
  prompts: Prompt[];
}

/**
 * 本地化后的快捷操作主项（包含翻译后的文本）
 */
export interface LocalizedQuickAction {
  /** 唯一标识 */
  id: string;
  /** 显示标题 */
  label: string;
  /** 图标名称（Heroicons） */
  icon: string;
  /** 主题色（hex） */
  color: string;
  /** 映射到 Skill ID */
  skillMapping: string;
  /** 预制提示词列表（已本地化） */
  prompts: LocalizedPrompt[];
}

/**
 * 快捷操作配置（原始结构）
 */
export interface QuickActionsConfig {
  /** 配置版本 */
  version: number;
  /** 快捷操作列表 */
  actions: QuickAction[];
}

/**
 * 国际化配置结构
 */
export interface QuickActionsI18n {
  zh: QuickActionsI18nData;
  en: QuickActionsI18nData;
}

export interface QuickActionsI18nData {
  [actionId: string]: {
    label: string;
    prompts: {
      [promptId: string]: {
        label: string;
        description?: string;
        prompt: string;
      };
    };
  };
}
