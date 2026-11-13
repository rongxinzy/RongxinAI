# llama.cpp v1.0.0（b12359）升级说明

本文记录知远智能体将预构建 llama.cpp runtime 从 **b9244** 升级到 **v1.0.0 / nightly b12359** 的核验结论、边界约束与验收矩阵。镜像站（`rongxinai.krli.org`）属于外部部署，本仓库仅维护 manifest/checksum 与受控 GitHub fallback，不上传或发布镜像。

## 版本与来源（单一权威）

| 字段 | 值 |
| --- | --- |
| 语义版本 | `1.0.0`（`package.json` → `llamacpp.runtimeSemanticVersion`） |
| 预构建 tag | `b12359`（`package.json` → `llamacpp.runtimeReleaseTag`） |
| v1.0.0 Git tag commit | `2d8a32502909ca065c41c4cf5f2fb1c427c047fc` |
| b12359 构建 commit | `b1b770d90d94cad9e9ea5b993bdbc383a522fb28` |
| nightly 解析 | [v1.0.0 资产 `nightly-tag.txt`](https://github.com/ggml-org/llama.cpp/releases/download/v1.0.0/nightly-tag.txt) 内容为 `b12359`（不得以「下一 nightly」推断） |

完整资产 SHA-256 见 `resources/llamacpp-backends/manifest.json` 与 `bundle-checksums.json`。

## 条件化验收矩阵

| # | 条件 | 结论 |
| --- | --- | --- |
| 1 | Pi/Magpie 边界、Lite 安装语义不变 | 未改 Pi adapter、未新增在线装 runtime 产品流；Magpie 仅修正本地 GPU `input` 与 `/props` 能力对齐 |
| 2 | pin 集中维护 | `package.json` + manifest；Lite installer 经 `llamacppPackagePin` 读取 |
| 3 | 先验证再修 | `f8_e4m3` 经 b12359 `--help` 允许列表确认；KV 以运行时 help 枚举做启动门禁；mmproj preset 未改（待有 vision fixture 实测自动配对） |
| 4 | CUDA sm_89 自构建 | 未改 `build-llamacpp-cuda-rtx40.sh` 政策；Linux CUDA 预构建资产仅更新为 12.8/13.5 文件名 |
| 5 | 镜像站 | `mirrorStatus: pending-sync-external-deployment`；CI 默认 GitHub 官方源 |
| 6 | 产品路径 CPU 测试 | `llamacppProductPath.integration.test.ts`，`LLAMACPP_PRODUCT_PATH_INTEGRATION=1` |
| 7 | A 项收口 | 见下表 |
| 8 | CI | 独立分支 PR，不合并 |

## A 项：修复 / 验证

| 项 | 处理 | 证据 |
| --- | --- | --- |
| Runtime pin b12359 | 更新 package/manifest/checksums/下载脚本默认 | manifest `defaultVersion`；`download-llamacpp-runtime.cjs` |
| Magpie vision `input` | `managedProviderBindings` + binding `supportsImage` | 单元测试 |
| KV `f8_e4m3` | 类型表 + help 解析门禁 | `parseLlamaCppKvCacheTypesFromHelp`；b12359 `--help` |
| mmproj preset | **未改**（假设：同目录 mmproj 仍可由 runtime 发现） | 待 opt-in integration + 小 vision GGUF |
| CUDA 预构建命名 | Linux 12.8 / 13.5 资产名与 checksum | manifest |
| 向后配置 | 非法 KV 类型保存拒绝；启动时剔除 runtime 不支持的 KV | `filterLlamaCppServiceConfigByRuntimeCapabilities` |

## 回滚

- 将 `package.json` `llamacpp.runtimeReleaseTag` 改回 `b9244` 并恢复对应 manifest/checksums（用户数据目录 runtime 不主动删除；应用回退 pin 后按既有下载/切换流程重装）。

## 未在本机硬件验证

Windows / macOS 打包安装、CUDA/Vulkan/Metal 真机推理未在 CI 单测环境实测；相关项仅编译/单测/mock 覆盖。
