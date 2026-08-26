# Windows 安装器瘦身与 cc-connect + 原生 Pi 迁移规划

日期：2026-08-11。本文是 Windows 离线安装器、Python 依赖去重，以及 OpenClaw Channel/Cron 迁移到 cc-connect + 知远原生 Pi 的实施基线。本文只定义范围、顺序、验收和回滚；不包含实现代码。

> 文件名为早期 PicoClaw 方案留下的历史路径。自本版起，方案中不再引入或运行 PicoClaw。

## 已锁定的产品决策

下一正式版采用 **cc-connect + 原生 Pi**：cc-connect 只承担频道协议适配、消息投递和 Cron 触发；知远现有嵌入式 `PiRuntimeAdapter` 是唯一 Agent 执行引擎。

- 新版安装包、活动 runtime manifest、安装目录和进程树不得包含或运行 OpenClaw、PicoClaw。
- 不发布 OpenClaw、PicoClaw、cc-connect 并存的过渡版本，也不提供新版内的 OpenClaw/PicoClaw fallback 开关。
- cc-connect 自带的 Pi、Claude、Codex 等 Agent adapter 必须在产品构建中禁用或移除；不得派生 `pi --mode rpc/json`、第二套 Agent session、Provider 或凭据。
- Pi 同时承接桌面 Work/Chat 和远程 Channel agent turn，但频道会话使用独立 session scope，不与桌面 Work 会话混写。
- 知远继续拥有用户可见的 ChannelAccount、ChannelSession、Task、Run、Delivery、审批、密钥、Provider 和模型选择；cc-connect 不成为这些对象的事实来源。
- 回滚是重新安装上一正式版本，而不是在新版内部切换引擎。

开发和 CI 可以使用旧版本作为迁移输入或行为对照，但不得产出、上传或发布同时嵌入多套 Agent runtime 的安装包。

## cc-connect fork 与供应链基线

实施仓库固定为知远 fork：`https://github.com/rongxinzy/pi-connect`。该 fork 当前与上游 `chenhg5/cc-connect` 的 `main` commit `3fc360ee6acc9bab13ab1b48ddde3af44062903b` 一致，作为裁剪工作的可追溯基线。

按项目决策接受上游 README 标注的 MIT 许可，不再设置额外许可前置条件或发布阻断。发布留档保留上游仓库 URL、MIT 声明、upstream baseline、知远裁剪 commit、源码归档、依赖锁、Windows x64 二进制 SHA-256 和 SBOM。

在 `rongxinzy/pi-connect` 建立知远维护分支和 immutable release tag。发布构建只能从该 fork 的固定 tag 重现，不允许安装或启动时拉取 `latest`。

### fork 裁剪边界

所有 cc-connect 产品改动直接落在 `rongxinzy/pi-connect`，知远智能体只通过版本化 bridge 协议和固定二进制依赖它。裁剪目标不是保留一个通用 cc-connect 发行版，而是形成知远专用的最小 Channel/Cron sidecar：

- 保留当前七频道所需的 platform adapter、消息规范化、重连、去重、媒体和投递逻辑。
- 保留 Cron 表达式解析、触发注册和必要的进程生命周期；Cron 只产生知远触发事件。
- 新增唯一的 `zhiyuan` bridge adapter，将入站消息和 Cron trigger 发送给知远智能体，不执行模型调用。
- 删除或在构建期排除上游全部 Agent adapter、Provider presets、skill presets、npm wrapper、通用 Web UI，以及不属于本地健康/频道/Cron 控制面的管理 API。
- 删除 exec/shell Cron 的创建与执行路径，而非仅在 UI 隐藏；保留的配置 schema 也不得接受该 payload。
- 以编译目标和产物扫描双重断言禁止裁剪后重新带入被移除模块。

fork 与知远智能体分别发布、分别打 tag；知远智能体的 `channel-runtime` manifest 固定记录 pi-connect release tag、commit 和 binary hash，禁止仅记录可漂移的分支名。

## 当前基线与问题

当前 Windows 安装器保留七组件内容寻址缓存：OpenClaw、Skills、MCPs、PortableGit、Python、Skill Python、uv。构建阶段为每个组件生成 `.tar`，见 `scripts/electron-builder-hooks.cjs`；NSIS 在缓存 miss 时嵌入并解开 `.tar`，见 `scripts/nsis-installer.nsh`。

