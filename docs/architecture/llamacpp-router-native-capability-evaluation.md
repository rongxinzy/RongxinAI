# llama-server 原生路由能力与网关层评估（工作包 M.2 / M.3）

日期：2026-10-20 · 状态：评估完成（基于代码与 b9244 能力面；三平台二进制实测待发版流程）

## M.2：原生 router 能力 vs 应用侧重复

打包运行时为 llama.cpp **b9244**（`package.json` 的 `llamacpp.runtimeReleaseTag`；下载脚本默认回退 b9505）。router 模式已在用原生多模型能力：`--models` 目录服务、按别名按需加载、`/models` 与 `/v1/models` 列表。两处「与原生重复」均为**有意保留**，理由已写在代码里：

### 1. `llamacppRouterEviction`（107 行）vs 原生 `--models-max` LRU

router 进程**固定以 `--models-max 0` 启动**（`llamacppRouterProcess.ts`：「Router-side LRU is disabled; the app enforces the loaded-model capacity」）。模块头写明原生 LRU 不可用的原因：

> 原生 `--models-max` LRU **会在流式生成中途驱逐模型**，并且**在注定失败的加载前先驱逐健康模型**。

应用侧驱逐补上的语义：仅当 `/slots` 探测成功且无 slot 在处理时才可驱逐（busy/unknown 一律保护）；只在加载需要腾容量时执行，逐次复查。

**结论：保留。** 原生缺少 busy 保护与「先确认加载可行再驱逐」的两阶段语义；上游补齐前删掉应用侧驱逐是行为回退。

### 2. `llamacppModelGateway`（193 行）vs 原生直连

gateway 在 router 前提供三件事，原生均无对应：

- **请求触发按需加载**（`acquireModel` → orchestrator 的 `acquireModelLease` + load）；
- **在途租约**（lease 计数：请求流式期间不卸载/驱逐该模型）；
- **loaded-only 的 `/v1/models`**（原生 `/v1/models` 列出目录里全部模型，未加载的也列出，OpenAI 兼容客户端随后 404）。

**结论：保留。** 若未来上游支持 `loaded-only` 列表与请求级在途保护，可重评减层。

## M.3：Magpie 网关与 `llamacppModelGateway` 合并评估

**结论：不合并。** 两者只共享「gateway」一词：

| | `llamacppModelGateway` | Magpie 网关 |
| --- | --- | --- |
| 受众 | 本机 loopback（Pi → 本地推理） | LAN 设备（其他机器的客户端） |
| 绑定/信任 | `127.0.0.1`，**从不鉴权**（代码注释明示） | 对外网络面，独立鉴权与提供方绑定（`magpie/managedProviderBindings`） |
| 进程边界 | 主进程内 `http.createServer` | 独立打包二进制（`verifyMagpieBinary` 校验后拉起） |
| 语义 | 在途租约 + 按需加载 + loaded-only 列表 | LAN 服务发现/鉴权/提供方投影 |

合并等于把无鉴权的 loopback 信任模型与有鉴权的 LAN 信任模型塞进同一组件，还要求在应用进程内重实现 Magpie 的 LAN/鉴权能力——安全姿态与进程隔离都会变差。共享的只有「转发到 router」这一跳，收益趋近于零。

## 待办（记录在案）

- b9244 三平台（含 CUDA edition）的 `--help` 逐项截图核对未做（本环境无打包二进制）；当前结论以代码内已固化的行为注释与 b9244 公开能力面为依据。若升级 runtime（b9505+），重查原生 eviction 是否已带 busy 保护。
- M.1（router|daemon 双模式收敛为 router-only）仍为 🔒 用户确认项，需先出三平台差异清单。
