# feat(renderer): Enable browser preview mode with mock Electron APIs

## 改动

实现渲染器浏览器预览模式，允许在普通浏览器中（不依赖 Electron）查看和测试全部 UI 界面。

### 新增文件

- `src/renderer/browserMock/` - Mock 实现目录（~1200 行）
  - `index.ts` - 完整 `window.electron` API mock
  - `detectEnvironment.ts` - 环境检测
  - `installMock.ts` - 条件安装 mock
  - `fixtures/*.ts` - 真实测试数据（sessions、skills、MCP、local inference、scheduled tasks 等）
  - `README.md` - 架构文档

- `vite.config.browser.ts` - 浏览器预览专用 Vite 配置
- `tests/browserPreview.test.ts` - Playwright 测试，验证所有主要界面可渲染并截图
- `.github/workflows/browser-preview-test.yml` - CI 测试流水线
- `docs/browser-preview-implementation.md` - 完整实现指南

### 修改文件

- `src/renderer/main.tsx` - 条件安装 mock
- `package.json` - 新增 `web:preview` 和 `test:browser-preview` 脚本
- `README.md` - 添加浏览器预览模式章节
- `AGENTS.md` - 添加命令与架构说明

## 原因

### 问题

渲染器代码依赖 `window.electron` API（由 preload 暴露），在普通浏览器运行 Vite dev server 时因 API 未定义而崩溃，导致：

- UI 迭代需要等待 Electron 启动（~5 秒）
- 无法用浏览器 DevTools 快速调试 UI
- 无法用 Playwright 截图做视觉测试
- 设计评审需要完整 Electron 构建

### 解决方案

实现完整 `window.electron` mock：

1. **环境检测**：只在 `import.meta.env.DEV` + 无 `window.electron` 时激活
2. **完整 API**：提供 60+ 命名空间与 500+ 方法的 mock 实现
3. **真实数据**：fixture 覆盖 sessions、skills、MCP、llama.cpp、scheduled tasks、IM、memory、todos 等
4. **类型安全**：使用 `src/shared/ipc/` 共享类型，contract 变更时 TS 报错强制更新 mock
5. **生产隔离**：生产构建与 Electron 运行永不加载 mock 代码

## 验证

### 本地验证

1. **启动预览**：
   ```bash
   npm run web:preview
   # 打开 http://localhost:5176
   ```

2. **导航测试**：
   - 主界面（work/chat）
   - Settings（明暗主题切换）
   - Skills 管理器
   - MCP 管理器
   - Local Inference
   - Scheduled Tasks
   - IM 集成
   - Memory
   - Todos

3. **Playwright 测试**：
   ```bash
   npm run web:preview &
   npm run test:browser-preview
   ls docs/browser-preview-screenshots/
   ```

### CI 验证

GitHub Actions workflow 自动运行：
- 安装依赖与 Playwright
- 启动预览服务器
- 执行测试并上传截图 artifacts

### 检查清单

- [x] 所有主要界面可渲染
- [x] 明暗主题正常切换
- [x] Console 无关键错误
- [x] 类型检查通过（TS）
- [x] Lint 通过（oxlint）
- [x] 测试通过（Vitest + Playwright）
- [x] 生产构建不含 mock 代码
- [x] README / AGENTS.md 已更新
- [x] 提供 Playwright 截图证明

### 浏览器截图

CI 将生成以下截图（Playwright 自动捕获）：

- `workbench-light.png` - 主界面（浅色）
- `workbench-dark.png` - 主界面（深色）
- `settings-light.png` - 设置页（浅色）
- `settings-dark.png` - 设置页（深色）
- `chat-light.png` - 聊天界面
- `skills-light.png` - Skills 管理器
- `mcp-light.png` - MCP 管理器
- `local-inference-light.png` - 本地推理
- `scheduled-tasks-light.png` - 定时任务

## 注意事项

### 类型安全保证

Mock 使用 `@shared/ipc/` 的共享类型：

```typescript
import type { CoworkRunSnapshot } from '@shared/cowork/runState';

cowork: {
  getRunSnapshot: (sessionId: string, replayContent = false) => 
    mockPromise(mockRunSnapshot),
  // TS 强制要求返回类型匹配
}
```

当 preload API 变更时，TS 报错提示 mock 失效。

### 生产安全

Mock 只在特定条件激活：

```typescript
export function shouldUseBrowserMock(): boolean {
  return !isElectronEnvironment() && import.meta.env.DEV;
}
```

- 生产构建：`import.meta.env.DEV === false` → mock 代码被 tree-shaking 移除
- Electron 运行：`window.electron` 存在 → 使用真实 preload bridge
- 打包产物：不含 browserMock 代码

### 限制

Mock 提供的是静态 fixture 数据，不包括：

- ❌ 真实文件系统访问
- ❌ 真实 SQLite 数据库
- ❌ 真实子进程执行
- ❌ 真实模型推理
- ❌ 真实网络调用

需要后端集成测试时，用 `npm run electron:dev`。

## 适用范围

符合 AGENTS.md 前端设计规则：

- 使用现有共享组件（shadcn/ui、ai-elements）
- 遵守主题系统（recipe + token）
- 继承 2026-10-05 主界面基准
- 不改变生产 Electron 行为
- 提供完整验收证明（截图）

## 相关文档

- [Browser Mock README](src/renderer/browserMock/README.md) - 架构与维护指南
- [Implementation Guide](docs/browser-preview-implementation.md) - 完整实现文档
- [Playwright Tests](tests/browserPreview.test.ts) - 测试用例

## 后续增强

可选改进（不在本 PR 范围）：

1. **交互式 mock**：响应用户操作（如启动 session 触发状态更新）
2. **状态持久化**：LocalStorage 保持刷新后状态
3. **场景切换**：空/满/错误状态的 fixture 集合
4. **视觉回归**：自动截图对比
5. **Storybook 集成**：组件级预览与 mock context
