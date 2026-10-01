# Windows 安装器深度排查报告

日期:2026-10-01 · 分支:`installer-probe`(worktree)· 范围:仅排查,未改代码

## 现象与样本

用户侧 `install-timing.log`(2026-10-01 导出):

```
phase=custom-init-start        tick_ms=9649484
phase=process-stop-complete    elapsed_ms=1469
phase=skill-migration-complete elapsed_ms=1437
phase=old-install-detached     elapsed_ms=0 path=      ← path 为空
```

已插桩的三段合计约 3 秒,都很快。**日志在 `old-install-detached` 之后再无任何记录**——而后面本应出现 7 条 `component-cache-hit/miss`、`component-ready`、`component-cleanup-complete`、`install-complete`。说明大部分时间消耗在两段完全未插桩、且界面上零反馈的区间里(或安装器被中途放弃)。

CI 侧(2026-09-28 定时跑,GitHub NVMe runner、无杀软):冷装 + 缓存命中升级 + 卸载合计 **2 分 41 秒**;冒烟超时却设到 冷装 2700s / 升级 600s / 卸载 300s(`scripts/ci/windows-installer-smoke.ps1:30,120,153`)。团队自己给真实机器留了 45 分钟——说明慢是已知的,只是没有归因。

体积上限(`scripts/ci/windows-installer-size-smoke.ps1`):安装器整体 ≤450MB,组件归档 ≤300MB,非组件(应用本体)≤150MB。**问题不在字节数,在文件数×流程**。

## 根因清单(按严重度排序)

### F1. 破坏性动作挂在 .onInit——向导还没出现,应用已经被杀、目录已被挪走

`customInit` 由 electron-builder 模板插入 `.onInit`(`node_modules/app-builder-lib/templates/nsis/installer.nsi:81-83`,在 welcome 页之前执行)。它做三件事(`scripts/nsis-installer.nsh:124-188`):

1. `StopAppProcesses` 杀掉应用与全部 sidecar;
2. 迁移用户 Skills;
3. **把 `$INSTDIR` 改名为 `$INSTDIR.old.<tick>`**(命中时)。

用户此刻还没点"安装"。此后任何取消、崩溃、AV 拦截,都留下:应用被杀 + 安装目录被改名 + 无回滚。用户样本里 `path=` 为空,无法区分"没有旧目录"还是"改名失败"两种分支(诊断盲点,F9)。重复运行安装器排查问题时,第一次运行就可能把目录挪走。

### F2. 最长的两段既无插桩、也无 UI 反馈 → 用户感知为"卡死"

- **应用本体解包**(electron-builder `installApplicationFiles`,非组件 ~150MB 压缩、数千文件):发生在 customInit 与 customInstall 之间,完全未插桩。
- **组件流水线内部**:`validate-offline-components.ps1 -Mode cache`(对账)、每组件 `File` 落盘 `$PLUGINSDIR`、`-Mode expand` 里的 SHA-256 + `7za x` + 全树测量,全部跑在 `nsExec` PowerShell 里——安装页 `ShowInstDetails nevershow`(`nsis-installer.nsh:74`),nsExec 期间进度条不动。

CI 冒烟能每 60s 打印 timing log 尾部,真实用户什么反馈都看不到。用户日志"停在 old-install-detached"与"看起来装不动"完全自洽。

### F3. 每次安装都对 7 棵组件树做全量文件枚举对账

cache 命中路径(`validate-offline-components.ps1:170-197`)对每个组件执行 `Measure-ComponentTree`:递归枚举展开树的**每一个文件**,比对 `.complete` 记录的 count/bytes。展开树合计数万文件(portable-git、python、skill-python venv 都是小文件大户)。在 Defender 实时监控下,这种纯元数据枚举本身就要几分钟——**每次升级都付一遍**,即使什么都没变。它是为了防"中断搬移留下残树",但用全量审计防低概率事件,代价放错了位置。

### F4. 冷装/组件变更时,同一批字节过 5 遍手

对每个 cache-miss 组件(`validate-offline-components.ps1:199-255` + `nsis-installer.nsh:208-218`):

1. NSIS `File`(SetCompress off)把 .7z 从安装器数据块写到 `$PLUGINSDIR`——**全量写 #1**;
2. `Get-FileHash` 对归档做 SHA-256——**全量读 #2**;
3. `7za x` 展开到 `.installing`——**展开写 #3(数万小文件,每个都过 Defender)**;
4. `Measure-ComponentTree` 再枚举全树——**元数据遍历 #4**;
5. `finally` 删除暂存 .7z。

其中 #2 是冗余的:NSIS 数据块与 7z 条目自带 CRC,展开后还有 sentinel 哈希与 manifest 绑定校验,再对整包做一遍 SHA-256 属于重复防御。

