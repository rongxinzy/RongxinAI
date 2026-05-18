# RongxinAI 打包策略分析

## 概述

RongxinAI 基于 Electron 40.2.1，使用 electron-builder 构建，面向 Windows / macOS / Linux 三个平台。安装包约 400-500 MB，安装后约 1.2 GB，膨胀来自安装包格式自身的压缩解压。

三大资源目录构成体积主体：

| 资源 | 来源 | 说明 |
|------|------|------|
| `cfmind/` | `vendor/openclaw-runtime/current/` | OpenClaw 网关运行时 (Node.js) |
| `SKILLs/` | `SKILLs/` | AI 技能模块及其 node_modules 依赖 |
| `python-win/` | `resources/python-win/` | 便携式 Python 运行时 (仅 Windows) |

---

## Windows (NSIS)

### 配置

```json
// electron-builder.json
"win": { "target": ["nsis"] },
"nsis": {
  "oneClick": false,
  "allowToChangeInstallationDirectory": true,
  "runAfterFinish": true,
  "deleteAppDataOnUninstall": true,
  "include": "scripts/nsis-installer.nsh"
}
```

Windows 的 `extraResources` 不直接包含三大资源目录，而是包含一个预打包的 tar 文件和提取脚本：

```json
"extraResources": [
  { "from": "build-tar/win-resources.tar", "to": "win-resources.tar" },
  { "from": "scripts/unpack-cfmind.cjs",    "to": "unpack-cfmind.cjs" }
]
```

### 安装流程

```
NSIS 安装程序 (LZMA 压缩)
  │
  ├─ 1. customInit
  │     ├─ 终止所有 RongxinAI.exe / node.exe 进程
  │     ├─ 清理过期 WeChat session 数据
  │     ├─ 备份用户自定义 SKILLs → %APPDATA%\RongxinAI\skills-backup\
  │     └─ 重命名旧安装目录 → $INSTDIR.old.<timestamp> (异步删除)
  │
  ├─ 2. 7z 解压安装包内容
  │     └─ 产生 win-resources.tar (1 个大文件) + app 其余文件
  │
  ├─ 3. customInstall
  │     ├─ 添加 Windows Defender 排除路径
  │     ├─ 以 ELECTRON_RUN_AS_NODE=1 启动 Electron 执行 unpack-cfmind.cjs
  │     │   └─ npm tar 模块解压 win-resources.tar → cfmind/ + SKILLs/ + python-win/
  │     ├─ 恢复用户自定义 SKILLs (不覆盖新版本同名技能)
  │     └─ 清理 win-resources.tar 和 unpack-cfmind.cjs
  │
  └─ 4. 安装完成，自动启动应用
```

### 选择 NSIS 的原因

1. **electron-builder 原生支持** — NSIS 是 electron-builder 在 Windows 上的首选目标，无需额外依赖
2. **LZMA 压缩率高** — 将 ~1.2GB 内容压缩到 ~500MB
3. **自定义安装逻辑** — NSIS 支持 `!macro customInit` / `customInstall` 等扩展点，可在安装前后执行任意脚本

### 为何打 tar 而不是直接包含小文件

这是 Windows 打包中最关键的设计决策。核心问题在于 **7z 解压器在 NTFS 上逐文件创建的开销极高**。

7z 内嵌于 NSIS，负责将 LZMA 压缩流解压为实际文件。7z 是通用归档工具，每创建一个文件都会：
- 设置 NTFS 安全描述符 (ACL)
- 处理备用数据流 (Alternate Data Streams)
- 同步文件时间戳和属性

在 NTFS 上这些操作的单文件开销远高于 ext4/APFS。当文件数量达到数千个时，累积开销会导致安装进度条长时间卡住。

打 tar 的策略：
- **NSIS/7z 层面**：只创建 1 个 tar 文件（约 500MB），7z 的单文件开销只发生一次
- **customInstall 层面**：用 Node.js `fs.WriteStream` + npm `tar` 模块逐文件提取，Node.js 的轻量 I/O 路径避免了 7z 的元数据开销

```
                │  7z 直接解压 3000 文件    │  先打 tar，再用 Node.js 解压
────────────────┼──────────────────────────┼───────────────────────────────
 NSIS/7z 阶段   │  创建 3000 个文件 (慢)     │  创建 1 个文件 (快)
 customInstall  │  不需要                    │  创建 3000 个文件 (较快)
────────────────┼──────────────────────────┼───────────────────────────────
 总文件写入      │  3000 次                   │  3001 次
 瓶颈在         │  7z 的 NTFS 元数据开销     │  分散到两个阶段
```

