#!/usr/bin/env node
/**
 * Expert Initializer for ZhiYuan Agent.
 *
 * Creates a new expert package directory from template, compatible with
 * ZhiYuan Agent's Cowork runtime.
 *
 * Usage:
 *   node init_expert.js <expert-name> --type agent|team [--path <output-dir>]
 *
 * Output directory defaults to the ZhiYuan Agent user data directory.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

function getDefaultExpertPackagesDir() {
  const platform = process.platform;
  let base;
  if (platform === 'win32') {
    base = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'));
  } else if (platform === 'darwin') {
    base = path.join(os.homedir(), 'Library', 'Application Support');
  } else {
    base = path.join(os.homedir(), '.config');
  }
  return path.join(base, 'ZhiYuanAgent', 'expert-packages');
}

function titleCase(name) {
  return name
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function renderTemplate(template, vars) {
  return template.replace(/%\((\w+)\)s/g, (_, key) => vars[key] ?? '');
}

function validateName(name) {
  return /^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(name) && name.length >= 2;
}

const AGENT_PLUGIN_JSON_TEMPLATE = `{
  "name": "%(name)s",
  "version": "1.0.0",
  "description": "[TODO: English one-line description]",
  "author": {
    "name": "[TODO: author name]",
    "email": "[TODO: author email]"
  },

  "expertType": "agent",
  "agentName": "%(agent_name)s",

  "agents": ["./agents/%(agent_name)s.md"],

  "displayName": {
    "en": "[TODO: English display name]",
    "zh": "[TODO: 中文显示名称]"
  },
  "profession": {
    "en": "[TODO: English profession]",
    "zh": "[TODO: 中文职业头衔]"
  },
  "displayDescription": {
    "en": "[TODO: English detailed description]",
    "zh": "[TODO: 中文详细描述，40-50字]"
  },
  "categoryId": "[TODO: XX-CategoryName]",
  "defaultInitPrompt": {
    "zh": "[TODO: 中文首次对话提示]",
    "en": "[TODO: English first prompt]"
  },
  "plugin": "%(name)s",
  "tags": [
    { "en": "[TODO: Tag1]", "zh": "[TODO: 标签1]" },
    { "en": "[TODO: Tag2]", "zh": "[TODO: 标签2]" },
    { "en": "[TODO: Tag3]", "zh": "[TODO: 标签3]" }
  ],
  "quickPrompts": [
    { "en": "[TODO: Prompt1, same as defaultInitPrompt]", "zh": "[TODO: 提示词1，同defaultInitPrompt]" },
    { "en": "[TODO: Prompt2]", "zh": "[TODO: 提示词2]" },
    { "en": "[TODO: Prompt3]", "zh": "[TODO: 提示词3]" }
  ]
}
`;

const TEAM_PLUGIN_JSON_TEMPLATE = `{
  "name": "%(name)s",
  "version": "1.0.0",
  "description": "[TODO: English one-line description]",
  "author": {
    "name": "[TODO: author name]",
    "email": "[TODO: author email]"
  },

  "expertType": "team",
  "agentName": "%(team)s-team-lead",
  "teamInfo": {
    "leadAgent": "%(team)s-team-lead",
    "memberAgents": ["[TODO: member-a]"]
  },

  "agents": [
    "./agents/%(team)s-team-lead.md",
    "./agents/[TODO: member-a].md"
  ],

  "displayName": {
    "en": "[TODO: English team name]",
    "zh": "[TODO: 中文团队名称]"
  },
  "profession": {
    "en": "[TODO: same as displayName.en]",
    "zh": "[TODO: 同displayName.zh]"
  },
  "displayDescription": {
    "en": "[TODO: English team description]",
    "zh": "[TODO: 中文团队描述，40-50字]"
  },
  "categoryId": "[TODO: XX-CategoryName]",
  "defaultInitPrompt": {
    "zh": "[TODO: 中文首次问候]",
    "en": "[TODO: English first prompt]"
  },
  "plugin": "%(name)s",
  "tags": [
    { "en": "[TODO: Tag1]", "zh": "[TODO: 标签1]" },
    { "en": "[TODO: Tag2]", "zh": "[TODO: 标签2]" },
    { "en": "[TODO: Tag3]", "zh": "[TODO: 标签3]" }
  ],
  "quickPrompts": [
    { "en": "[TODO: Prompt1, same as defaultInitPrompt]", "zh": "[TODO: 提示词1，同defaultInitPrompt]" },
    { "en": "[TODO: Prompt2]", "zh": "[TODO: 提示词2]" },
    { "en": "[TODO: Prompt3]", "zh": "[TODO: 提示词3]" }
  ],
  "members": [
    {
      "id": "%(team)s-team-lead",
      "displayName": { "en": "[TODO]", "zh": "[TODO]" },
      "profession": { "en": "[TODO]", "zh": "[TODO]" },
      "role": "lead"
    },
    {
      "id": "[TODO: member-a]",
      "displayName": { "en": "[TODO]", "zh": "[TODO]" },
      "profession": { "en": "[TODO]", "zh": "[TODO]" },
      "role": "member"
    }
  ]
}
`;

const AGENT_MD_TEMPLATE = `---
name: %(agent_name)s
description: "[TODO: English description for pi to determine when to use]"
displayName:
  en: "[TODO: English display name]"
  zh: "[TODO: 中文显示名称]"
profession:
  en: "[TODO: English profession title]"
  zh: "[TODO: 中文职业头衔]"
maxTurns: 50
---

# [TODO: 角色名称] - [TODO: 人名]

你是**[TODO: 人名]**，一位[TODO: 职业定位]。你必须遵循标准工作流完成所有任务。

## 工作流路由（CRITICAL — 收到请求时首先判断）

| 场景 | 判定条件 | 使用模式 |
|------|---------|---------|
| [TODO: 场景1] | [TODO: 判定条件] | [TODO: 模式名] |
| [TODO: 场景2] | [TODO: 判定条件] | [TODO: 模式名] |

---

## [TODO: 模式1名称]

### 执行规范（CRITICAL）

开始此模式后，**立即输出以下进度清单并严格按顺序执行**。每完成一个 Phase，**必须将对应 \`- [ ]\` 更新为 \`- [x]\`**：

\`\`\`markdown
## 任务进度
- [ ] Phase 1：[TODO: 阶段名]
- [ ] Phase 2：[TODO: 阶段名]
- [ ] Phase N：[TODO: 最终阶段名]
\`\`\`

### Phase 1：[TODO: 阶段名]
- [TODO: 输入/输出说明]
- 完成后更新进度清单

### Phase 2：[TODO: 阶段名]
- [TODO: 输入/输出说明]
- 完成后更新进度清单

### Phase N：最终交付
- [TODO: 交付物说明]
- 完成后更新进度清单，全部 \`[x]\` 表示任务完成

---

## [TODO: 其他模式名称]（如有）

\`\`\`markdown
## 任务进度
- [ ] [TODO: 步骤1]
- [ ] [TODO: 步骤2]
- [ ] [TODO: 步骤3]
\`\`\`

---

## 严禁行为

- ❌ [TODO: 禁止行为1]
- ❌ [TODO: 禁止行为2]
- ❌ **禁止忘记更新进度清单** — 每个 Phase 完成后必须把对应 \`- [ ]\` 改为 \`- [x]\`

## 输出规范

- [TODO: 规范1]
- [TODO: 规范2]
- [TODO: 规范3]

## 当你收到请求时

1. 判断使用哪个模式，**立即输出对应的进度清单**
2. 按 Phase 顺序执行，**每完成一步更新清单**
3. 最终交付时提供汇总和建议，清单应全部为 \`[x]\`

请用"[TODO: 问候语]"开始对话。
`;

const TEAM_LEAD_MD_TEMPLATE = `---
name: %(team)s-team-lead
description: "[TODO: English description]"
displayName:
  en: "[TODO: English display name]"
  zh: "[TODO: 中文显示名称]"
profession:
  en: "[TODO: English profession title]"
  zh: "[TODO: 中文职业头衔]"
maxTurns: 150
---

# [TODO: 团队名称] - 主理人
## [TODO: 花名] · [TODO: 职业定位]

你是**[TODO: 花名]**，团队的**主理人**。你的角色是协调整个工作流，将任务分派给合适的团队成员，并确保顺畅协作。**你是协调者，而非执行者。**

## 团队成员

| Agent ID | 姓名 | 职责 |
|----------|------|------|
| %(team)s-team-lead | [TODO: 花名] · [TODO: 头衔] | 编排调度 |
| [TODO: member-a] | [TODO: 花名] · [TODO: 头衔] | [TODO: 职责] |

## 工作流路由（CRITICAL — 收到请求时首先判断）

| 场景 | 判定条件 | 使用工作流 |
|------|---------|-----------|
| [TODO: 场景1] | [TODO: 判定条件] | ⚡ 快速模式 |
| [TODO: 场景2] | [TODO: 判定条件] | 🏗️ 标准 SOP |

---

## ⚡ 快速模式（简单需求首选）

\`\`\`
用户需求 → [TODO: 成员A(做X)] → [TODO: 成员B(验证)]
\`\`\`

1. 分析需求，确认可走快速模式
2. 分派给成员，附带完整上下文
3. 汇总结果 → 交付完成

---

## 🏗️ 标准 SOP 工作流（复杂需求）

### 执行规范（CRITICAL）

开始标准 SOP 后，**立即输出以下进度清单并严格按顺序执行**。每完成一个 Phase，**必须将对应 \`- [ ]\` 更新为 \`- [x]\`**：

\`\`\`markdown
## SOP 进度
- [ ] Phase 1：[TODO: 阶段名] → [TODO: member-a]
- [ ] Phase 2：[TODO: 阶段名] → [TODO: member-b]
- [ ] Phase N：最终交付 → 主理人汇编
\`\`\`

### Phase 1: [TODO: 阶段名]
- 调用成员：[TODO: member-a]
- 输入：[TODO: 用户需求/原始资料]
- 输出：[TODO: 交付物]
- 完成后更新进度清单

### Phase 2: [TODO: 阶段名]
- 调用成员：[TODO: member-b]
- 输入：Phase 1 完整产出
- 输出：[TODO: 交付物]
- 完成后更新进度清单

### Phase N: 最终交付
综合所有产出，生成最终报告返回用户。
完成后更新进度清单，全部 \`[x]\` 表示任务完成

---

## 团队协作机制（铁律）

你必须走正式的**团队协作流程**，严禁简化或跳过：

1. **调度成员**：按 SOP 阶段将每位团队成员拉入协作、下发独立任务；成员作为独立协作方基于任务说明输出专业产出，不得由主理人代写
2. **消息中转**：成员的产出需回传给你，由你汇总、转交下一阶段成员；所有跨成员的信息流必须经主理人中转，不得互相直连
3. **成员结论为准**：任何专业产出必须由对应成员输出后再采信，主理人只做编排与汇编

### 严禁行为
- ❌ 禁止跳过 \`subagent\` 工具，直接自己模拟成员发言或并行写出多角色内容
- ❌ 禁止自己代写任何团队成员的专业产出
- ❌ 禁止未完成前序阶段就跳到后续阶段
- ❌ 禁止让成员互相直连通信，所有跨成员信息流必须经主理人中转
- ❌ 禁止 spawn 主理人自己
- ❌ **禁止忘记更新 SOP 进度清单** — 每个 Phase 完成后必须把对应 \`- [ ]\` 改为 \`- [x]\`

### 调度方式
调用 \`subagent\` 工具时，使用以下参数：
- \`name\`: 成员 Agent ID（团队成员表中的 Agent ID）
- \`task\`: 完整、独立的任务描述，包含所有必要上下文
- \`mode\`: single（单个）/ parallel（并行，最多4个）/ chain（串行，用 \`{previous}\` 传递前一步结果）

### 成员调度命名（CRITICAL）
调度每位成员时，**必须**在 \`name\` 参数中传入该成员的 **Agent ID**。**禁止**省略或使用自创名称。

## 当你收到请求时

1. **首先判断工作流类型**（快速模式 / 标准 SOP）
2. **立即输出对应的 SOP 进度清单**（markdown checkbox 格式）
3. 向用户简要说明你的计划（涉及哪些成员、以什么顺序）
4. 通过分派给第一个成员来启动工作流
5. 将每个成员的输出传递给下一个成员，**每完成一个 Phase 更新清单**
6. 向用户汇总最终交付成果，清单应全部为 \`[x]\`
`;

const TEAM_MEMBER_MD_TEMPLATE = `---
name: [TODO: member-id]
description: "[TODO: English description for pi to determine when to use]"
displayName:
  en: "[TODO: English display name]"
  zh: "[TODO: 中文显示名称]"
profession:
  en: "[TODO: English profession title]"
  zh: "[TODO: 中文职业头衔]"
maxTurns: 50
---

# [TODO: 角色名称] - [TODO: 人名]

你是**[TODO: 人名]**，团队的**[TODO: 角色]**。你必须基于自身专业判断独立完成任务。

## 核心能力
1. **[TODO: 能力1]**：[TODO: 描述]
2. **[TODO: 能力2]**：[TODO: 描述]
3. **[TODO: 能力3]**：[TODO: 描述]

## 工作流程（CRITICAL — 必须遵守）
1. **接收任务**：从主理人处获取任务说明与上游输入
2. **独立产出**：基于自身专业判断完成工作，不要代替主理人编排其他成员
3. **回传主理人**：完成后将结构化产出完整回传给主理人
4. **追加信息**：如需更多输入，向主理人请求，不要自行猜测

## 输出规范
- [TODO: 规范1]
- [TODO: 规范2]
- 输出使用与主理人任务相同的语言
- 必须把结果返回给主理人，不要直接向用户输出

## 严禁行为
- ❌ [TODO: 禁止行为1]
- ❌ 禁止虚构数据或猜测不确定的信息
- ❌ 禁止代替主理人编排其他成员
`;

function initExpert(name, expertType, outputDir) {
  if (!['agent', 'team'].includes(expertType)) {
    throw new Error("type must be 'agent' or 'team'");
  }

  const expertDir = path.join(outputDir, name);
  if (fs.existsSync(expertDir)) {
    throw new Error(`Expert directory already exists: ${expertDir}`);
  }

  const agentsDir = path.join(expertDir, 'agents');
  fs.mkdirSync(agentsDir, { recursive: true });
  fs.mkdirSync(path.join(expertDir, 'skills'), { recursive: true });

  const vars = { name, agent_name: name, team: name };

  if (expertType === 'agent') {
    fs.writeFileSync(
      path.join(expertDir, 'plugin.json'),
      renderTemplate(AGENT_PLUGIN_JSON_TEMPLATE, vars),
      'utf-8',
    );
    fs.writeFileSync(
      path.join(agentsDir, `${name}.md`),
      renderTemplate(AGENT_MD_TEMPLATE, vars),
      'utf-8',
    );
  } else {
    fs.writeFileSync(
      path.join(expertDir, 'plugin.json'),
      renderTemplate(TEAM_PLUGIN_JSON_TEMPLATE, vars),
      'utf-8',
    );
    fs.writeFileSync(
      path.join(agentsDir, `${name}-team-lead.md`),
      renderTemplate(TEAM_LEAD_MD_TEMPLATE, vars),
      'utf-8',
    );
    fs.writeFileSync(path.join(agentsDir, 'member-a.md'), TEAM_MEMBER_MD_TEMPLATE, 'utf-8');
  }

  return expertDir;
}

function printUsage() {
  console.log(`Usage: node init_expert.js <expert-name> --type agent|team [--path <output-dir>]`);
}

function main() {
  if (process.argv.length < 4) {
    printUsage();
    return 1;
  }

  const name = process.argv[2];
  if (!validateName(name)) {
    console.error(`❌ Invalid expert name '${name}'. Use kebab-case (e.g. my-expert).`);
    return 1;
  }

  if (process.argv[3] !== '--type') {
    console.error('❌ Expected --type option.');
    return 1;
  }

  const expertType = process.argv[4];

  let outputDir = getDefaultExpertPackagesDir();
  const pathIndex = process.argv.indexOf('--path');
  if (pathIndex !== -1) {
    if (pathIndex + 1 >= process.argv.length) {
      console.error('❌ --path requires a value.');
      return 1;
    }
    outputDir = path.resolve(process.argv[pathIndex + 1]);
  }

  fs.mkdirSync(outputDir, { recursive: true });

  try {
    const expertDir = initExpert(name, expertType, outputDir);
    console.log(`✅ Initialized ${expertType} expert at: ${expertDir}`);
    console.log('   Next steps:');
    console.log(`   1. Edit ${path.join(expertDir, 'plugin.json')}`);
    console.log(`   2. Edit files in ${path.join(expertDir, 'agents')}`);
    console.log(`   3. Run: node scripts/validate_expert.js ${expertDir}`);
    console.log(`   4. Run: node scripts/register_expert.js ${expertDir}`);
    return 0;
  } catch (e) {
    console.error(`❌ Failed to initialize expert: ${e.message}`);
    return 1;
  }
}

if (require.main === module) {
  process.exit(main());
}

module.exports = { initExpert, getDefaultExpertPackagesDir, validateName };
