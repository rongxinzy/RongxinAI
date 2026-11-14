/** Application resources installed directly into Pi Durable's registry. */
import { CodemodeSandbox } from '@earendil-works/pi-codemode';
import {
  defineExtension,
  section,
  type Extension,
  type ToolRegistration,
} from '@earendil-works/pi-durable';
import { createCodemodeExtension } from '@earendil-works/pi-durable/codemode';
import { createToolSearchExtension } from '@earendil-works/pi-durable/tool-search';
import { WorkbenchApprovalMode } from '../../../shared/workbenchTask';
import { buildDurableMcpTools } from './durableMcpTools';
import { createDurableResourcePolicy } from './durableResourcePolicy';
import { formatDurableSkills, loadDurableSkills, type DurableSkills } from './durableSkills';
import { CHAT_IDENTITY_PROMPT, getZhiyuanProductPreamble } from './piPromptOverrides';
import { resolveSelectedSkillDirs, resolveZhiyuanSkillDirs } from './piRuntimeSkillDirs';
import { collectPiSystemPromptContributions } from './piSystemPromptContributions';
import type { PiRuntimeAdapterHost } from './piRuntimeAdapterHost';
import type { PiResourceLoader, PiResourceState } from './piRuntimeSessionState';

export interface PiResourceLoaderApprovalContext {
  sessionId: string;
  getRunId: () => string | null;
  getApprovalMode: () => WorkbenchApprovalMode;
  enableCodemode?: boolean;
  expertMcpIds?: string[];
}

class DurableResources implements PiResourceLoader {
  private skills: DurableSkills = { skills: [], diagnostics: [] };
  private installed: Extension[] = [];
  private sandbox: CodemodeSandbox | null = null;

  constructor(
    private readonly host: PiRuntimeAdapterHost,
    private readonly cwd: string,
    private readonly state: PiResourceState,
    private readonly approval: PiResourceLoaderApprovalContext | undefined,
    private readonly additional: readonly Extension[],
  ) {}

  get extensions(): Extension[] {
    return this.installed;
  }

  getSkills(): DurableSkills {
    return this.skills;
  }

  getSystemPrompt(): string {
    return [
      getZhiyuanProductPreamble(),
      ...collectPiSystemPromptContributions(this.state),
      this.state.systemPrompt.trim(),
      ...(this.state.chatMode ? [CHAT_IDENTITY_PROMPT] : []),
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  async reload(): Promise<void> {
    const roots = [
      ...(this.state.chatMode || this.state.nativeToolsOnly
        ? resolveSelectedSkillDirs(this.state.skillIds)
        : resolveZhiyuanSkillDirs()),
      ...this.state.expertSkillDirs,
    ];
    this.skills = await loadDurableSkills(roots, this.state.skillIds);
    const mcp: { tools: ToolRegistration[] } =
      !this.state.chatMode && !this.state.nativeToolsOnly
        ? buildDurableMcpTools(this.host.getMcpServerManager(), this.approval?.expertMcpIds)
        : { tools: [] };
    const codeMode =
      !this.state.chatMode &&
      !this.state.nativeToolsOnly &&
      (this.approval?.enableCodemode === true ||
        mcp.tools.some(tool => tool.callers?.includes('tools') && !tool.callers.includes('model')));
    if (codeMode && !this.sandbox) this.sandbox = new CodemodeSandbox();
    this.installed = [
      defineExtension({
        name: 'zhiyuan.resources',
        tools: mcp.tools,
        sections: [
          section('cwd', () => (this.state.chatMode ? undefined : this.cwd)),
          section('available_skills', () => formatDurableSkills(this.skills.skills)),
          section('tools', input =>
            this.state.chatMode
              ? undefined
              : input.agent.tools.map(tool => `- ${tool.name}: ${tool.description}`).join('\n') ||
                '(none)',
          ),
          section(
            'rules',
            () => 'Be concise in your responses. Show file paths clearly when working with files.',
          ),
        ],
      }),
      createDurableResourcePolicy(this.host, this.approval),
      ...(codeMode && this.sandbox ? [createCodemodeExtension({ sandbox: this.sandbox })] : []),
      ...(codeMode || mcp.tools.some(tool => tool.deferred) ? [createToolSearchExtension()] : []),
      ...this.additional,
    ];
  }

  async close(): Promise<void> {
    await this.sandbox?.close();
  }
}

export async function createPiRuntimeResourceLoader(
  host: PiRuntimeAdapterHost,
  cwd: string,
  state: PiResourceState,
  approval?: PiResourceLoaderApprovalContext,
  additional: readonly Extension[] = [],
): Promise<PiResourceLoader> {
  const resources = new DurableResources(host, cwd, state, approval, additional);
  await resources.reload();
  return resources;
}
