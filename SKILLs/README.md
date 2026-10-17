# 技能贡献指南 / Skill contributor guide

本目录存放知远智能体 (ZhiYuan Agent) 的内置技能，不是 IDE 插件。新增或改进技能前，请先阅读仓库的 [AGENTS.md](../AGENTS.md) 与 [DEVOPS.md](../DEVOPS.md)。

This directory contains the built-in Skills for 知远智能体 (ZhiYuan Agent), not IDE plugins. Read the repository's [AGENTS.md](../AGENTS.md) and [DEVOPS.md](../DEVOPS.md) before contributing.

## 1. 目录结构 / Directory layout

一个技能一个目录，入口文件必须叫 `SKILL.md`。以下是现有 [docx](docx/SKILL.md) 技能的部分结构；辅助目录按需添加，不必复制整个技能。

Each Skill has its own directory and a `SKILL.md` entry point. This is a partial tree of the existing [docx](docx/SKILL.md) Skill; supporting directories are optional.

```text
SKILLs/
├── README.md
├── skills.config.json
└── docx/
    ├── SKILL.md
    ├── LICENSE
    ├── scripts/
    │   ├── env_check.sh
    │   └── markdown_to_docx.mjs
    ├── references/
    │   └── scenario_a_create.md
    ├── assets/
    │   ├── styles/
    │   └── xsd/
    └── zhiyuan/
        ├── metadata.yaml
        ├── icon.png
        └── icon.svg
```

| 路径 / Path | 用途 / Purpose |
| --- | --- |
| `SKILL.md` | YAML 元数据与执行说明，必需。Required YAML frontmatter and task instructions. |
| `scripts/` | 可重复执行的辅助脚本。Reusable helper scripts. |
| `references/` | 按需读取的详细说明，正文应链接并说明何时读取。Detailed references linked from the instructions with guidance on when to read them. |
| `assets/` | 模板、样式、校验规则等静态资源。Static templates, styles, validation schemas, and other resources. |
| `zhiyuan/` | 可选的产品展示元数据与图标；参见 [docx 的 metadata.yaml](docx/zhiyuan/metadata.yaml)。Optional product display metadata and icons; see the DOCX example. |
| `LICENSE` | 适用的许可文本，保留引入资源的授权与署名。Applicable license text; preserve licenses and attribution for imported resources. |

目录名是应用使用的技能 ID。它不一定等于 frontmatter 的 `name`：`docx/SKILL.md` 的 `name` 是 `minimax-docx`，但配置与工具调用使用 `docx`。新技能建议使用清晰的、小写连字符目录名，并让 `name` 与目录名一致。

The directory name is the application's Skill ID. It need not equal the frontmatter `name`: `docx/SKILL.md` uses `minimax-docx`, while configuration and tool calls use `docx`. For new Skills, prefer a clear lowercase hyphenated directory name and a matching `name`.

## 2. 编写 SKILL.md / Writing SKILL.md

文件开头是由 `---` 包围的 YAML 对象，后面是 Markdown 指令。下面是新技能的最小示例，不代表已注册的内置技能；替换名称、触发描述与正文后使用。

Start with a YAML object between `---` delimiters, followed by Markdown instructions. This minimal example is a template, not a registered built-in Skill; replace the name, trigger description, and instructions.

```markdown
---
name: summarize-notes
description: "Summarize user-provided notes into decisions and action items. Use when the user asks for a summary of their notes; do not use to invent missing meeting details."
---

# Summarize notes

## Inputs

Ask for the source notes if they are missing.

## Workflow

1. Read the supplied notes and identify decisions and action items.
2. Preserve names and dates from the source; mark missing details as unconfirmed.
3. Return a concise Markdown summary.

## Validation

Check that every decision and action item is supported by the source notes.
```

字段规则以现有 [frontmatter 校验器](../scripts/validate-skill-frontmatter.cjs) 为准。当前只允许以下顶层字段，不要从其他框架照搬字段。

