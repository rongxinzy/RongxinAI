type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
  },
) => Promise<{
  ok: boolean;
  status: number;
  statusText: string;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}>;

type ModelScopeSkillLocale = {
  description?: string;
};

type ModelScopeSkillRecord = {
  id?: string;
  display_name?: string;
  description?: string;
  owner?: string;
  developer?: string;
  source_url?: string;
  category?: string;
  tags?: string[];
  custom_tag?: string[];
  downloads?: number;
  locales?: {
    en?: ModelScopeSkillLocale;
    zh?: ModelScopeSkillLocale;
  };
  install_command?: string[];
};

type MarketplaceSkillRecord = {
  id: string;
  name: string;
  description: string | { zh: string; en: string };
  stats: {
    downloads: number;
  };
  url: string;
  installSource?: string;
  version: string;
  source: {
    from: string;
    url: string;
    author?: string;
  };
};

type FetchModelScopeSkillMarketplaceOptions = {
  token?: string | null;
  fetchImpl?: FetchLike;
};

type ResolveModelScopeSkillInstallSourceOptions = {
  token?: string | null;
  fetchImpl?: FetchLike;
};

const MODELSCOPE_SKILL_MARKETPLACE = {
  SourceName: 'ModelScope',
  BaseUrl: 'https://modelscope.cn',
  SkillsApiPath: '/openapi/v1/skills',
  UserAgent: 'ZhiYuanAgent/skill-marketplace',
  DefaultPageNumber: 1,
  DefaultPageSize: 100,
  DefaultVersion: '1.0.0',
  FeaturedSkillLimit: 24,
} as const;

export function buildModelScopeSkillPageUrl(skillId: string): string {
  return `${MODELSCOPE_SKILL_MARKETPLACE.BaseUrl}/skills/${skillId}`;
}

export function parseModelScopeSkillUrl(source: string): { skillId: string } | null {
  try {
    const url = new URL(source);
    const hostname = url.hostname.toLowerCase();
    if (hostname !== 'modelscope.cn' && hostname !== 'www.modelscope.cn') {
      return null;
    }
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments.length < 2 || segments[0] !== 'skills') {
      return null;
    }
    const skillId = segments.slice(1).join('/').trim();
    return skillId ? { skillId } : null;
  } catch {
    return null;
  }
}

export async function fetchModelScopeSkillMarketplace(
  options: FetchModelScopeSkillMarketplaceOptions = {},
): Promise<string> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const payload = await fetchModelScopeSkillsPage({
    token: options.token,
    fetchImpl,
  });
  const skills = Array.isArray(payload.data?.skills) ? payload.data.skills : [];
  const marketplace = curateFeaturedMarketplace(
    skills
    .map(skill => toMarketplaceSkill(skill))
    .filter((skill): skill is MarketplaceSkillRecord => skill !== null),
  );
  return JSON.stringify({
    data: {
      value: {
        marketplace,
        localSkill: [],
      },
    },
  });
}

