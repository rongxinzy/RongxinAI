---
name: skill-creator
description: 创建新技能、修改和迭代优化已有技能、编写标准 SKILL.md 文档与规划技能目录结构。当用户提出创建新技能、编写技能模板、增强智能体专业能力或将工作流固化为 Skill 时使用本技能。
license: MIT
metadata:
  author: ZhiYuan Agent
---

# 技能架构师 (Skill Creator)

本技能赋能知远智能体（ZhiYuan Agent），指导智能体协助用户设计、开发、验证和迭代高质量的专属技能（Skill）。

## 核心理念

知远智能体采用轻量级、原生 Markdown 驱动的技能系统（兼容 Pi runtime 规范）。一个标准的技能即为一个独立的文件夹，核心为 `SKILL.md`，辅以可选的脚本（scripts/）、参考资料（references/）或元数据（zhiyuan/metadata.yaml）。

```
my-skill/
├── SKILL.md                  # 核心技能规约（必须，含 YAML frontmatter）
├── zhiyuan/                  # 可选知远本地元数据
│   └── metadata.yaml
├── scripts/                  # 可选辅助自动化脚本（Python / Node.js / Shell）
└── references/               # 可选业务知识库、SOP 参考文档
```

## 技能设计标准流程

当你协助用户创建技能时，请严格遵循以下四步工作法：

### 1. 意图澄清与场景界定 (Intake & Scoping)
首先与用户对齐关键要素：
- **技能目标**：这个技能解决什么具体业务痛点？（如：自动生成财报比率、审查合同法律漏洞、撰写小红书种草文案）
- **触发时机**：模型在何种提问或场景下应该主动加载本技能？（写好 `description` 是精准触发的核心）
- **所需输入与预期产出**：用户需要提供哪些资料？最终交付什么格式的成果？

### 2. 规范编写 SKILL.md (Drafting SKILL.md)
`SKILL.md` 必须包含规范的 YAML frontmatter 与结构化正文：

```markdown
---
name: <kebab-case-identifier>
description: <触发式描述，明确说明在何种用户意图或任务下应调用本技能>
---

# <技能名称>

<技能简述与核心价值>

## 适用场景 (When to Use)
- 场景 1...
- 场景 2...

## 核心工作流 (Workflow & SOP)
1. **第一阶段：需求理解与输入核对**
   ...
2. **第二阶段：分析与加工**
   ...
3. **第三阶段：成果交付与复核**
   ...

## 交付规范与质量门禁 (Output Standards)
- 格式规范...
- 必须包含的关键要素...

## 约束与边界 (Constraints)
- 明确禁止的行为或边界条件...
```

### 3. 工具与依赖规划 (Optional Scripts & References)
- 如技能需要复杂运算、格式解析或外部 API，引导用户在 `scripts/` 中编写免认证或通过环境变量配置的脚本。
- 如需行业术语库或长篇规约，拆分到 `references/` 目录中，在 `SKILL.md` 中通过相对路径引用。

### 4. 固化与安装 (Persistence)
- 协助用户检查 YAML frontmatter 是否合规。
- 引导用户通过知远智能体界面中的「新建自定义技能」直接粘贴保存，或使用文件系统工具直接将目录写入智能体技能根目录中。
