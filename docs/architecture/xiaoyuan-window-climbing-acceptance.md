# 小远窗口攀爬验收（2026-10-28）

2026-10-28 用户要求「爬窗真正出现」。本记录覆盖 Windows 原生窗口感知、支点行走/攀爬/跨越/跌落、朝向渲染与打包依赖；不含 macOS/Linux，也不把开发构建的结论当成正式安装包验收。

## 结论

- Windows 实机已出现完整链路：地面靠近窗口 → 起跳 → 吸附侧边 → 沿边攀爬 → 顶角换边 → 沿顶边行走 → 离开支点落回桌面。
- 角色窗口只在依附支点期间 `topmost=true`，回到桌面立即 `topmost=false`；没有把角色变成常驻置顶窗。
- 窗口消失、遮挡或几何过期时安全脱离；跨越途中落点移动则放弃跨越。
- 单元测试、主进程类型检查、lint、格式、Knip、构建与运行时依赖检查通过。正式安装包、100–200% 缩放、混合 DPI 与多屏未验收。

## 实现

- 几何与状态机 `src/shared/desktopPet/surfaces/`：
  - `visibleWindowSurfaces` 按 Z 序裁剪可见支点，DWM 扩展边框按各自显示器换算为 DIP；遮挡按整身高度与脚下 12px 预留，短于 8px 的残余支点不生成。
  - `WindowSurfaceWalker` 负责吸附、沿边行走、顶角换到相邻边、跨窗跳跃、失去支点跌落，以及落回桌面工作区。
  - 窗口最低可见段会让 192×232 的旋转窗口越出工作区时，从该边上最近的可站立点起跳，而不是直接放弃这个窗口。
- 原生感知 `src/main/desktopPet/windows/`：
  - Koffi 3.3.4 调用 user32/dwmapi；`SetWinEventHook` 只做脏标记，`PeekMessage` 在 helper 内泵事件，采样与几何合并成一次回执。
  - 只输出窗口 id、矩形与可附着标志；不读取标题、进程名、路径、截图或窗口内容。
  - 透明/工具窗口仍参与遮挡，但不会被当作攀爬目标；桌面外壳窗口类被排除；自身 HWND 由配置显式排除。
- 隔离进程：`src/main/desktopPetWindowsEntry.ts` 由 `utilityProcess.fork` 启动，环境只保留 `System32`、`TEMP`、`TMP`，不继承 provider 凭据或工具环境。单帧未确认即暂停采样，心跳 1s，过期 1.5s，启动 5s 超时，最多重试 2 次，退出 250ms 强杀。
- 协议 `windows/protocol.ts`：zod 校验配置、确认、快照与失败；坐标、显示器、窗口与曲面数量均有界。
- 主进程接线：`DesktopPetMotion` 持有 walker，`DesktopWindowObserver` 由可见性/设置驱动；仅在 `surfaces.active` 时 `setAlwaysOnTop(true)`，否则恢复普通层级。
- 渲染：`orientation.ts` 以画布中心旋转 90°，命中掩码同向旋转；气泡保持水平。减少动效强制 upright 并重置支点。
- 打包：`koffi@3.3.4` 依赖、Electron 主进程 external、asarUnpack、开发/生产构建入口与 `public/licenses/koffi.txt`。

## 行为边界

- 只读取矩形、可见性、最小化、前台窗口与全屏状态；不读取标题、截图、内容或进程信息。
- 目标窗口移动时跟随而不是瞬移；跨越途中落点位移超过 8px 时放弃跨越并跌落。
- 窗口消失、被遮挡、最小化或感知过期时释放支点；落到下方可见顶边或桌面。
- 站在窗口最低可见段会让整个窗口越出工作区时，从最近可站立点起跳；单测覆盖该边界。
- 免打扰、锁屏、休眠停止感知进程；隐藏与减少动效释放支点并停止自主移动。
- `allow=false`（任务、气泡、菜单、招呼）时只停止行走，不把角色从已有支点上强行拽下。

## 验证

### 自动化

- `bunx vitest run src/shared/desktopPet src/main/desktopPet src/renderer/desktopPet --maxWorkers=2`：26 个文件、132 项通过。
  - 几何 4、walker 8（含最低段越界、跨窗放弃、窗口消失、几何过期）、observer 5、sensor 4、orientation 1。
- `bun run typecheck:electron` 0；本次改动文件的 `oxlint` 0 warning / 0 error（全仓既有 293 条 warning 未清理）；`bun run knip` 0；`bun run check:electron-runtime-dependencies` 13 个生产依赖、8 个 external root。
- `bun run build:vite`：生成 `dist-electron/desktopPetWindowsEntry.js`，`require("koffi")` 保持 external。
- `bun run build:tsc` 在 `src/renderer/components/coding/codingEventProjection.ts` 报告 5 个既有 `TS2339`；该文件不在本次改动内，不记为通过。

### Windows 实机

环境：Windows 11 家庭版中文版 10.0.26200，x64，单显示器 2560×1440，系统 DPI 96（100%），任务栏 48px。

观察方法：通过 CDP 读取桌宠页 `#desktop-pet` 的 `data-orientation`，500ms 轮询桌宠窗口矩形与 `WS_EX_TOPMOST`，按需截取桌面。

- 17:24 首轮（Notepad 作为支点）：落地后出现 `right-wall`，随后 `walk`；顶角换边后变为 `upright` 并沿顶边行走，最后回到桌面。
- 17:40–17:44 最终代码复核（知远开发窗口作为支点）：
  - `10s`：`flutter` 起跳，随后 `land` 且朝向变为 `left-wall`。
  - `13–41s`：`left-wall` 下 `idle / walk / blink / stretch`，沿窗口左边缘上下行走。
  - `44s`：转为 `upright`，顶角换边后沿顶边行走。
  - 窗口矩形同步移动；离开支点后 `topmost=false`。
- 截图：`docs/architecture/companion-window-2026-10-28/wall-climb.png`。角色贴在应用窗口左边缘，身体旋转 90°，脚接触边缘，气泡不在画面内。

### 未验证

- 100/125/150/200% 缩放、混合 DPI、多显示器、负坐标。
- 正式安装包内 utility process 从 asar 加载 `koffi`；本轮只验证开发构建与 `build:vite` 产物。
- 免打扰、锁屏、休眠、外部前台全屏的实机表现；逻辑与单测覆盖，未实机复看。
- macOS/Linux 不启用本能力。

## 复现

1. `bun run electron:dev`，在设置中开启桌面伙伴与「屏幕漫游」。
2. 打开一个最小 80×60 的普通窗口，把任意边缘放到角色 160px 内。
3. 待机 8–20s 后角色起跳吸附；到顶角会转到顶边；关闭窗口立即跌落到桌面。
