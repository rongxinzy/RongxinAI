// Skill type definition
export interface Skill {
  id: string;
  name: string;
  description: string;
  enabled: boolean; // Whether visible in popover
  pinned: boolean;
  isOfficial: boolean; // "官方" badge
  isBuiltIn: boolean; // Bundled with app, cannot be deleted
  updatedAt: number; // Timestamp
  prompt: string; // System prompt content
  skillPath: string; // Absolute path to SKILL.md
  iconUrl?: string; // Local skill icon resolved from its folder
  displayName?: string; // Optional local UI label
  displayDescription?: string; // Optional local UI description
  displayAuthor?: string; // Optional local UI author
  displayLicense?: string; // Optional local UI license
  metadataContent?: string; // Raw local UI metadata YAML
  metadataFields?: Record<string, string>; // Parsed local UI metadata fields
  version?: string; // Skill version from SKILL.md frontmatter
}

export type LocalizedText = { en: string; zh: string };

export interface LocalSkillInfo {
  id: string;
  name: string;
  description: string | LocalizedText;
  version: string;
}

export interface MarketplaceSkill {
  id: string;
  name: string;
  description: string | LocalizedText;
  stats?: {
    comments?: number;
    downloads?: number;
    installsAllTime?: number;
    installsCurrent?: number;
    stars?: number;
    versions?: number;
  };
  url: string; // Marketplace page URL
  installSource?: string;
  version: string;
  source: {
    from: string; // e.g. "Github"
    url: string; // Source repo URL
    author?: string; // Author name
  };
}

export interface MarketplaceSkillPage {
  skills: MarketplaceSkill[];
  hasMore: boolean;
}