这改变了压缩路径：旧版大资源进入 electron-builder 的外部 7z 压缩，新版七个原始 tar 通过 NSIS/zlib 嵌入。原始载荷本身只小幅变化，但安装器从约 542 MB 升至约 672 MB。

截图中的安装失败发生在组件激活，而非下载或解压：创建 `current.next` Junction 时目标目录不存在；该 PowerShell 块没有将该错误变成终止错误，继而又重命名了不存在的 `current.next`，造成级联报错。当前逻辑位于 `scripts/nsis-installer.nsh` 的组件激活段。

Skill Python 当前为每个带 `requirements.txt` 的 Skill 创建完整 relocatable venv，并使用 `--link-mode copy`。解释器和重叠依赖被多次复制，导致 `skill-python` 原始载荷约 409.6 MB。运行时按 `skillId + requirementsSha256` 查找独立环境，见 `src/main/libs/skillPythonRuntime.ts`。

Channel 和 Cron 目前深度依赖 OpenClaw：`IMGatewayManager` 直接同步和启动 OpenClaw 平台；`CronJobService` 直接调用 `cron.add/update/list/remove/run/runs`。cc-connect 也有自己的配置、session、Agent adapter、Cron store 和管理 API，因此不能仅替换可执行文件，必须先确定单一事实来源和桥接契约。

## 目标架构

### 七组件保持不变

下一版活动 manifest 固定为七项：

| 组件 key | 内容 |
| --- | --- |
| `channel-runtime` | 固定版本 cc-connect、`zhiyuan-cc-bridge`、MIT 归属记录、SBOM 和最小运行元数据 |
| `skills` | 内置 Skills |
| `mcps` | 内置 MCPs |
| `portable-git` | PortableGit |
| `python` | 唯一的 CPython 基础运行时 |
| `skill-python` | Python dependency layers、锁文件、Skill 到 layer 的映射 |
| `uv` | 固定版本 uv |

`openclaw` 不再是活动组件 key；cc-connect 不是 Agent runtime，因此组件名固定为 `channel-runtime`，不能沿用容易误导所有权的 `autonomy-runtime`。旧版本用户目录中可能存在历史缓存；迁移成功后删除 OpenClaw 可执行 runtime，只保留受权限保护、不可执行的迁移快照用于诊断或整版回退。

### 组件归档

每个组件构建为独立 `.7z`，保持现有内容 ID、独立缓存命中和“只展开变更组件”的语义。

- 逻辑内容 ID 由组件 key、布局版本和未压缩文件树决定；archive SHA-256 单独记录。
- manifest 增加 archive format/schema、压缩/展开大小、sentinel SHA-256、最小可用磁盘空间和 7za 工具摘要。
- NSIS 仅在嵌入已经压缩的 `.7z` 时局部关闭二次压缩；其他安装器文件继续压缩。
- 固定并校验一个 7za 解压器；归档条目必须拒绝绝对路径、`..`、ADS、符号链接和 reparse point。
- 归档始终解到受控的 `<contentId>.installing`，校验 sentinel 后才重命名提交。

### 组件切换事务与截图故障修复

组件切换的唯一可信输入改为嵌入的 JSON manifest，而不是 `component-targets.txt` 的分隔文本。

1. 预检：七项数量、key/prefix、content ID、目标目录、`.complete`、sentinel 和 SHA-256 全部有效。
2. 准备：为全部组件创建并验证 `current.next` Junction。
3. 提交：记录 journal 后将 `current -> current.previous`、`current.next -> current`。
4. 验证：确认全部七个 `current` 都解析到预期目标，再删除 `current.previous` 和 journal。

PowerShell 必须使用严格模式和终止错误策略；准备失败时不得进入提交；任何错误日志必须含 `componentKey`、`contentId`、目标路径和阶段。普通异常自动回滚；强杀或断电由下次安装读取 journal 修复，不能宣称跨七目录系统级原子性。

### Python 依赖布局

`python` 组件只保留一个基础解释器。`skill-python` 不再有每 Skill 一个 venv，而是：

- `locks/`：按平台、架构和 Python ABI 固定的依赖锁及 hashes；
- `store/`：每个 wheel/发行包按摘要只物化一次；
- `layers/`：可兼容依赖闭包；
- `skills/`：`skillId + requirementsHash -> layerIds` 映射。

