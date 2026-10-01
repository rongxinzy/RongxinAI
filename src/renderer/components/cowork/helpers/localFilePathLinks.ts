/**
 * 2026/09/20 lixiang  Chat markdown 本地路径高亮与打开（issue #805）
 * Streamdown 默认不会把 inline code / 裸路径变成可点链接；此处预处理为 markdown 链接，
 * 并由自定义锚点走 shell.openPath / showItemInFolder。
 *
 * 注意：不能用 file:// —— Streamdown 内置 rehype-harden 会永久拦截 file:，
 * 把链接替换成「原文 [blocked]」span。改用 https 合成地址以通过 sanitize/harden，
 * 再解码回本地路径（相对路径/文件名由会话 cwd 拼成绝对路径）。
 *
 * 规则：只有带文件扩展名（.xxx）的路径/文件名才高亮可点；目录等无后缀不加样式。
 */

/** Synthetic https link that survives Streamdown sanitize + harden. */
export const LocalPathHref = {
  Prefix: 'https://zr-local.path/open?path=',
} as const;

const WINDOWS_PATH_RE = /^[A-Za-z]:[\\/]/;
const FILE_URL_RE = /^file:\/\//i;
/** Any trailing file extension (1–16 alnum). CamelCase tails like `.useState` are rejected separately. */
const ANY_FILE_EXTENSION_RE = /\.([A-Za-z0-9]{1,16})$/;

/**
 * True when the string ends with a real-looking file extension.
 * Accepts mp3/wav/pdf/…; rejects identifier-like tails, sizes (1.42GB), versions.
 */
export const hasLikelyFileExtension = (value: string): boolean => {
  const match = ANY_FILE_EXTENSION_RE.exec(value);
  if (!match) return false;
  const ext = match[1];
  // Mixed-case extension → almost certainly a JS/TS identifier, not a file type
  if (/[A-Z]/.test(ext) && /[a-z]/.test(ext)) return false;
  if (/^v?\d+(\.\d+)+$/i.test(value)) return false;
  // 体积/百分比等：1.42GB、93%、12MB
  if (/^\d+(\.\d+)?(kb|mb|gb|tb|b|%)$/i.test(value)) return false;
  if (/^\d+(\.\d+)?%$/i.test(value)) return false;
  // 扩展名以数字开头多半是 1.42GB 被拆成 .42GB
  if (/^\d/.test(ext)) return false;
  return true;
};

const normalizePathCandidate = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const fromSynthetic = parseLocalPathHref(trimmed);
  if (fromSynthetic) return fromSynthetic;
  if (FILE_URL_RE.test(trimmed)) return stripFileProtocol(trimmed);
  return trimmed;
};

export const isLikelyLocalFilePath = (href: string): boolean => {
  if (!href) return false;
  const trimmed = href.trim();
  if (parseLocalPathHref(trimmed)) return true;
  if (FILE_URL_RE.test(trimmed)) return true;
  if (WINDOWS_PATH_RE.test(trimmed)) return true;
  if (trimmed.startsWith('/') || trimmed.startsWith('./') || trimmed.startsWith('../')) {
    return true;
  }
  // 带 scheme 的 http(s)/mailto 等不当本地路径
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) && !WINDOWS_PATH_RE.test(trimmed)) return false;
  return false;
};

/**
 * Local file ref that should be highlighted / opened.
 * 必须带扩展名；盘符目录、无后缀路径不链（issue #805）。
 */
export const isWorkspaceFileRef = (value: string): boolean => {
  if (!value) return false;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 260) return false;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) && !parseLocalPathHref(trimmed)) return false;
  if (trimmed.includes('\n') || trimmed.includes('`')) return false;

  const normalized = normalizePathCandidate(trimmed);
  if (!normalized || !hasLikelyFileExtension(normalized)) return false;
  // Too many spaces → likely a sentence, not a filename
  if ((normalized.match(/\s/g) ?? []).length > 2) return false;

  if (parseLocalPathHref(trimmed) || FILE_URL_RE.test(trimmed) || WINDOWS_PATH_RE.test(normalized)) {
    return true;
  }
  if (normalized.startsWith('/') || normalized.startsWith('./') || normalized.startsWith('../')) {
    return true;
  }
  if (/[\\/]/.test(normalized)) return true;
  return !/^[a-z][a-z0-9+.-]*:/i.test(normalized);
};

