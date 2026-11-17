import { Button } from '@shared/components/ui/button';
import { useState, type ComponentProps } from 'react';
import { defaultRehypePlugins, type StreamdownProps } from 'streamdown';

import { normalizeArtifactPath } from '../../cowork/artifactPath';
import { i18nService } from '../../../renderer/services/i18n';
import { useResolvedLocalPathState } from '../../../renderer/services/useResolvedLocalPath';
import { toLocalfileUrl } from '../../../renderer/utils/localfileUrl';
import ImagePreviewModal from '../../../renderer/components/cowork/ImagePreviewModal';

const RELATIVE_IMAGE_PREFIX = '/?zy_rel=';
const UNC_IMAGE_PREFIX = '/__zy_unc__/';
const URI_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/i;

interface ImageNode {
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: ImageNode[];
}

const encodeRawAbsolutePath = (raw: string): string => {
  // Keep valid %-escapes intact (e.g. `/work/chart%20%231.png`) while encoding
  // literal characters such as `#`, `?`, spaces, and standalone `%` so `rehype-harden`'s
  // URL parser preserves the complete filename instead of splitting query/hash parts.
  return raw
    .replace(/%(?![0-9a-fA-F]{2})/g, '%25')
    .replace(/#/g, '%23')
    .replace(/\?/g, '%3F')
    .replace(/ /g, '%20');
};

/** Normalize only local image AST destinations before the unchanged sanitizer runs. */
const normalizeLocalImages = () => (tree: ImageNode) => {
  const nodes = [tree];
  while (nodes.length > 0) {
    const node = nodes.pop()!;
    for (const child of node.children ?? []) nodes.push(child);
    const src = node.properties?.src;
    if (node.tagName !== 'img' || typeof src !== 'string') continue;
    const trimmed = src.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) continue;

    if (/^(?:file|localfile):/i.test(trimmed) || /^[a-z]:[\\/]/i.test(trimmed)) {
      const native = normalizeArtifactPath(trimmed.replace(/^localfile:/i, 'file:'));
      if (native.startsWith('//')) {
        const [, , host, ...rest] = native.split('/');
        node.properties!.src = `${UNC_IMAGE_PREFIX}${encodeURIComponent(host ?? '')}/${rest.map(encodeURIComponent).join('/')}`;
      } else {
        const absolute = native.startsWith('/') ? native : `/${native}`;
        node.properties!.src = absolute.split('/').map(encodeURIComponent).join('/');
      }
      continue;
    }

    if (trimmed.startsWith('\\\\')) {
      const native = trimmed.replace(/\\/g, '/');
      const [, , host, ...rest] = native.split('/');
      node.properties!.src = `${UNC_IMAGE_PREFIX}${encodeURIComponent(host ?? '')}/${rest.map(encodeURIComponent).join('/')}`;
      continue;
    }

    // Leave URLs with explicit schemes (https:, http:, data:, blob:, javascript:, etc.) untouched
    // so rehype-sanitize and rehype-harden enforce standard URL policy on them.
    if (URI_SCHEME_PATTERN.test(trimmed)) continue;

    if (trimmed.startsWith('/')) {
      node.properties!.src = encodeRawAbsolutePath(trimmed);
      continue;
    }

    // Encode bare relative filenames (e.g. `chart.png`, `./chart.png`, `../out/图 #1.png`) as a
    // rooted query marker so `rehype-harden` neither blocks bare filenames nor turns `./` into root `/`.
    node.properties!.src = `${RELATIVE_IMAGE_PREFIX}${encodeURIComponent(encodeRawAbsolutePath(trimmed))}`;
  }
};

// Keep raw-HTML sanitization and link policy intact; local files still require
// main-process resolution and the privileged image protocol's validation.
export const localImageRehypePlugins: StreamdownProps['rehypePlugins'] = [
  defaultRehypePlugins.raw,
  normalizeLocalImages,
  defaultRehypePlugins.sanitize,
  defaultRehypePlugins.harden,
];

type LocalImageProps = ComponentProps<'img'> & {
  node?: unknown;
  cwd?: string;
  enabled: boolean;
};

const extractLocalImageCandidate = (raw: string): string => {
  if (raw.startsWith(RELATIVE_IMAGE_PREFIX)) {
    const unwrapped = decodeURIComponent(raw.slice(RELATIVE_IMAGE_PREFIX.length));
    try {
      return normalizeArtifactPath(decodeURIComponent(unwrapped));
    } catch {
      return normalizeArtifactPath(unwrapped);
    }
  }
  if (raw.startsWith(UNC_IMAGE_PREFIX)) {
    const body = raw.slice(UNC_IMAGE_PREFIX.length);
    try {
      return `//${body.split('/').map(decodeURIComponent).join('/')}`;
    } catch {
      return `//${body}`;
    }
  }
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    /* A literal malformed escape remains a native filename. */
  }
  return normalizeArtifactPath(decoded);
};

export function MarkdownLocalImage({
  src,
  alt,
  cwd,
  enabled,
  node: _node,
  ...props
}: LocalImageProps) {
  const raw = typeof src === 'string' ? src : '';
  const remote = /^(?:https?:|data:image\/|blob:)/i.test(raw);
  const candidate = raw && !remote ? extractLocalImageCandidate(raw) : null;
  const [retry, setRetry] = useState(0);
  const resolved = useResolvedLocalPathState(candidate, cwd, enabled, retry);
  const baseSource = remote ? raw : resolved.path ? toLocalfileUrl(resolved.path) : '';
  const source =
    !remote && baseSource && retry > 0 ? `${baseSource}?revision=${retry}` : baseSource;
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const [expandedSource, setExpandedSource] = useState<string | null>(null);
  const label = alt || i18nService.t('artifactImageAlt');

  if (!enabled || resolved.pending) {
    return (
      <span className="theme-conversation-meta" role="status">
        {label} · {i18nService.t('loading')}
      </span>
    );
  }

  if (!source || failedSource === source) {
    return (
      <span className="inline-flex items-center gap-2 theme-conversation-meta" role="status">
        <span>
          {label} · {i18nService.t('imageReadError')}
        </span>
        {candidate || remote ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setFailedSource(null);
              setRetry(value => value + 1);
            }}
          >
            {i18nService.t('artifactImageRetry')}
          </Button>
        ) : null}
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        className="theme-conversation-image-action inline-flex max-w-full"
        aria-label={label}
        onClick={() => setExpandedSource(source)}
      >
        <img
          key={`${source}:${retry}`}
          {...props}
          src={source}
          alt={label}
          className="theme-conversation-image block max-h-96 max-w-full object-contain"
          onError={() => setFailedSource(source)}
        />
      </button>
      {expandedSource === source && (
        <ImagePreviewModal
          image={{ src: source, alt: label }}
          onClose={() => setExpandedSource(null)}
        />
      )}
    </>
  );
}