运行时通过受控 launcher 为基础 Python 注入该 Skill 的 layer 路径。相同闭包必须复用；存在真实版本冲突时拆分 layer，不能把所有依赖强制并入一个全局环境。

uv 只负责构建期锁定、hash 校验、目标平台 wheel 物化和离线验证。内置 Skill 在最终安装包中不允许网络解析或临时安装；用户后装 Skill 的 uv 缓存与只读组件缓存隔离在用户数据目录。不要把临时 uv hardlink/cache 关系作为发布包的正确性前提。

### cc-connect 的严格运行边界

cc-connect 是本地 sidecar，只允许启用以下能力：

- 已批准频道的连接、鉴权协议、事件接收、媒体处理、重连、去重和消息发送；
- 由知远下发的 Cron 触发注册、取消和触发通知；
- 本地健康、版本和受限诊断信息。

以下能力必须禁用或从产品构建中移除：

- cc-connect 自带的任何 Agent provider/adapter 和 Pi CLI 启动路径；
- 让 cc-connect 独立选择模型、保存模型密钥或维护用户可见 Agent session；
- 通过管理 API 直接创建任意 shell/exec 定时任务；
- 对局域网或公网监听未鉴权的管理 API、WebSocket 或 webhook；
- cc-connect 自带 Web UI 成为产品设置或任务管理入口。

sidecar 默认仅绑定 loopback；控制面使用每次安装生成、存入知远安全存储的凭据，并校验协议版本、进程身份和请求 nonce。若 Windows named pipe 能覆盖所需双向事件，优先使用 named pipe；使用 loopback HTTP/WebSocket 时必须启用随机端口、短期 token、重放保护和最小路由集。

### 知远 cc-connect bridge

业务层先依赖知远自有的版本化接口：

- `ChannelRuntime`：账号配置、启停、健康、连通性、收发、媒体、二维码登录和重连状态；
- `SchedulerRuntime`：创建、更新、禁用、删除、立即执行、运行事件、时区和交付结果；
- `RemoteAgentBridge`：把已标准化的频道消息映射到嵌入式 `PiRuntimeAdapter`，并将最终输出交给频道投递。

`zhiyuan-cc-bridge` 的入站事件至少携带 `platform`、`accountId`、`conversationId`、`senderId`、`messageId`、`replyContext`、附件描述和上游时间戳。知远以 `(platform, accountId, conversationId, senderId)` 解析独立 Pi session scope，以 `(platform, accountId, messageId)` 做幂等；同一会话串行，不同会话受全局并发限制。

Pi 的流式事件、工具调用、审批和最终结果先写入知远 Run，再由 bridge 转换为目标频道支持的 typing、临时回复、编辑或最终消息。cc-connect 只返回传输层 delivery receipt；知远保存可见的 Delivery 状态和错误分类。

频道凭据以知远安全存储为 source of truth。sidecar 只接收当前启用账号所需的最小运行配置；生成文件必须限制 ACL、可轮换且不进入日志、崩溃包或安装器 manifest。

### Cron 单一事实来源

知远 SQLite 是 ScheduledTask、Run 和 Delivery 的唯一事实来源。cc-connect 的 Cron 只作为本地触发器：

1. 用户或 Pi 在知远创建/修改任务，知远完成权限、时区、目标频道和 payload 校验。
2. bridge 向 cc-connect 注册最小触发记录：`taskId`、`scheduleVersion`、表达式、时区和一次性触发 token。
3. 到期时 cc-connect 只发送触发事件，不直接运行 Agent CLI 或 shell。
4. 知远以 `(taskId, scheduleVersion, scheduledAt)` 去重并创建 Run，由现有 `PiRuntimeAdapter` 执行。
5. 结果经 cc-connect 投递，Run/Delivery/错误/重试全部回写知远。

必须通过 fork 内部存储接口或 bridge reconciliation，避免 cc-connect JSON store 成为第二事实来源。启动、唤醒或升级时以知远任务表重建并核对触发器；cc-connect 中多余任务删除、缺失任务补建、版本不一致任务替换。默认禁止远程频道创建 shell command；有副作用的工具仍经过知远审批策略。

## 实施顺序

所有工作可拆为独立 PR 合入主线，但在 cc-connect 全量验收完成前不发布新的正式安装器。

### PR 0：固定源码与架构决策