/** Encode a filesystem path into a harden-safe https href. */
export const toFileHref = (filePath: string): string => {
  const normalized = filePath.replace(/\\/g, '/');
  return `${LocalPathHref.Prefix}${encodeURIComponent(normalized)}`;
};

export const stripFileProtocol = (href: string): string => {
  if (!FILE_URL_RE.test(href)) return href;
  let path = href.replace(FILE_URL_RE, '');
  // file:///C:/... → C:/...
  if (/^\/[A-Za-z]:/.test(path)) {
    path = path.slice(1);
  }
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
};

/** Decode synthetic local-path href or legacy file:// back to a filesystem path. */
export const parseLocalPathHref = (href: string): string | null => {
  const trimmed = href.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith(LocalPathHref.Prefix)) {
    const encoded = trimmed.slice(LocalPathHref.Prefix.length);
    try {
      return decodeURIComponent(encoded);
    } catch {
      return encoded || null;
    }
  }

  // Also accept URL-parsed form where `?path=` may appear with other query order
  try {
    const url = new URL(trimmed);
    if (url.hostname === 'zr-local.path' && url.pathname === '/open') {
      const path = url.searchParams.get('path');
      if (path) return path;
    }
  } catch {
    // not a URL
  }

  if (FILE_URL_RE.test(trimmed)) {
    return stripFileProtocol(trimmed);
  }

  return null;
};

const toMarkdownLocalLink = (rawPath: string): string => {
  const path = rawPath.trim();
  const localPath = FILE_URL_RE.test(path) ? stripFileProtocol(path) : path;
  return `[${localPath}](${toFileHref(localPath)})`;
};

/** 把 inline code / 裸路径 / 工作区文件名转成 markdown 链接（仅带扩展名） */
export const linkifyLocalPathsInMarkdown = (content: string): string => {
  if (!content) return content;

  // `path/file.ext` — 仅带扩展名的反引号内容
  let result = content.replace(/`([^`\n]+)`/g, (full, rawPath: string) => {
    const path = rawPath.trim();
    if (!isWorkspaceFileRef(path)) return full;
    return toMarkdownLocalLink(path);
  });

  // 裸 Windows 盘符文件路径（必须带扩展名）
  result = result.replace(
    /(^|[\s（(：:，,。；;])([A-Za-z]:[\\/][^\s`"'<>\]）)]+)/g,
    (full, prefix: string, path: string) => {
      if (full.includes('](')) return full;
      if (!isWorkspaceFileRef(path)) return full;
      return `${prefix}${toMarkdownLocalLink(path)}`;
    },
  );

  // 裸文件名/相对路径（带扩展名）
  result = result.replace(
    /(^|[\s（(：:，,。；;「『"'])((?:[\w.\u4e00-\u9fff\-]+[\\/])*[\w.\u4e00-\u9fff\-]+\.[A-Za-z0-9]{1,16})(?=$|[\s）)：:，,。；;」』"'])/g,
    (full, prefix: string, path: string) => {
      if (full.includes('](')) return full;
      if (!isWorkspaceFileRef(path)) return full;
      return `${prefix}${toMarkdownLocalLink(path)}`;
    },
  );

  return result;
};

export const resolveOpenableLocalPath = (
  href: string | undefined,
  text: string,
  resolveLocalFilePath?: (href: string, text: string) => string | null,
): string | null => {
  const hrefValue = (href ?? '').trim();
  const textValue = text.trim();
  const decodedHref = hrefValue ? parseLocalPathHref(hrefValue) : null;
  const pathCandidate = decodedHref ?? hrefValue;

  if (resolveLocalFilePath) {
    if (pathCandidate) {
      const resolved = resolveLocalFilePath(pathCandidate, textValue);
      if (resolved) return resolved;
    }
    if (textValue) {
      const fromText = resolveLocalFilePath(textValue, textValue);
      if (fromText) return fromText;
    }
  }

  if (decodedHref) return decodedHref;
  if (!pathCandidate) return null;
  if (isWorkspaceFileRef(pathCandidate) || isLikelyLocalFilePath(pathCandidate)) {
    return stripFileProtocol(pathCandidate.split('#')[0]?.split('?')[0] ?? pathCandidate);
  }
  return null;
};