### 为何 `oneClick: false`

- 用户需要选择安装目录（`allowToChangeInstallationDirectory: true`）
- 安装后资源目录（cfmind/SKILLs/python-win）体积巨大，用户可能希望安装到非系统盘
- 完整向导 UI 让用户在覆盖安装前看到确认信息

### 自定义 NSIS 脚本的其他作用

- **进程终止 (customInit)** — 安装前强制结束所有 RongxinAI.exe 和安装目录下的 node.exe，避免文件被锁定导致安装失败。特别处理了无窗口的 OpenClaw 网关进程
- **旧目录原子重命名** — 将 `$INSTDIR` 重命名为 `$INSTDIR.old.<timestamp>` 而非直接删除，防止旧卸载程序路径被 electron-builder 检测到而弹出"应用无法关闭"对话框
- **用户数据备份恢复** — 备份和恢复用户创建的 SKILLs，确保覆盖安装不丢失自定义技能
- **Windows Defender 排除** — 为资源目录添加排除，避免 Defender 实时扫描拖慢应用启动
- **覆盖安装友好** — 上述所有步骤确保用户无需先卸载旧版本再安装新版本

---

## macOS (DMG)

### 配置

```json
// electron-builder.json
"mac": {
  "target": ["dmg"],
  "hardenedRuntime": true,
  "gatekeeperAssess": false,
  "entitlements": "build/entitlements.mac.plist",
  "extraResources": [
    { "from": "SKILLs",                         "to": "SKILLs" },
    { "from": "vendor/openclaw-runtime/current", "to": "cfmind" }
  ]
}
```

### 安装流程

```
DMG 磁盘映像 (UDZO zlib 压缩)
  │
  ├─ 用户双击 .dmg → macOS 挂载为虚拟磁盘
  │
  ├─ 用户拖拽 RongxinAI.app → /Applications/
  │   └─ macOS 解压复制 .app 包到本地文件系统
  │
  └─ 首次启动时 macOS 执行 Gatekeeper 验证
```

### 选择 DMG 的原因

1. **macOS 用户预期** — DMG 是 macOS 上最传统的软件分发格式，用户熟悉拖拽安装
2. **压缩** — UDZO 格式使用 zlib 压缩，将 ~1GB+ 的 .app 压缩到 ~400-500MB
3. **代码签名兼容** — DMG + `hardenedRuntime` 是 Apple 公证 (Notarization) 的前置要求
4. **无需安装脚本** — .app 是自包含 Bundle，复制即安装，删除即卸载

### macOS 不需要 tar 的原因

- `.app` Bundle 本身就是目录树结构，DMG 制作时 electron-builder 直接将所有文件写入 DMG 的 HFS+/APFS 文件系统
- DMG 压缩发生在**文件系统镜像层面**，不是单个文件压缩。挂载后透明解压
- macOS 的 APFS 不存在 NTFS 小文件性能问题，数千个小文件复制到 `/Applications` 速度正常

### 自动更新实现

`src/main/libs/appUpdateInstaller.ts` 中的 `installMacDmg()`：

1. `hdiutil attach` 挂载 DMG
2. `rm -rf` 删除旧 `.app` + `cp -R` 复制新版本
3. 权限不足时回退到 `osascript` + 管理员权限
4. `hdiutil detach` 卸载 DMG
5. `app.relaunch()` 从新位置重启

### 公证 (Notarization)

`scripts/notarize.js` — 使用 Apple Notary API 提交 `.dmg` 进行公证，避免 Gatekeeper 阻止启动。

### afterPack 处理

`scripts/electron-builder-hooks.cjs` 中的 `afterPack`：
- 删除 `cfmind` 中的 `node_modules/.bin` 目录（符号链接会破坏代码签名）
- 修复 Apple Silicon 图标 (`CFBundleIconName` + `xattr -cr`)

---

## Linux (AppImage + deb)

### 配置

```json
// electron-builder.json
"linux": {
  "target": ["AppImage", "deb"],
  "category": "Utility",
  "extraResources": [
    { "from": "SKILLs",                         "to": "SKILLs" },
    { "from": "vendor/openclaw-runtime/current", "to": "cfmind" }
  ],
  "desktop": {
    "Name": "RongxinAI",
    "Comment": "AI-assisted coding and productivity tool",
    "Terminal": "false"
  }
}
```

