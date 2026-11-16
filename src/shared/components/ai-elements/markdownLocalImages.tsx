import { useState, type ComponentProps } from 'react';
import { defaultRehypePlugins, type StreamdownProps } from 'streamdown';

import { normalizeArtifactPath } from '../../cowork/artifactPath';
import { i18nService } from '../../../renderer/services/i18n';
import { useResolvedLocalPathState } from '../../../renderer/services/useResolvedLocalPath';
import { toLocalfileUrl } from '../../../renderer/utils/localfileUrl';
import ImagePreviewModal from '../../../renderer/components/cowork/ImagePreviewModal';

interface ImageNode {
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: ImageNode[];
}

/** Normalize only image AST destinations before the unchanged sanitizer runs. */
const normalizeLocalImages = () => (tree: ImageNode) => {
  const nodes = [tree];
  while (nodes.length > 0) {
    const node = nodes.pop()!;
    for (const child of node.children ?? []) nodes.push(child);
    const src = node.properties?.src;
    if (node.tagName !== 'img' || typeof src !== 'string') continue;
    if (/^(?:file|localfile):/i.test(src) || /^[a-z]:[\\/]/i.test(src)) {
      const native = normalizeArtifactPath(src.replace(/^localfile:/i, 'file:'));
      const absolute = native.startsWith('/') ? native : `/${native}`;
      node.properties!.src = absolute.split('/').map(encodeURIComponent).join('/');
    }
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
  let decoded = raw;
  if (!remote) {
    try {
      decoded = decodeURIComponent(raw);
    } catch {
      /* A literal malformed escape remains a native filename. */
    }
  }
  const candidate = raw && !remote ? normalizeArtifactPath(decoded) : null;
  const resolved = useResolvedLocalPathState(candidate, cwd, enabled);
  const source = remote ? raw : resolved.path ? toLocalfileUrl(resolved.path) : '';
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const [expandedSource, setExpandedSource] = useState<string | null>(null);
  const label = alt || i18nService.t('artifactImageAlt');

  if (!source || failedSource === source) {
    return (
      <span className="theme-conversation-meta" role="status">
        {label} · {i18nService.t(!enabled || resolved.pending ? 'loading' : 'imageReadError')}
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
