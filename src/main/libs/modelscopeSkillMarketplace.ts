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
  logo_url?: string;
  category?: string;
  tags?: string[];
  custom_tag?: string[];
  downloads?: number;
  locales?: {
    en?: ModelScopeSkillLocale;
    zh?: ModelScopeSkillLocale;
  };
  install_command?: string[];
  readme?: string;
  skill_md?: string;
  skillMd?: string;
  content?: string;
};

type MarketplaceSkillRecord = {
  id: string;
  name: string;
  description: string | { zh: string; en: string };
  stats: {
    downloads: number;
  };
  url: string;
  iconUrl?: string;
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
  pageNumber?: number;
  pageSize?: number;
};

type FetchModelScopeSkillContentOptions = {
  token?: string | null;
  fetchImpl?: FetchLike;
};

const MODELSCOPE_SKILL_MARKETPLACE = {
  SourceName: 'ModelScope',
  BaseUrl: 'https://modelscope.cn',
  SkillsApiPath: '/openapi/v1/skills',
  UserAgent: 'ZhiYuanAgent/skill-marketplace',
  DefaultPageNumber: 1,
  DefaultPageSize: 8,
  MaximumPageSize: 100,
  DefaultVersion: '1.0.0',
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
    pageNumber: options.pageNumber,
    pageSize: options.pageSize,
  });
  const skills = Array.isArray(payload.data?.skills) ? payload.data.skills : [];
  const pageSize = normalizePageSize(options.pageSize);
  const pageNumber = normalizePageNumber(options.pageNumber);
  const marketplace = sortMarketplaceSkills(
    skills
      .map(skill => toMarketplaceSkill(skill))
      .filter((skill): skill is MarketplaceSkillRecord => skill !== null),
  );
  const total = payload.data?.total;
  const hasMore =
    typeof total === 'number' ? pageNumber * pageSize < total : skills.length === pageSize;
  return JSON.stringify({
    data: {
      value: {
        marketplace,
        localSkill: [],
        hasMore,
      },
    },
  });
}

export async function resolveModelScopeSkillInstallSource(
  source: string,
): Promise<string | null> {
  const parsed = parseModelScopeSkillUrl(source);
  if (!parsed) {
    return null;
  }

  return fetchModelScopeSkillArchiveUrl(parsed.skillId);
}

async function fetchModelScopeSkillArchiveUrl(skillId: string): Promise<string | null> {
  const normalizedId = skillId
    .split('/')
    .map(segment => segment.trim())
    .filter(Boolean)
    .join('/');
  return normalizedId
    ? `https://www.modelscope.cn/skills/${normalizedId}/archive/zip/master`
    : null;
}

export async function fetchModelScopeSkillContent(
  skillId: string,
  options: FetchModelScopeSkillContentOptions = {},
): Promise<string | null> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const detail = await fetchModelScopeSkillDetail(skillId, {
    token: options.token,
    fetchImpl,
  });
  const inlineContent = [detail.skill_md, detail.skillMd, detail.readme, detail.content].find(
    value => typeof value === 'string' && value.trim(),
  );
  if (typeof inlineContent === 'string') return inlineContent;

  const sourceUrl = readNonEmptyString(detail.source_url);
  const rawUrl = sourceUrl ? toGitHubSkillMdUrl(sourceUrl) : null;
  if (!rawUrl) return null;
  const response = await fetchImpl(rawUrl, { method: 'GET' });
  if (!response.ok) return null;
  const content = await response.text();
  return content.trim() ? content : null;
}

function toGitHubSkillMdUrl(source: string): string | null {
  try {
    const url = new URL(source);
    if (url.hostname.toLowerCase() !== 'github.com') return null;
    const segments = url.pathname.split('/').filter(Boolean);
    const markerIndex = segments.findIndex(segment => segment === 'tree' || segment === 'blob');
    if (segments.length < 4 || markerIndex < 2) return null;
    const owner = segments[0];
    const repository = segments[1];
    const ref = segments[markerIndex + 1];
    const path = segments.slice(markerIndex + 2);
    if (!owner || !repository || !ref || path.length === 0) return null;
    const filePath = path[path.length - 1].toLowerCase() === 'skill.md' ? path : [...path, 'SKILL.md'];
    return `https://raw.githubusercontent.com/${owner}/${repository}/${ref}/${filePath.join('/')}`;
  } catch {
    return null;
  }
}

async function fetchModelScopeSkillsPage(input: {
  token?: string | null;
  fetchImpl: FetchLike;
  pageNumber?: number;
  pageSize?: number;
}): Promise<{ data?: { skills?: ModelScopeSkillRecord[]; total?: number } }> {
  const query = new URLSearchParams({
    page_number: String(normalizePageNumber(input.pageNumber)),
    page_size: String(normalizePageSize(input.pageSize)),
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
  return (await response.json()) as { data?: { skills?: ModelScopeSkillRecord[]; total?: number } };
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
  const payload = (await response.json()) as { data?: ModelScopeSkillRecord };
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

  // ModelScope records can include an upstream webpage (for example, ClawHub) in
  // source_url. Keep that for attribution only; installations must be resolved
  // through the ModelScope skill endpoint.
  const installSource = buildModelScopeSkillPageUrl(skillId);
  const sourceUrl = readNonEmptyString(skill.source_url) || buildModelScopeSkillPageUrl(skillId);
  const iconUrl = readNonEmptyString(skill.logo_url);
  const description = buildLocalizedDescription(skill);

  return {
    id: skillId,
    name: readNonEmptyString(skill.display_name) || skillId,
    description,
    stats: {
      downloads: typeof skill.downloads === 'number' ? skill.downloads : 0,
    },
    url: buildModelScopeSkillPageUrl(skillId),
    ...(iconUrl ? { iconUrl } : {}),
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
  const zh =
    readNonEmptyString(skill.locales?.zh?.description) ||
    readNonEmptyString(skill.description) ||
    '';
  const en = readNonEmptyString(skill.locales?.en?.description) || zh;
  return { zh, en };
}

function normalizePageNumber(value: number | undefined): number {
  return Number.isInteger(value) && value > 0
    ? value
    : MODELSCOPE_SKILL_MARKETPLACE.DefaultPageNumber;
}

function sortMarketplaceSkills(skills: MarketplaceSkillRecord[]): MarketplaceSkillRecord[] {
  return [...skills].sort((left, right) => {
    const downloadDelta = (right.stats.downloads ?? 0) - (left.stats.downloads ?? 0);
    if (downloadDelta !== 0) {
      return downloadDelta;
    }
    return left.name.localeCompare(right.name);
  });
}

function normalizePageSize(value: number | undefined): number {
  if (!Number.isInteger(value) || value <= 0) {
    return MODELSCOPE_SKILL_MARKETPLACE.DefaultPageSize;
  }
  return Math.min(value, MODELSCOPE_SKILL_MARKETPLACE.MaximumPageSize);
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}
