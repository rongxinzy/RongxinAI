import type { CoworkMessage, CoworkPersistedArtifact } from './coworkStore';

const DECLARE_ARTIFACT_TOOL = 'declare_artifact';
const WRITE_TOOL_NAMES = new Set(['write', 'writefile', 'write_file']);

function normalizeToolName(name: string): string {
  return name.toLowerCase().replace(/[_\s]/g, '');
}

function getFileName(filePath: string): string {
  const lastSlash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  return lastSlash === -1 ? filePath : filePath.slice(lastSlash + 1);
}

function getFileExtension(filePath: string): string {
  const lastDot = filePath.lastIndexOf('.');
  if (lastDot === -1) return '';
  return filePath.slice(lastDot).toLowerCase();
}

function resolveArtifactType(filePath: string, declaredKind?: string): string {
  if (declaredKind) {
    const lower = declaredKind.toLowerCase();
    const languageTypes: Record<string, string> = {
      html: 'html', svg: 'svg', mermaid: 'mermaid',
      jsx: 'code', tsx: 'code', markdown: 'markdown', md: 'markdown',
      text: 'text', txt: 'text', plaintext: 'text',
    };
    if (languageTypes[lower]) return languageTypes[lower];
  }
  const ext = getFileExtension(filePath);
  const extensionTypes: Record<string, string> = {
    '.html': 'html', '.htm': 'html', '.svg': 'svg',
    '.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.gif': 'image', '.webp': 'image',
    '.mermaid': 'mermaid', '.mmd': 'mermaid',
    '.jsx': 'code', '.tsx': 'code', '.js': 'code', '.ts': 'code', '.css': 'code',
    '.json': 'code', '.yaml': 'code', '.yml': 'code', '.py': 'code',
    '.md': 'markdown', '.txt': 'text', '.log': 'text',
    '.csv': 'document', '.docx': 'document', '.xlsx': 'document', '.pptx': 'document', '.pdf': 'document',
  };
  return extensionTypes[ext] || 'code';
}

/**
 * Collect persisted artifact records from a full (non-paginated) list of
 * session messages. This runs on the main process where the complete message
 * history is available, so artifacts survive renderer-side pagination.
 */
export function collectSessionArtifacts(
  messages: CoworkMessage[],
): CoworkPersistedArtifact[] {
  const artifacts: CoworkPersistedArtifact[] = [];
  const seenPaths = new Set<string>();
  let index = 0;

  for (const msg of messages) {
    if (msg.type !== 'tool_use') continue;

    const toolName = msg.metadata?.toolName;
    if (!toolName) continue;

    const input = (msg.metadata?.toolInput || {}) as Record<string, unknown>;

    // declare_artifact tool calls
    if (toolName === DECLARE_ARTIFACT_TOOL) {
      const filePath = typeof input.filePath === 'string' ? input.filePath.trim() : '';
      if (!filePath) continue;

      const normalized = filePath.replace(/\\/g, '/').toLowerCase();
      if (seenPaths.has(normalized)) continue;
      seenPaths.add(normalized);

      const declaredRole =
        input.role === 'intermediate' ? 'intermediate' : 'deliverable';
      const title =
        typeof input.title === 'string' && input.title.trim()
          ? input.title.trim()
          : getFileName(filePath);
      const kind = typeof input.kind === 'string' ? input.kind.trim() : undefined;

      artifacts.push({
        id: `artifact-declare-${msg.id}-${index}`,
        type: resolveArtifactType(filePath, kind),
        title,
        fileName: getFileName(filePath),
        filePath,
        source: 'tool',
        role: declaredRole,
        createdAt: msg.timestamp || Date.now(),
      });
      index++;
    }

    // Write tool calls
    const normalizedName = normalizeToolName(toolName);
    if (WRITE_TOOL_NAMES.has(normalizedName)) {
      const filePath = extractWriteToolPath(input);
      if (!filePath) continue;

      const normalized = filePath.replace(/\\/g, '/').toLowerCase();
      if (seenPaths.has(normalized)) continue;
      // Don't add if a declare_artifact with the same path already exists
      // (declare_artifact has more metadata)
      const existingDeclared = artifacts.find(
        a => a.filePath && a.filePath.replace(/\\/g, '/').toLowerCase() === normalized,
      );
      if (existingDeclared) continue;
      seenPaths.add(normalized);

      artifacts.push({
        id: `artifact-tool-${msg.id}`,
        type: resolveArtifactType(filePath),
        title: getFileName(filePath),
        fileName: getFileName(filePath),
        filePath,
        source: 'tool',
        role: 'deliverable', // auto-promoted on main process too
        createdAt: msg.timestamp || Date.now(),
      });
    }
  }

  return artifacts;
}

function extractWriteToolPath(input: Record<string, unknown>): string | null {
  for (const key of ['file_path', 'path', 'filePath', 'target_file', 'targetFile']) {
    const val = input[key];
    if (typeof val === 'string' && val.length > 0) return val;
  }
  return null;
}