export async function resolveModelScopeSkillInstallSource(
  source: string,
  options: ResolveModelScopeSkillInstallSourceOptions = {},
): Promise<string | null> {
  const parsed = parseModelScopeSkillUrl(source);
  if (!parsed) {
    return null;
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const detail = await fetchModelScopeSkillDetail(parsed.skillId, {
    token: options.token,
    fetchImpl,
  });
  return getSupportedInstallSource(detail);
}

async function fetchModelScopeSkillsPage(input: {
  token?: string | null;
  fetchImpl: FetchLike;
}): Promise<{ data?: { skills?: ModelScopeSkillRecord[] } }> {
  const query = new URLSearchParams({
    page_number: String(MODELSCOPE_SKILL_MARKETPLACE.DefaultPageNumber),
    page_size: String(MODELSCOPE_SKILL_MARKETPLACE.DefaultPageSize),
  });
  const response = await input.fetchImpl(
    `${MODELSCOPE_SKILL_MARKETPLACE.BaseUrl}${MODELSCOPE_SKILL_MARKETPLACE.SkillsApiPath}?${query.toString()}`,
    {
      method: 'GET',
      headers: buildHeaders(input.token),
    },
  );
  if (!response.ok) {
    const detail = (await response.text()).trim();
    throw new Error(
      `[SkillMarketplace] ModelScope skills request failed: HTTP ${response.status}${detail ? ` ${detail}` : ''}`,
    );
  }
  return await response.json() as { data?: { skills?: ModelScopeSkillRecord[] } };
}

async function fetchModelScopeSkillDetail(
  skillId: string,
  input: {
    token?: string | null;
    fetchImpl: FetchLike;
  },
): Promise<ModelScopeSkillRecord> {
  const response = await input.fetchImpl(
    `${MODELSCOPE_SKILL_MARKETPLACE.BaseUrl}${MODELSCOPE_SKILL_MARKETPLACE.SkillsApiPath}/${skillId}`,
    {
      method: 'GET',
      headers: buildHeaders(input.token),
    },
  );
  if (!response.ok) {
    const detail = (await response.text()).trim();
    throw new Error(
      `[SkillMarketplace] ModelScope skill detail request failed: HTTP ${response.status}${detail ? ` ${detail}` : ''}`,
    );
  }
  const payload = await response.json() as { data?: ModelScopeSkillRecord };
  if (!payload.data) {
    throw new Error('[SkillMarketplace] ModelScope skill detail response is missing data');
  }
  return payload.data;
}

function buildHeaders(token?: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'User-Agent': MODELSCOPE_SKILL_MARKETPLACE.UserAgent,
  };
  const trimmedToken = token?.trim();
  if (trimmedToken) {
    headers.Authorization = `Bearer ${trimmedToken}`;
  }
  return headers;
}

function toMarketplaceSkill(skill: ModelScopeSkillRecord): MarketplaceSkillRecord | null {
  const skillId = readNonEmptyString(skill.id);
  if (!skillId) {
    return null;
  }

  const installSource = getSupportedInstallSource(skill);
  const sourceUrl = readNonEmptyString(skill.source_url) || buildModelScopeSkillPageUrl(skillId);
  const description = buildLocalizedDescription(skill);

  return {
    id: skillId,
    name: readNonEmptyString(skill.display_name) || skillId,
    description,
    stats: {
      downloads: typeof skill.downloads === 'number' ? skill.downloads : 0,
    },
    url: buildModelScopeSkillPageUrl(skillId),
    ...(installSource ? { installSource } : {}),
    version: MODELSCOPE_SKILL_MARKETPLACE.DefaultVersion,
    source: {
      from: MODELSCOPE_SKILL_MARKETPLACE.SourceName,
      url: sourceUrl,
      author: readNonEmptyString(skill.developer) || readNonEmptyString(skill.owner) || undefined,
    },
  };
}

function buildLocalizedDescription(
  skill: ModelScopeSkillRecord,
): string | { zh: string; en: string } {
  const zh = readNonEmptyString(skill.locales?.zh?.description) || readNonEmptyString(skill.description) || '';
  const en = readNonEmptyString(skill.locales?.en?.description) || zh;
  return { zh, en };
}

function curateFeaturedMarketplace(skills: MarketplaceSkillRecord[]): MarketplaceSkillRecord[] {
  return [...skills]
    .sort((left, right) => {
      const downloadDelta = (right.stats.downloads ?? 0) - (left.stats.downloads ?? 0);
      if (downloadDelta !== 0) {
        return downloadDelta;
      }
      return left.name.localeCompare(right.name);
    })
    .slice(0, MODELSCOPE_SKILL_MARKETPLACE.FeaturedSkillLimit);
}

function getSupportedInstallSource(skill: ModelScopeSkillRecord): string | null {
  const sourceUrl = readSupportedInstallSource(skill.source_url);
  if (sourceUrl) {
    return sourceUrl;
  }

  return extractInstallSourceFromCommands(skill.install_command);
}

function extractInstallSourceFromCommands(commands: string[] | undefined): string | null {
  if (!Array.isArray(commands)) {
    return null;
  }
  for (const command of commands) {
    const trimmed = command.trim();
    if (!trimmed) {
      continue;
    }
    const urlMatch = trimmed.match(/https?:\/\/[^\s'"]+/i);
    const source = readSupportedInstallSource(urlMatch?.[0]);
    if (source) {
      return source;
    }
  }
  return null;
}

function readSupportedInstallSource(value: unknown): string | null {
  const source = readNonEmptyString(value);
  return source && !parseModelScopeSkillUrl(source) ? source : null;
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}