### F5. 遗留的"首启整树拷贝到 roaming"路径,与安装器组件缓存设计冲突

`src/main/libs/pythonRuntime.ts:271-337` `ensurePythonRuntimeReady`(initApp 时调用,`main.ts:8026`):roaming 副本 `%APPDATA%\ZhiYuanAgent\runtimes\python-win`(userData=appData/ZhiYuanAgent,`main.ts:833-836`)不健康时,`cpRecursiveSync(bundledRoot, userRoot, {dereference:true})` **穿过 junction 把整个 python-win 再复制一份到 roaming**。后果:首启卡顿数分钟、磁盘双份、域机器 roaming 配置文件膨胀。junction 方案本意就是免拷贝;PATH 还优先 userRoot(`pythonRuntime.ts:253`),拷贝行为被固化。用户机器日志显示 `User runtime already healthy`(早已付过这一次性代价),但这解释了很多"装完第一次启动巨慢"的投诉。skill-python 层已改为纯解析不拷贝(`skillPythonRuntime.ts:65-71`),python 是漏网的最后一个。

### F6. 串行化:6+ 次 PowerShell 冷启动、7 组件串行展开

customInstall 里至少 6 个独立 `nsExec powershell`(recover、cache 校验、expand、切换、连接、清理),每次冷启动 0.5-1.5s(杀软下更久);组件逐个串行展开。相对 F2-F4 是小头,但都在用户等待路径上。

### F7. 升级必然全量重解应用本体 + runAfterFinish 叠加首启成本

electron-builder 每次升级都完整重解 ~150MB 应用文件(blockmap 只省下载,不省安装);`runAfterFinish: true`(`electron-builder.json:327`)装完自动启动,若用户勾了本地推理组件,首启还要下载 16–621MB 后端——都被算进"安装慢"的体感。

### F8. 没有安装时长门禁

CI 只断言正确性(7 个 cache-miss/hit、junction、卸载干净)与体积上限;`install-complete total_ms` 已经写进日志却没有任何阈值断言,时长回归无人察觉。

### F9. 诊断盲点汇总

- timing log 每次 customInit 被 `FileOpen w` 截断(`nsis-installer.nsh:131`),丢失历史尝试;
- `old-install-detached` 不记录"无旧目录/改名失败"分支;
- `-Mode cache` 运行期间无任何日志输出(恰是最长的静默段之一);
- customInstall 入口没有 `phase=custom-install-start` 标记,无法把"应用解包"与"组件流水线"两段耗时拆开;`install-start-tick.txt` 已存在,补一行即可。

## 修复建议(按投入产出排序)

1. **插桩与反馈(半天,收益最大)**:customInstall 入口写 `phase=custom-install-start`;`validate-offline-components.ps1` 直接向 timing log 追加每组件 begin/end(含字节数);`ShowInstDetails` 改 `show`;timing log 改为带时间戳的追加式(保留历史,便于诊断用户机器)。
2. **危险动作后移(1 天)**:杀进程与旧目录改名移出 `.onInit`,放到用户点完"安装"之后(customInstall 头部或 INSTFILES 触发时);`.onInit` 只做只读探测。取消即全身而退。
3. **缓存对账降级(1 天)**:cache 命中快路径只查 `.complete` 记录 + junction 存活 + sentinel 哈希(单文件);全量 count/bytes 审计只留给冷装、修复安装或显式环境变量。
4. **去掉整包 SHA-256(几行)**:expand 路径删掉 #2,依赖 7z CRC + sentinel + manifest 绑定。
5. **终结 roaming 拷贝(1-2 天)**:Windows 上 python 运行时直接解析到 junction;已存在的 roaming 副本惰性迁移后删除,PATH 顺序同步调整。
6. **CI 时长门禁(几行)**:冒烟脚本解析 `total_ms`,冷装/升级各设上限(建议先以 CI 实测 P90 定阈值,只报警不阻断,观察两周再转硬门禁)。
7. (可选,更大改动)组件包落盘为持久缓存 `%LOCALAPPDATA%\ZhiYuanAgent\packages\<contentId>.7z`,安装失败/缓存损坏时本地重展开,不必重新下载完整安装器。

## 实施记录

本分支已实施建议 1-4 与 6(插桩与反馈、危险动作后移、对账降级、去整包哈希、CI 时长预算);建议 5(终结 roaming python 拷贝)属应用侧行为变更,单独成 PR。验证:nsis-installer 内容断言 17/17;validator 在真实 Windows PowerShell 5.1 + 7za 上端到端 11 项断言全过(冷缓存拒绝原因、展开计时、快路径命中、默认容忍/深审计拒绝、篡改归档被 7z CRC 拦截);WSL 内无法编译 NSIS 与打包,完整安装器验证依赖 Windows CI(windows-installer 门禁)。