- 以上游 commit `3fc360ee6acc9bab13ab1b48ddde3af44062903b` 为初始基线，在 `rongxinzy/pi-connect` 固定知远裁剪 commit 和 release tag。
- 生成源码归档、MIT 归属记录、依赖锁、SBOM、Windows x64 hash 和可复现构建说明。
- 用 ADR 固化“cc-connect 只负责 Channel/Cron、嵌入式 Pi 是唯一 Agent、知远是唯一业务事实来源”。
- 枚举并删除必须禁用的 Agent adapter、Provider、session store、Web UI、npm wrapper 和 exec Cron 入口；建立最小可编译模块清单。

验收：从固定源码可重现目标二进制；二进制和依赖无 `PENDING` 摘要；MIT 归属、上游来源和知远修改记录完整；禁用清单有自动化断言。

### PR 1：安装器切换事务与故障注入

- 将组件切换脚本抽离为可测试单元。
- 引入 JSON manifest 预检、journal、严格错误策略和结构化日志。
- 先保持现有 tar 格式，以隔离截图故障修复。

验收：缺失目标、损坏 manifest、陈旧 `current.next`、权限失败、磁盘不足和 Defender 锁定都只能产生一个带组件信息的错误；所有失败均不留下半切换的 `current`。

### PR 2：七组件 `.7z` 与体积门禁

- tar 构建改为每组件 `.7z`；NSIS 改用嵌入 7za 解压。
- 增加归档安全检查、工具摘要验证和每组件压缩统计。
- 将体积门禁接入 Windows PR 与正式 release workflow。

验收：同载荷安装器不大于 550 MB；后续发布不超过批准基线 `min(5%, 25 MiB)`；缓存命中时解压次数为零；冷安装耗时不比当前基线恶化超过 15%。

### PR 3：uv 锁定与 Python layer 去重

- 生成可审计的锁与 wheel 清单。
- 替换九套完整 venv 为基础 Python 加依赖 layer。
- 修改运行时解析器以读取 Skill-layer manifest。

验收：全部九个内置 Python Skill 在断网、空 PATH 条件下完成 import 和代表脚本执行；`skill-python` 原始载荷不高于 250 MB，目标为 200 MB；更新一个 Skill requirements 只使 `skill-python` 组件内容 ID 变化。

### PR 4：中立接口、cc-connect 精简构建与安全控制面

- 业务层改依赖 `ChannelRuntime`、`SchedulerRuntime` 和 `RemoteAgentBridge`，移除 IM/Cron 对 OpenClaw RPC 的直接调用。
- 从 `rongxinzy/pi-connect` 构建只包含已批准平台和 Cron 触发所需代码的 Windows sidecar。
- 禁用全部 Agent adapter、Provider/模型配置、用户可见 session、Web UI 和 exec Cron。
- 实现受鉴权的本地控制面、进程监督、健康检查、升级和结构化日志脱敏。

验收：进程树只有 Electron、cc-connect sidecar 和由用户操作合法触发的工具进程；不存在 `openclaw`、`picoclaw`、`pi --mode rpc/json` 或 cc-connect 启动的其他 Agent CLI；未授权本地进程不能调用控制面。

### PR 5：七频道接入与原生 Pi bridge

- 按现有产品范围接入 Telegram、Discord、钉钉、飞书、QQ、企业微信和微信；cc-connect 的额外平台不在本次发布范围。
- 完成 ChannelAccount/ChannelSession 投影、消息幂等、会话队列、媒体、回复上下文和 Delivery receipt 映射。
- 所有 agent turn 通过知远现有嵌入式 `PiRuntimeAdapter` 执行。

验收：多账号、白名单、私聊/群聊触发、媒体、长文本、流式/最终回复、重连、重复事件、限流、撤销/编辑能力降级、微信二维码登录均通过契约测试和真平台 smoke。

### PR 6：Cron bridge、恢复与交付闭环

- 将知远 canonical ScheduledTask 投影为 cc-connect 最小触发记录。
- 实现 create/update/disable/delete/run-now、一次性/间隔/Cron、时区、睡眠恢复、去重和 reconciliation。
- 保留现有审批、Run 历史、失败分类、重试和频道交付语义。

验收：重启、睡眠、时钟变化、错过触发、重复触发、升级和 sidecar 崩溃均不造成静默漏跑或重复执行；任务执行只能进入 `PiRuntimeAdapter`，不能进入 shell 或 cc-connect Agent adapter。