The existing [frontmatter validator](../scripts/validate-skill-frontmatter.cjs) is the source of truth. It currently allows only these top-level keys; do not copy unsupported fields from other frameworks.

| 字段 / Field | 要求 / Requirement |
| --- | --- |
| `name` | 必需字符串，匹配 `^[a-z0-9]+(?:-[a-z0-9]+)*$`，例如 `meeting-recap`。Required lowercase hyphen-case string. |
| `description` | 必需的非空字符串，说明用途、触发条件与不适用场景。Required nonempty string describing purpose, triggers, and exclusions. |
| `license` | 可选，填写实际许可；现有例子使用 `MIT`，不要未经核实照抄。Optional; use the actual license, not an unverified copy of an example. |
| `allowed-tools` | 校验器允许的可选字段；不是本指南要求的字段，也不能作为绕过应用权限的依据。Optional accepted key; not required by this guide and not a way to bypass application permissions. |
| `metadata` | 可选 YAML 对象；例如 [docx](docx/SKILL.md) 的 `version`、`category`、`author`、`sources`。Optional YAML object; see DOCX for existing examples. |

版本信息使用 `metadata.version`（例如 `"1.0.1"`），不要添加顶层 `version`、`author`、`official` 或 `icon`，它们不在当前校验器的允许列表中。应用的解析兼容行为不等于贡献格式要求。

Put version information in `metadata.version` (for example, `"1.0.1"`). Do not add top-level `version`, `author`, `official`, or `icon`: the current validator does not allow them. Parser tolerance does not define the contribution format.

正文应说明输入、执行步骤、输出、验证方法与依赖缺失时的处理。长篇参考资料放入 `references/`，只在需要时读取；相对资源路径以 `SKILL.md` 所在目录为基准。可参考 [docx](docx/SKILL.md) 的任务分流与 [meeting-recap](meeting-recap/SKILL.md) 的输入、流程、输出结构。

Explain inputs, steps, outputs, validation, and what to do when dependencies are unavailable. Keep detailed background in `references/` and load it only when needed. Resolve relative resource paths from the directory containing `SKILL.md`. See [docx](docx/SKILL.md) for workflow routing and [meeting-recap](meeting-recap/SKILL.md) for input, workflow, and output organization.

## 3. 脚本与内置注册 / Scripts and bundled registration

在应用内执行技能脚本时，指引模型使用 `run_skill_script`，不要自行拼接解释器 shell 命令。`skillId` 是目录 ID，`script` 相对技能目录，`args` 是字符串数组。例如 DOCX 的转换调用如下；输入文件应已存在于工作区。

For in-app execution, instruct the agent to use `run_skill_script`, not hand-built interpreter shell commands. `skillId` is the directory ID, `script` is relative to that directory, and `args` is an array of strings. For example, with an existing Markdown input in the workspace:

```json
{
  "skillId": "docx",
  "script": "scripts/markdown_to_docx.mjs",
  "args": ["content.md", "output.docx"]
}
```

工具契约见 [脚本工具实现](../src/main/libs/agentEngine/piSkillScriptTool.ts)。如需 Python 或其他运行时依赖，应遵循 [AGENTS.md 的托管运行时规则](../AGENTS.md)，明确前置条件，不要求用户修改系统环境来绕过托管检查。

See the [script tool implementation](../src/main/libs/agentEngine/piSkillScriptTool.ts) for the contract. Follow the managed-runtime rules in [AGENTS.md](../AGENTS.md) for Python and other dependencies. Document prerequisites rather than asking users to bypass managed checks by changing their system environment.

新增技能若要随应用作为内置技能同步，需要在 [skills.config.json](skills.config.json) 的 `defaults` 中以目录 ID 登记，并明确 `order` 与 `enabled`；仅创建目录不够。现有条目示例：`"docx": { "order": 10, "enabled": true }`。同步与加载逻辑见 [skillManager.ts](../src/main/skillManager.ts)。不要为文档修改顺带调整其他技能配置。

