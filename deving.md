## 本周工作周报 (7.6 – 7.10)

### 任务一：Cowork 对话 UI ai-elements 集成

**ChainOfThought 重构（7.6）**
- 对齐 Vercel ai-elements 官方 pattern，完整 Reasoning → ToolCard → CodeBlock 链条
- ToolCard 嵌入 ChainOfThought steps，移除冗余 wrapper
- "推理过程"→"工作过程"，加 SparklesIcon
- 替换 Streamdown code-block → ai-elements CodeBlock + CodeBlockActions + CodeBlockCopyButton
- CSS-only 对齐 Streamdown v2.5 代码块与 ai-elements flat single-card 样式（[class~="bg-sidebar"] 精确选择器）
- 移除 @apply 语法，raw CSS 兼容 Tailwind v4

**PromptInput 重构（7.7）**
- 原生 textarea → ai-elements PromptInputTextarea + InputGroupTextarea
- 手写 popover/SVG 图标 → shadcn/ui + lucide-react（删除 30+ 自定义 icon，迁移至官方图标库）
- PromptInput 复合布局：PromptInputBody + PromptInputFooter + PromptInputTools + PromptInputSubmit
- 修复：InputGroup 蓝色 focus ring、双重 border、圆角对齐、值同步、stable reference、shadow 等
- artifact 检测移至 Web Worker，减少主线程阻塞

### 任务二：shadcn/ui 全站组件迁移（续上周）

**Settings 页 Switch/Toggle 修复（7.6-7.7）**
- Switch 组件：绕过 `hsl(var(--primary))` 包装（hex 色值导致 `hsl(#3B82F6)` 无效 CSS），用 CSS 直设 track/thumb 颜色
- 供应商开关：Toggle 替代 Switch，去蓝选中态 → raised surface + 3D shadow
- Modal 双重重影修复（移除 sm:max-w-sm 约束）
- ring-foreground/10 → ring-border（hsl 修复）
- 供应商行左侧加 padding 显示内陷阴影
- box-shadow transition 测试

**全局修复（7.7）**
- 全 renderer text-secondary → text-muted-foreground 替换
- InputGroup focus ring opacity 50%→25% 弱化
- title bar button 可见性

**定时任务页全量重构（7.10）**
- Phase 1：弹窗/菜单/表格/下拉 全部手写 → shadcn Dialog + DropdownMenu + Table + Select（MR 423，9 文件，-848 行）
- Phase 2：Tabs 三面板（新建任务/任务/历史）+ TaskTemplateGallery 模板页 + Separator + ScrollArea + ButtonGroup（MR 425）
- Phase 3：任务页/历史页 Card 化 + Badge 圆角 pill + 表头次级文本（MR 427）
- Phase 4：Switch stopPropagation + DropdownMenu 蓝色修复 + 行 hover + 任务名截断（MR 429-430）

**Tailwind v3.4 vs v4 兼容性批量修复（7.10）**
- 定位并修复 8 个 shadcn 组件中 v4 语法在 v3.4 下静默失效的问题
- tabs.tsx (data-active:→data-[active]:), card.tsx (--spacing()→显式值), badge.tsx (rounded-4xl→rounded-full), button-group.tsx (*:data-slot:→[&>[data-slot]]:), separator.tsx (data-horizontal:→data-[orientation=horizontal]:), dialog.tsx + dropdown-menu.tsx (ring-foreground/10→ring-border + data-open:→data-[open]:), tooltip.tsx (bg-foreground→bg-popover)
- index.css 补充 ButtonGroup CSS 回退规则
- AGENTS.md 文档化该陷阱

### 任务三：AI SDK 数据层 + Chat 模式（7.9）

**ChatChatTransport**
- 实现 AI SDK ChatTransport 接口，桥接 apiService.chat() → ReadableStream<UIMessageChunk>
- CoworkView chat 路径从 apiService.chat() 迁移至 ChatChatTransport

**AIChatView**
- 创建 thin useChat + ai-elements 组件（~110 行）
- 因 UI 变更范围问题回退（MR 412-414）

**ModelSelector**
- 从 home header 移至 prompt footer，位置左于 FolderSelector
- Select → ai-elements Popover + Command 模式
- 修复：限宽、圆角、hover 侧边栏风格、i18n、蓝色 ring、全部 models 展示

**Chat 模式修复（7.8-7.10）**
- 输入框：setValue('') 提前至 await onSubmit() 前（消除等待延迟）
- 侧边栏：chat sessions 跳过 loadSessions(agentId)（防止列表被替换）
- chat sessions 从 localStorage 迁移至 SQLite（增加 mode 字段）
- work-chat Switch thumb：22% 透明玻璃 → 不透明

### 任务四：Work/Chat 双模式分离（7.8）

- Sidebar 新增 Work/Chat ToggleGroup → pill-thumb Switch
- 双模式路由：Chat → apiService.chat() 直连 LLM，Work → Pi/OpenClaw agent
- Project-based sessions：Agent → Project 重命名，限 Work 模式显示
- 搜索弹窗：CommandDialog work/chat 分离搜索 + bg-surface + color ring 去除

### 任务五：Pi 引擎稳定性（7.9）

- stopSession 记忆丢失：仅 abort 当前 turn，保留 activeSessions（continueSession 可恢复）
- continueSession fallback：从 SQLite 加载历史 → agent.state.messages 注入
- thinking fallback：仅输出 thinking 无 text 时提升为 answer
- sessionManager mock 补充 + 测试更新

### 任务六：其他 UI 修复

- 新建项目 Modal：shadcn 组件重构 + 设置页动画统一（7.8）
- prompt-input 无法发送消息修复（7.8）
- Sidebar import 排序 lint 修复（7.8）
- CI Windows 分 lite/full 包 + llama.cpp backend 缓存（7.3，补记）