### PR 7：一次性迁移、删除 OpenClaw 与正式发布

- 首次启动只读旧 OpenClaw 配置、账号映射和 Cron 数据，先转换为知远 canonical records，再投影到 cc-connect。
- 迁移开始前停止 OpenClaw 消费频道凭据；全部记录验证通过后再启动 cc-connect，任何时刻每个机器人凭据最多一个消费者。
- 迁移完成后删除旧 OpenClaw 可执行 runtime；新 manifest、安装目录和进程树不得包含 OpenClaw 或 PicoClaw。
- 删除 OpenClaw runtime 打包、启动、配置同步和直接 RPC 路径。

迁移失败时保留旧版本目录与不可变迁移快照，停止新版频道/Cron 启动并给出可导出的诊断；回滚路径是启动或重装上一正式版。新版绝不以 OpenClaw/PicoClaw 作为运行时补救。

## 发布门禁

发布 cc-connect + 原生 Pi 版本前必须同时满足：

1. cc-connect 固定 commit、源码归档、MIT 归属、上游来源、知远修改记录、SBOM 和 Windows x64 SHA-256 完整。
2. 最终安装器与 `channel-runtime.7z` 中不存在 OpenClaw、PicoClaw 及 cc-connect Agent CLI adapter 的可执行路径或配置模板。
3. 活动 manifest 恰好七项，且第一项为 `channel-runtime`；七项归档和解压后 sentinel 均通过 SHA-256 验证。
4. Windows 冷安装、同版重装、单组件升级、失败重试和卸载均通过；缓存命中仍验证 sentinel。
5. 安装器不大于 400 MB；若无法达到，必须有逐组件压缩报告和明确的批准例外，不能静默放宽阈值。
6. 七个频道分别完成真平台 smoke；每次仅有一个 sidecar 消费对应机器人凭据，所有 Agent Run 均由嵌入式 Pi 创建。
7. 迁移 fixture 覆盖现有 OpenClaw Channel/Cron 的账号、session、delivery、timezone、enabled、last/next run、错误和历史语义；迁移后不漏跑、不重跑。
8. sidecar 端口或 pipe 不对非授权进程开放；频道/Provider 密钥不写入明文日志、安装器 manifest 或不受保护的配置。
9. 断言进程树和产物中不存在 `openclaw`、`picoclaw`、cc-connect 派生的 `pi`/Claude/Codex CLI，以及任意可远程创建的 exec/shell Cron。
10. 整版回滚、迁移重试和 channel-runtime 单组件升级完成演练并留存证据。

## 回滚与不可接受项

允许：整版降级、从迁移快照重建旧版状态、重新执行安装器以修复异常中断的组件事务、从知远 canonical records 重建 cc-connect 触发器和最小配置。

不允许：发布多 Agent runtime、在新版内重新开启 OpenClaw/PicoClaw、让 cc-connect 成为任务/会话/Provider 事实来源、启用其自带 Agent adapter、绕过 archive/sentinel hash、允许远程频道创建任意 shell Cron、为了压缩体积删除未做依赖图审计的组件文件。

## 相关代码与上游位置

- `scripts/electron-builder-hooks.cjs`：Windows 组件归档构建。
- `scripts/nsis-installer.nsh`：组件缓存、展开与 Junction 切换。
- `scripts/setup-skill-python-runtime.js`：当前每 Skill venv 构建。
- `src/main/libs/skillPythonRuntime.ts`、`src/main/libs/skillRuntimeRunner.ts`：Python 环境解析与执行。
- `src/main/libs/agentEngine/piRuntimeAdapter.ts`：唯一 Agent 执行引擎和 bridge 接入目标。
- `src/main/im/imGatewayManager.ts`：当前 OpenClaw Channel 生命周期耦合。
- `src/scheduledTask/cronJobService.ts`：当前 OpenClaw Cron RPC 耦合。
- `src/main/libs/openclawEngineManager.ts`：当前 OpenClaw 进程、状态与 Cron 恢复逻辑。
- `https://github.com/rongxinzy/pi-connect`：知远维护和裁剪的 Channel/Cron sidecar fork，知远智能体只依赖其固定 release tag。
- `https://github.com/chenhg5/cc-connect`：上游来源和行为参考；基线 commit 为 `3fc360ee6acc9bab13ab1b48ddde3af44062903b`。