To ship a new Skill through bundled synchronization, register its directory ID under `defaults` in [skills.config.json](skills.config.json), with explicit `order` and `enabled` values. Creating a directory alone is not enough. An existing entry is `"docx": { "order": 10, "enabled": true }`. See [skillManager.ts](../src/main/skillManager.ts) for synchronization and loading. Do not change unrelated Skill configuration as part of a documentation update.

## 4. 本地验证 / Local validation

从仓库根目录运行。需要 Node.js `>=24 <25`、Bun `>=1.3`，并先通过 `bun install` 安装项目依赖。

Run from the repository root with Node.js `>=24 <25`, Bun `>=1.3`, and project dependencies installed using `bun install`.

```bash
bun run validate:skills
bunx vitest run src/main/skillManager.test.ts
bun run lint
bun run format:check
```

- `validate:skills` 递归检查 `SKILLs/` 下的 `SKILL.md`：YAML、允许字段、名称格式及非空描述。它不验证脚本执行、引用文件是否存在、默认配置注册或输出质量。
- `skillManager.test.ts` 覆盖元数据解析等基础行为，不代表新技能的工作流已通过。
- 当前格式化配置忽略 `SKILLs/` 与 Markdown；`format:check` 不能代替文档链接、示例与内容检查。

- `validate:skills` recursively checks `SKILL.md` files under `SKILLs/` for YAML, allowed fields, name format, and nonempty descriptions. It does not validate script execution, reference existence, default registration, or output quality.
- `skillManager.test.ts` covers behavior such as metadata parsing, not the correctness of a new Skill's workflow.
- The current formatter ignores `SKILLs/` and Markdown. `format:check` does not replace checking documentation links, examples, and content.

修改脚本时，还需运行对应测试或补充有代表性的冒烟测试，例如 [PDF 冒烟测试](../tests/pdfSkillSmoke.test.ts) 与 [XLSX 冒烟测试](../tests/xlsxSkillSmoke.test.ts)。按各技能说明准备依赖，使用测试输入，检查实际输出而不只是退出码。

When changing scripts, run the relevant tests or add a representative smoke test; see the [PDF](../tests/pdfSkillSmoke.test.ts) and [XLSX](../tests/xlsxSkillSmoke.test.ts) examples. Prepare the documented dependencies, use test inputs, and inspect the output rather than only the exit code.

对技能行为的修改，使用 `bun run electron:dev` 在应用中验证：确认技能可见且启用，用匹配请求验证触发与输出，再测试不匹配请求、缺少输入及依赖不可用的情况。确认应用实际加载的是修改后的技能副本；内置源会同步到用户数据目录，不能仅凭源码已修改就认为应用已刷新。纯文档修改不需要声称完成了应用验收。

For behavior changes, use `bun run electron:dev`: confirm the Skill is visible and enabled, test a matching request and its output, then test an unrelated request, missing input, and unavailable dependencies. Verify that the app loaded the edited Skill copy; bundled sources are synchronized to user data, so a source edit alone does not prove that the loaded copy was refreshed. Documentation-only changes do not imply app-level validation.

## 5. 提交前检查 / Before submitting

- [ ] 元数据符合校验器，所有引用路径与示例文件存在。Frontmatter passes validation; referenced paths and example files exist.
- [ ] 触发条件、输入、输出、依赖与失败处理明确。Triggers, inputs, outputs, dependencies, and failure handling are clear.
- [ ] 不提交密钥、用户数据、生成产物或本地依赖目录。No secrets, user data, generated outputs, or local dependency directories are committed.
- [ ] PR 说明仅覆盖本次改动，记录实际验证命令、结果和未验证项。The PR stays scoped and records actual checks, results, and unverified items.

提交与 PR 遵循 [DEVOPS.md](../DEVOPS.md) 及 [AGENTS.md](../AGENTS.md) 的当前冻结期要求，不绕过检查或评审。

Follow [DEVOPS.md](../DEVOPS.md) and the current code-freeze requirements in [AGENTS.md](../AGENTS.md); do not bypass checks or review.
