type SkillMarketplaceItem = Record<string, unknown>;

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeSiteUrl(siteUrl: string): string {
  return siteUrl.replace(/\/+$/, '');
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  return value as Record<string, unknown>;
}

function readOwnerSlugFromRecord(record: Record<string, unknown> | null): string | null {
  if (!record) return null;
  return readNonEmptyString(record.slug)
    || readNonEmptyString(record.username)
    || readNonEmptyString(record.handle)
    || readNonEmptyString(record.login)
    || readNonEmptyString(record.ownerSlug)
    || readNonEmptyString(record.owner)
    || readNonEmptyString(record.id);
}

function readSkillSlug(item: SkillMarketplaceItem): string | null {
  return readNonEmptyString(item.slug)
    || readNonEmptyString(item.name)
    || readNonEmptyString(item.id);
}

export function findAmbiguousClawHubSkillSlugs(items: SkillMarketplaceItem[]): Set<string> {
  const slugCounts = new Map<string, number>();

  for (const item of items) {
    const slug = readSkillSlug(item);
    if (!slug) continue;
    slugCounts.set(slug, (slugCounts.get(slug) ?? 0) + 1);
  }

  return new Set(
    Array.from(slugCounts.entries())
      .filter(([, count]) => count > 1)
      .map(([slug]) => slug),
  );
}

function parseClawHubPathParts(value: unknown): { ownerSlug: string | null; slug: string | null } | null {
  const raw = readNonEmptyString(value);
  if (!raw) return null;

  try {
    const parsed = raw.startsWith('http://') || raw.startsWith('https://')
      ? new URL(raw)
      : new URL(raw.startsWith('/') ? raw : `/${raw}`, 'https://clawhub.ai');
    const segments = parsed.pathname.split('/').filter(Boolean);
    if (segments.length >= 3 && segments[0] === 'skills') {
      return { ownerSlug: readNonEmptyString(segments[1]), slug: readNonEmptyString(segments[2]) };
    }
    if (segments.length >= 2) {
      return { ownerSlug: readNonEmptyString(segments[0]), slug: readNonEmptyString(segments[1]) };
    }
    if (segments.length === 1 && segments[0] !== 'skills') {
      return { ownerSlug: null, slug: readNonEmptyString(segments[0]) };
    }
  } catch {
    return null;
  }

  return null;
}

function getOwnerSlug(item: SkillMarketplaceItem): string | null {
  const ownerFromRecords =
    readOwnerSlugFromRecord(readRecord(item.owner))
    || readOwnerSlugFromRecord(readRecord(item.author))
    || readOwnerSlugFromRecord(readRecord(item.publisher));
  if (ownerFromRecords) return ownerFromRecords;

  const ownerFromFields =
    readNonEmptyString(item.ownerSlug)
    || readNonEmptyString(item.ownerUsername)
    || readNonEmptyString(item.ownerHandle)
    || readNonEmptyString(item.ownerId)
    || readNonEmptyString(item.publisherSlug)
    || readNonEmptyString(item.authorSlug);
  if (ownerFromFields) return ownerFromFields;

  const pathCandidates = [
    item.url,
    item.path,
    item.canonicalUrl,
    item.webUrl,
    item.htmlUrl,
    item.sourceUrl,
  ];
  for (const candidate of pathCandidates) {
    const parsed = parseClawHubPathParts(candidate);
    if (parsed?.ownerSlug) return parsed.ownerSlug;
  }

  return null;
}

function getResolvedSkillParts(item: SkillMarketplaceItem): { ownerSlug: string | null; slug: string | null } {
  const parsedPath =
    parseClawHubPathParts(item.url)
    || parseClawHubPathParts(item.path)
    || parseClawHubPathParts(item.canonicalUrl)
    || parseClawHubPathParts(item.webUrl)
    || parseClawHubPathParts(item.htmlUrl)
    || parseClawHubPathParts(item.sourceUrl);

  return {
    ownerSlug: getOwnerSlug(item) || parsedPath?.ownerSlug || null,
    slug: readSkillSlug(item) || parsedPath?.slug || null,
  };
}

function extractClawHubSkillDetail(payload: unknown): SkillMarketplaceItem | null {
  const record = readRecord(payload);
  if (!record) return null;

  const skillRecord = readRecord(record.skill);
  if (skillRecord) {
    return {
      ...skillRecord,
      owner: record.owner ?? skillRecord.owner,
      latestVersion: record.latestVersion ?? skillRecord.latestVersion,
      metadata: record.metadata ?? skillRecord.metadata,
      moderation: record.moderation ?? skillRecord.moderation,
    };
  }

  if (readSkillSlug(record)) {
    return record;
  }

  return null;
}

export function buildClawHubSkillSourceUrl(siteUrl: string): string {
  return normalizeSiteUrl(siteUrl);
}

export function buildClawHubSkillInstallSource(item: SkillMarketplaceItem): string | null {
  const { slug } = getResolvedSkillParts(item);
  return slug ? `clawhub:${slug}` : null;
}

export function buildClawHubSkillPageUrl(siteUrl: string, item: SkillMarketplaceItem): string {
  const normalizedSiteUrl = normalizeSiteUrl(siteUrl);
  const { ownerSlug, slug } = getResolvedSkillParts(item);

  if (ownerSlug && slug) {
    return `${normalizedSiteUrl}/${ownerSlug}/${slug}`;
  }
  if (slug) {
    return `${normalizedSiteUrl}/skills/${slug}`;
  }
  return `${normalizedSiteUrl}/skills`;
}

export function mergeClawHubSkillDetail(
  item: SkillMarketplaceItem,
  payload: unknown,
): SkillMarketplaceItem {
  const detail = extractClawHubSkillDetail(payload);
  if (!detail) return item;
  return {
    ...item,
    ...detail,
    owner: detail.owner ?? item.owner,
  };
}
