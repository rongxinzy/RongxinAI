# plugin.json 字段规范（RongxinAI / pi）

## 基础字段（必填）

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | string | 唯一标识，小写字母+连字符，也是包名 |
| `version` | string | 语义化版本号（MAJOR.MINOR.PATCH） |
| `description` | string | 英文一句话描述 |

## 可选基础字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `author` | `{name, email}` | 作者信息 |
| `license` | string | 许可证 |

## 类型字段

| 字段 | 说明 |
|------|------|
| `expertType` | `"agent"` / `"team"` |
| `agentName` | 主 Agent 名称（对应 agents/ 下 MD 文件名，不含 .md） |
| `teamInfo` | team 时必填：`{leadAgent, memberAgents[]}` |

## 资源声明

| 字段 | 类型 | 说明 |
|------|------|------|
| `agents` | string[] | Agent 定义文件路径列表 |
| `skills` | string[] | Skill 目录路径列表（会被复制到 RongxinAI SKILLs/） |

## 展示字段（必填）

| 字段 | 类型 | 说明 |
|------|------|------|
| `displayName` | `{en, zh}` | 展示名称 |
| `profession` | `{en, zh}` | 职业/定位。**Team 型须与 displayName 一致** |
| `displayDescription` | `{en, zh}` | 展示描述。**中文 40-50字** |
| `categoryId` | string | 行业分类 ID |
| `defaultInitPrompt` | `{en, zh}` | 默认引导语。**须与 quickPrompts 第一条一致** |
| `plugin` | string | 值与 `name` 一致 |
| `tags` | `{en, zh}[]` | 擅长领域标签（**固定 3 个**） |
| `quickPrompts` | `{en, zh}[]` | 推荐提示词（**固定 3 个**） |

## Team 专用字段

| 字段 | 说明 |
|------|------|
| `members[]` | 每个成员含 `{id, name:{en,zh}, profession:{en,zh}, role}` |

- `role` 取值：`"lead"` 或 `"member"`
- 主理人也必须在 members 中，role 为 `"lead"`
- `teamInfo.memberAgents` **不含**主理人

## 模板：Agent 型

```json
{
  "name": "{kebab-case-name}",
  "version": "1.0.0",
  "description": "{English one-line description}",
  "author": {
    "name": "{author-name}",
    "email": "{author-email}"
  },

  "expertType": "agent",
  "agentName": "{agent-name}",

  "agents": ["./agents/{agent-name}.md"],

  "displayName": {
    "en": "{English display name}",
    "zh": "{中文显示名称}"
  },
  "profession": {
    "en": "{English profession}",
    "zh": "{中文职业头衔}"
  },
  "displayDescription": {
    "en": "{English detailed description}",
    "zh": "{中文详细描述，40-50字}"
  },
  "categoryId": "{XX-CategoryName}",
  "defaultInitPrompt": {
    "zh": "{中文首次对话提示}",
    "en": "{English first prompt}"
  },
  "plugin": "{kebab-case-name}",
  "tags": [
    { "en": "{Tag1 EN}", "zh": "{标签1}" },
    { "en": "{Tag2 EN}", "zh": "{标签2}" },
    { "en": "{Tag3 EN}", "zh": "{标签3}" }
  ],
  "quickPrompts": [
    { "en": "{Prompt1 EN}", "zh": "{提示词1}" },
    { "en": "{Prompt2 EN}", "zh": "{提示词2}" },
    { "en": "{Prompt3 EN}", "zh": "{提示词3}" }
  ]
}
```

> 如果没有 skills，则省略 `"skills"` 字段。

## 模板：Team 型

```json
{
  "name": "{kebab-case-name}",
  "version": "1.0.0",
  "description": "{English one-line description}",
  "author": {
    "name": "{author-name}",
    "email": "{author-email}"
  },

  "expertType": "team",
  "agentName": "{team}-team-lead",
  "teamInfo": {
    "leadAgent": "{team}-team-lead",
    "memberAgents": ["{member-a}", "{member-b}"]
  },

  "agents": [
    "./agents/{team}-team-lead.md",
    "./agents/{member-a}.md",
    "./agents/{member-b}.md"
  ],

  "displayName": {
    "en": "{English team name}",
    "zh": "{中文团队名称}"
  },
  "profession": {
    "en": "{English team name}",
    "zh": "{中文团队名称}"
  },
  "displayDescription": {
    "en": "{English team description}",
    "zh": "{中文团队描述，40-50字}"
  },
  "categoryId": "{XX-CategoryName}",
  "defaultInitPrompt": {
    "zh": "{中文首次问候}",
    "en": "{English first prompt}"
  },
  "plugin": "{kebab-case-name}",
  "tags": [
    { "en": "{Tag1 EN}", "zh": "{标签1}" },
    { "en": "{Tag2 EN}", "zh": "{标签2}" },
    { "en": "{Tag3 EN}", "zh": "{标签3}" }
  ],
  "quickPrompts": [
    { "en": "{Prompt1 EN}", "zh": "{提示词1}" },
    { "en": "{Prompt2 EN}", "zh": "{提示词2}" },
    { "en": "{Prompt3 EN}", "zh": "{提示词3}" }
  ],
  "members": [
    {
      "id": "{team}-team-lead",
      "displayName": { "en": "{EN}", "zh": "{ZH}" },
      "profession": { "en": "{EN}", "zh": "{ZH}" },
      "role": "lead"
    },
    {
      "id": "{member-name}",
      "displayName": { "en": "{EN}", "zh": "{ZH}" },
      "profession": { "en": "{EN}", "zh": "{ZH}" },
      "role": "member"
    }
  ]
}
```
