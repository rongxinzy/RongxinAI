# Windows 安装器 WebView2 外壳 · 实施规格

日期：2026-10-12。状态：实施基线（Milestone A：真实安装引擎）。视觉原型已验收（见 `scripts/installer-shell/preview/index.html` 与 `docs/2026-10-11-windows-installer-custom-ui.zh-CN.md`）。

## 目标形态（双安装器，已锁定）

- **首装/重装**：单文件 `ZhiYuanAgent-Setup-<version>.exe` = WebView2 外壳 + 内嵌载荷（自解包）。本文件定义其引擎。
- **自动更新**：现有 electron-builder NSIS 安装器（`scripts/nsis-installer.nsh`）**原样保留**，electron-updater 静默路径不变。
- 两条链路必须产出**同一磁盘形态**：`$INSTDIR\resources` 下 junction 布局 + `%LOCALAPPDATA%\ZhiYuanAgent\runtimes` 内容寻址缓存。保证手段：**共享 PowerShell 脚本**，NSIS 与外壳只做编排，不各写一份组件逻辑。

## 引擎编排（对照 nsis-installer.nsh 逐步复刻）

顺序与守卫必须与 `customInit`/`customInstall` 语义一致（取消时机的破坏性步骤顺序不能变）：

1. `StopAppProcesses` — 端口现有按路径前缀杀进程逻辑（含等待循环）
2. 用户 SKILLs 迁移（`$INSTDIR\resources\SKILLs` → `%APPDATA%\ZhiYuanAgent\SKILLs`，bundled 过滤）
3. 旧版本 detach（rename `$INSTDIR` → `$INSTDIR.old.<tick>`，写 `old-install-path.txt`，失败区分"进程占用/目录被占"）
4. 应用文件解包（7za 解 `app.7z` 到安装目录，**解析 stdout 逐文件回进度**）
5. 7za SHA-256 校验 + `recover-component-switch.ps1`
6. 组件缓存校验（`validate-offline-components.ps1 -Mode cache`）
7. 组件展开（`-Mode expand`）
8. 组件激活（junction 切换，含 `component-switch-state.txt` 回滚协议）
9. 运行时连接（resources 下 junction）
10. 哨兵校验（python/uv/cc-connect 存在性）
11. VC++ Runtime（注册表检查 + `nsis-elevated-actions.ps1 runas` 提权安装）
12. `pending-local-inference-install` 标记
13. 旧版本清理 + 未用组件版本清理
14. 卸载注册（见下）+ 开始菜单快捷方式

### 卸载注册（electron-updater 兼容，关键）

electron-builder 的 NSIS 更新流程按注册表定位已有安装，外壳必须写出**与 electron-builder 相同形状**的键：

- `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\<UninstallKey>`：`DisplayName`=`知远智能体 (ZhiYuan Agent)`、`DisplayVersion`、`Publisher`、`DisplayIcon`=`$INSTDIR\<exe>`、`InstallLocation`=`$INSTDIR`、`UninstallString`/`QuietUninstallString`、URLInfoAbout 等（对照 electron-builder installSection.nsh 生成器逐项对齐）
- `HKCU\Software\<AppGuid>`：`InstallLocation`

（per-machine 升级场景 v1 不支持——现有 NSIS 同样以 per-user 为默认路径；升级走 NSIS 静默安装。）

## 载荷契约（打包器 Milestone B 与引擎共用）

```
<payload>/
  app.7z                      # 应用文件（解到安装目录）
  tools/7za.exe + 7za.sha256
  components/<key>.7z|.version|.sha256|.sentinel-sha256   # key 同 nsis-offline-components.json
  component-manifest.json     # 同 build-tar/windows-components/manifest.json
  component-targets.json      # = scripts/nsis-offline-components.json
  scripts/validate-offline-components.ps1   # 共享，仓库唯一来源
  scripts/recover-component-switch.ps1      # 共享
  scripts/activate-components.ps1           # 新抽共享（NSIS 内联逻辑迁入）
  scripts/link-runtime-junctions.ps1        # 新抽共享
  scripts/cleanup-stale-components.ps1      # 新抽共享（旧版本清理+未用版本清理）
  scripts/elevated-actions.ps1              # = scripts/nsis-elevated-actions.ps1
  vc_redist.x64.exe
```

共享化规则：从 `scripts/nsis-installer.nsh` 把 8/9/13 步的内联 PowerShell 原样迁入独立 `.ps1`（行为一字不改），NSIS 的 `nsExec` 调用改为 `-File` 调用这些脚本；`tests/nsis-installer.test.ts` 补"内联块已迁出、改由 -File 引用"的断言并保持全绿。**引擎不重新实现组件逻辑，只传参调用。**

## 进度桥（外壳 ↔ 页面）

引擎 → C# → `webView.CoreWebView2.PostWebMessageAsJson`：

```json
{"type":"phase","label":"正在展开 Skill 依赖层"}
{"type":"progress","percent":42,"bytesDone":123456789,"bytesTotal":987654321}
{"type":"done","installDir":"C:\\...","launchPath":"C:\\...\\ZhiYuan Agent.exe"}
{"type":"error","message":"...","detail":"..."}
```

页面在 `shell` 模式下用真实事件驱动进度页（替换模拟器；浏览器预览仍用模拟器）。取消：进度页发 `{"type":"cancel"}` → 引擎终止子进程（7za/PowerShell 进程树）并按回滚协议恢复（组件切换已有 state 文件回滚；解包中止后删除未完成的安装目录、恢复 detach 的旧版本——与 NSIS Abort 语义对齐）。

## 开发/验证回路（不依赖完整打包）

- `--payload <dir>`：从目录读载荷（ v1 不自解内嵌；Milestone B 做 SFX 尾部嵌入，届时 `--payload` 保留为调试入口）
- `--auto-install`：跳过交互，默认值直接开装（供无头验证）
- `--capture-preview` / `--self-test-*` 保留
- `scripts/installer-shell/make-test-payload.cjs`：生成微型合成载荷（假 app 文件 + 7 组件微型 7z + 全部脚本/清单），引擎全流程跑通后断言安装树形态（junction、.complete、哨兵）与进度事件序列。这是引擎的端到端测试。
- 里程碑 A 完成标准：合成载荷端到端装到临时目录成功，进度事件含逐阶段 label 与字节级 percent，安装树与 NSIS 产出同构（junction 指向内容寻址目录、resources 链接齐全），`nsis-installer.test.ts` 全绿。

## 明确不做（本里程碑）

- 载荷内嵌/打包成单文件（Milestone B）
- 真机 VC++/权限边界之外的异常矩阵（保留 error 事件通道即可）
- 卸载器 UI 流（注册要写，uninstall.exe 入口 Milestone C）
- electron-builder 构建链集成（Milestone B/C）