### 双格式策略

| 格式 | 安装方式 | 压缩 | 适合场景 |
|------|---------|------|---------|
| **AppImage** | 下载即用 (`chmod +x` 后直接运行) | squashfs (zstd) | 无 root 权限、便携使用、跨发行版 |
| **deb** | `dpkg -i` 或软件中心安装 | xz | Debian/Ubuntu 系用户、系统级安装 |

### 选择 AppImage 的原因

1. **跨发行版兼容** — AppImage 将应用和所有依赖打包进一个 squashfs 文件系统，不依赖系统库版本
2. **无需 root** — 用户不需要 `sudo` 即可运行
3. **便携** — 可以放在任何目录、U 盘，删除即卸载
4. **压缩** — squashfs 使用 zstd 压缩，将 ~1GB+ 内容压缩到 ~400-500MB，运行时透明解压
5. **防篡改** — squashfs 是只读文件系统，运行时无法修改应用内容

### 选择 deb 的原因

1. **系统集成** — 安装后在应用菜单中注册、通过包管理器管理
2. **自动升级** — Deb 包管理器支持 `apt upgrade`
3. **依赖声明** — 可以声明系统级依赖（如 `libgtk-3-0`），由包管理器自动安装
4. **用户习惯** — Ubuntu/Debian 用户习惯用 `.deb` 包

### AppImage 不需要 tar 的原因

- AppImage 本质是一个 squashfs 文件系统镜像，electron-builder 直接将所有文件写入 squashfs 并压缩
- 运行时通过 FUSE 或 `--appimage-extract` 解压到临时目录，透明挂载，不存在逐个写文件的场景
- 写入 squashfs 的文件数量不影响安装速度（都是一次性打包操作）

### Deb 不需要 tar 的原因

- Deb 包内是 `data.tar.xz`，用 xz 压缩整个目录树
- `dpkg -i` 解压时直接写入 ext4，ext4 不存在 NTFS 的小文件瓶颈
- 打包和安装都是一次性操作，文件数量不构成性能瓶颈

---

## 三平台对比总结

| 维度 | Windows (NSIS) | macOS (DMG) | Linux (AppImage) | Linux (deb) |
|------|---------------|-------------|-----------------|-------------|
| **安装包格式** | NSIS 安装程序 (.exe) | Apple Disk Image (.dmg) | AppImage (.AppImage) | Debian 包 (.deb) |
| **压缩算法** | LZMA (7z) | zlib (UDZO) | squashfs + zstd | xz |
| **典型包大小** | ~500 MB | ~500 MB | ~500 MB | ~500 MB |
| **安装后大小** | ~1.2 GB | ~1.0 GB | ~1.0 GB | ~1.0 GB |
| **需 root** | 否 (asInvoker + UAC 提升) | 否 | 否 | 是 (`dpkg -i` 需要 sudo) |
| **安装方式** | 运行安装向导 | 拖拽 .app 到 /Applications | `chmod +x` 直接运行 | `sudo dpkg -i` |
| **卸载方式** | 控制面板 / 安装目录 uninstall.exe | 删除 .app 即可 | 删除文件即可 | `sudo dpkg -r` / `apt remove` |
| **覆盖安装** | 支持 (customInit 自动处理) | 支持 (拖拽替换) | 支持 (替换文件) | 支持 (dpkg 自动升级) |
| **小文件瓶颈** | **有** (NTFS + 7z 逐文件) | 无 | 无 | 无 |
| **解决方案** | 打 tar → Node.js 解压 | 不需要 | 不需要 | 不需要 |
| **python-win** | 包含 | 不含 | 不含 | 不含 |

### 核心设计原则

1. **平台原生分发** — Windows 用 .exe 安装程序，macOS 用 .dmg，Linux 用 AppImage + deb，符合各平台用户习惯
2. **覆盖安装友好** — 所有平台均支持直接覆盖安装，无需手动卸载旧版本
3. **压缩在容器层** — 安装包的压缩来自平台原生的包格式（7z/zlib/squashfs/xz），而非资源文件本身
4. **Windows 特殊处理** — 打 tar 是为了绕过 NSIS 内嵌 7z 在 NTFS 上的逐文件性能瓶颈，是工程实践的针对性优化
5. **安装即用** — 安装完成后不需额外配置即可运行，便携 Python (仅 Windows)、OpenClaw 运行时、SKILLs 全部打包在内
