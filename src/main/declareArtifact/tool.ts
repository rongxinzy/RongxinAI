import { access, constants as FsConstants } from 'node:fs/promises';

const DeclareArtifactToolName = 'declare_artifact';

export const DeclareArtifactSystemPrompt = [
  '## Artifact declaration',
  '',
  '- Files you write, edit or generate (including with bash or python) are recorded automatically; you do not need to declare every file.',
  '- Call `declare_artifact` only to annotate a file: mark the final output the user asked for as role "deliverable" (optionally with a `title`), or mark a file as "intermediate".',
  '- Deliverables default to the current workspace; when the user asks for an output at a specific location outside the workspace, declare that absolute path directly — it is accepted and recorded as an external deliverable. Intermediate files always stay in the workspace.',
  '- Declare only after the write has completed; the tool briefly waits for a file that is still being written.',
].join('\n');

type DeclareArtifactToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  details: Record<string, unknown>;
};

export interface DeclaredArtifactInput {
  filePath: string;
  title?: string;
  kind?: string;
  role: 'intermediate' | 'deliverable';
}

export interface DeclareArtifactToolOptions {
  onDeclare?: (artifact: DeclaredArtifactInput) => void | Promise<void>;
  fileExists?: (filePath: string) => Promise<boolean>;
  /** When provided, a declaration for a not-yet-existing file waits for the
   * recorder's pending write/edit of the same file (models often emit `write`
   * and `declare_artifact` in one parallel tool block) instead of failing. */
  awaitPendingWrite?: (filePath: string) => Promise<boolean>;
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/** Race a pending-write wait against tool abortion: an aborted declaration
 * stops waiting immediately instead of parking until the write settles. */
function raceWithAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T | null> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.resolve(null);
  return new Promise<T | null>(resolve => {
    const onAbort = (): void => resolve(null);
    signal.addEventListener('abort', onAbort, { once: true });
    void promise.then(value => {
      signal.removeEventListener('abort', onAbort);
      resolve(value);
    });
  });
}

async function defaultFileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, FsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

const failure = (
  message: string,
  details: Record<string, unknown> = {},
): DeclareArtifactToolResult => ({
  content: [{ type: 'text', text: message }],
  details: { isError: true, error: message, ...details },
});

export function buildDeclareArtifactTool(
  options: DeclareArtifactToolOptions = {},
): Record<string, unknown> {
  const fileExists = options.fileExists ?? defaultFileExists;

  const ensureFilePresent = async (filePath: string, signal?: AbortSignal): Promise<boolean> => {
    if (await fileExists(filePath)) return true;
    // A parallel write/edit of the same file may still be in flight; wait for
    // the recorder to settle it, then re-check existence.
    if (options.awaitPendingWrite) {
      const settled = await raceWithAbort(options.awaitPendingWrite(filePath), signal);
      if (settled) return fileExists(filePath);
    }
    return false;
  };

  return {
    name: DeclareArtifactToolName,
    label: 'Declare Artifact',
    description:
      'Annotate an already-produced file with its role and title. ' +
      'Produced files are recorded automatically; call this to mark the final deliverable ' +
      '(or an intermediate file). The file path must be absolute.',
    parameters: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: 'Absolute path to the produced file.',
        },
        title: {
          type: 'string',
          description: 'Optional display name. Defaults to the file name.',
        },
        kind: {
          type: 'string',
          description:
            'Optional artifact kind hint. One of: html, svg, mermaid, code, markdown, document, image, text, model.',
        },
        role: {
          type: 'string',
          enum: ['intermediate', 'deliverable'],
          description:
            'Whether this is an intermediate work-in-progress or a final deliverable. Default: deliverable.',
        },
      },
      required: ['filePath'],
      additionalProperties: false,
    },
    execute: async (
      _toolCallId: string,
      params: Record<string, unknown>,
      signal?: AbortSignal,
    ): Promise<DeclareArtifactToolResult> => {
      const filePath = text(params.filePath);
      if (!filePath) {
        return failure('declare_artifact requires a non-empty file path.');
      }
      if (!(await ensureFilePresent(filePath, signal))) {
        return failure(
          `declare_artifact failed: file does not exist at ${filePath}. Create the file before declaring it.`,
          { filePath },
        );
      }
      const role = params.role === 'intermediate' ? 'intermediate' : 'deliverable';
      const title = text(params.title);
      const kind = text(params.kind);
      const fileName = filePath.split(/[/\\]/).pop() || filePath;
      try {
        await options.onDeclare?.({
          filePath,
          role,
          ...(title ? { title } : {}),
          ...(kind ? { kind } : {}),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return failure(`Artifact declaration failed: ${message}`, { filePath, role });
      }
      return {
        content: [
          {
            type: 'text',
            text: `Artifact declared: ${fileName} (${role})`,
          },
        ],
        details: {
          filePath,
          role,
          ...(title ? { title } : {}),
          ...(kind ? { kind } : {}),
        },
      };
    },
  };
}
