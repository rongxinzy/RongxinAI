# Pi Runtime 技能作用域修复

## 背景

Work 模式对话由 Pi SDK（`@earendil-works/pi-coding-agent`，in-process agent loop）驱动。用户反馈：在应用内询问 agent "你有什么技能" 时，agent 只返回 5 个开发用技能（`ai-sdk`、`migrate-ai-sdk-v6-to-v7`、`ai-elements`、`zhiyuan-ui-adapter`、`shadcn`），而项目预设的 39 个内置技能（`SKILLs/` 目录，如 `docx`、`xlsx`、`pptx`、`pdf` 等）完全检索不到。

这 5 个技能来自开发者机器的全局目录 `~/.agents/skills`（Windows: `C:\Users\<user>\.agents\skills`），是开发工具的 User scope 技能，不应出现在面向最终用户的 知远智能体 应用会话中。

## 根因分析

Pi SDK 的 `DefaultResourceLoader` 在 `reload()` 时会自动从 `agentDir` 的 `skills/` 子目录加载技能，并通过 `formatSkillsForPrompt()` 拼入系统提示。`PiRuntimeAdapter.createPiResourceLoader()` 创建 loader 时传入 `agentDir: pi.getAgentDir()`（默认解析为 `~/.agents`），导致开发者全局技能泄漏进所有用户会话。

与此同时，知远智能体 自己的技能注入走的是一条独立路径：`buildSkillsPrompt()` 手动扫描 `userData/SKILLs` 并拼接进 `systemPromptOverride`。这带来两个问题：

1. **与 loader 自动渲染的技能段重复**——pi 的 `buildSystemPrompt` 在 `customPrompt` 分支里也会对 resource-loader 发现的 skills 调 `formatSkillsForPrompt`，手动注入与自动注入并存会产生两份技能清单。
2. **生产模式下 agent 实际"感知"的是 loader 加载的那份**（`~/.agents/skills`），手动拼进 prompt 的那份因与会话系统提示其余部分的相对位置及渲染时序问题，agent 并未将其识别为自己的技能。

## 修复方案

将技能加载收敛到 Pi 的标准路径（`additionalSkillPaths`），并切断全局目录泄漏：

### `src/main/libs/agentEngine/piRuntimeAdapter.ts`

1. **`createPiResourceLoader()` 新增 loader 选项**：
   - `noSkills: true` — 禁止 resource-loader 从 `agentDir`（`~/.agents/skills`）自动加载技能。注意此选项不影响 `additionalSkillPaths`，仅屏蔽默认的 user/project 技能根。
   - `additionalSkillPaths: this.resolveRongxinAiSkillDirs()` — 显式声明 知远智能体 的技能目录，由 pi 统一加载、去重、渲染。
   - `skillsOverride` — 将会话级 `skillIds` 过滤从手动 prompt 构建迁移到 loader 层（`skillIds === undefined` 表示不过滤，暴露全部技能）。

2. **新增 `resolveRongxinAiSkillDirs()`**：按优先级返回技能目录列表（仅返回存在的目录）：
   - 生产模式：`userData/SKILLs`（`getSkillsRoot()` 已解析到这里，由 `SkillManager.syncBundledSkillsToUserData()` 填充；应用内市场安装/手动导入/升级的技能也都写入此目录）。
   - 开发模式：项目根 `SKILLs/`（`getSkillsRoot()` 在 `!app.isPackaged` 时解析到这里）+ `userData/SKILLs`（可能由历史打包运行残留，同名技能由 pi 内部按名称去重，先出现者优先）。

3. **删除 `buildSkillsPrompt()`**：手动注入与 loader 自动渲染重复，属于死代码。

### 技能可见性矩阵（修复后）

| 技能来源 | 修复前 | 修复后 |
|---|---|---|
| `~/.agents/skills`（开发者全局技能） | 泄漏给所有会话 | 被 `noSkills: true` 屏蔽 |
| `userData/SKILLs`（内置同步 + 市场安装 + 手动导入） | 手动注入（agent 未正确感知） | `additionalSkillPaths` 正规加载 |
| 项目根 `SKILLs/`（仅开发模式） | 不可见 | `additionalSkillPaths` 正规加载 |

## 生效时机

resource-loader 在**会话启动时** `reload()` 一次，因此：

- 修复对**新会话**立即生效；进行中的旧会话仍持有旧的系统提示。
- 用户在会话进行中安装新技能时，同样需要开新会话才能看到（与修复前行为一致，非回归）。

## 验证

- `npx tsc -p electron-tsconfig.json --noEmit` — 通过
- `npx eslint src/main/libs/agentEngine/piRuntimeAdapter.ts` — 通过
- `npm test -- piRuntimeAdapter` — 31 个用例全部通过
- 实测（生产模式路径）：以 `skillPaths: [userData/SKILLs]`、`includeDefaults: false` 调用 pi 的 `loadSkills()`，加载到 37 个项目预设技能，`~/.agents/skills` 的 5 个开发技能泄漏数为 0。

## 影响面

- 仅影响 Pi runtime 的系统提示构建；OpenClaw 链路（`openclawRuntimeAdapter` / `openclawConfigSync`）的技能机制独立，不受影响。
- Subagent（Team Lead 成员会话）复用同一个 `createPiResourceLoader()`，自动继承相同技能作用域；不传 `skillIds` 时暴露全部技能，行为与修复前一致。
- Chat 直答模式（`chatDirect`）不走 resource-loader，不受影响。
