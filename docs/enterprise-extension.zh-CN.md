# Zhiyuan 企业扩展宿主

[English](enterprise-extension.md)

Zhiyuan 社区构建与闭源企业模块分别保存在独立仓库。公开应用只从固定制品位置加载可选、版本化的主进程扩展，不包含 AEP 地址、租户配置、客户策略或私有实现代码。

## API v1

企业构建将独立 CommonJS bundle 放置在：

```text
resources/zhiyuan-enterprise/extension.cjs
```

Bundle 导出 `createZhiyuanEnterpriseExtension`。返回对象声明 `apiVersion: 1`、稳定的小写 ID，以及异步 `initialize` 和 `dispose` 生命周期方法。初始化会收到冻结的上下文，其中只包含 Zhiyuan 版本、运行平台、是否已打包、资源目录和用户数据目录。

社区安装包不包含该资源，因此会继续正常启动。已打包应用永远不接受环境变量控制的模块路径；只有开发构建可以通过 `ZHIYUAN_ENTERPRISE_EXTENSION_DEV_PATH` 指定绝对 bundle 路径。

如果扩展文件存在但无效或版本不兼容，应用会关闭启动门，不能带病继续初始化。退出时宿主只调用一次 `dispose`，使私有服务可以在应用数据库关闭前停止轮询并释放本地状态。

## 构建边界

私有仓库负责扩展 bundle、企业测试、发布清单、签名输入和 Electron Builder 覆盖配置，并必须锁定准确的 Zhiyuan tag 与 commit。企业构建不能覆盖 `src/` 文件、不能在打包时修改公开应用源码，也不能依赖未版本化分支。

API v1 有意只开放生命周期和明确版本化的能力。Skill 收敛和管控事件操作必须继续作为独立能力加入，不能直接导入 Renderer 状态或应用私有内部模块。

### 会话能力 v1

API v1 上下文提供可选、独立版本化的 `capabilities.session` 对象。企业扩展可以注册一个密码会话 provider，并必须在退出时注销。社区构建保留相同的固定 Renderer 接口，但未注册 provider 时只返回 `UNAVAILABLE`。

Preload 桥只允许 `snapshot`、`login`、`changePassword` 和 `logout`。主进程会复制并校验有长度边界的输入字段、规范化身份快照、禁止返回任何 token，并在进入 Renderer 前将 provider 异常替换为通用错误。该桥不开放任意扩展方法或任意 IPC channel 名称。

### 外部模型能力 v1

可选的 `capabilities.models` 对象允许扩展注册使用保留 `external.*` 命名空间的 provider。Provider 提供有数量边界的模型列表、按所选模型解析连接，并可通知宿主列表已变化。v1 只支持 OpenAI-compatible 端点。模型进入 Renderer 或运行时前，宿主会校验 provider 身份、模型 ID 唯一性、模型元数据、HTTP(S) 端点和连接字段。

Renderer 只能取得模型元数据，base URL 和 API key 始终留在主进程。运行时会在模型首次使用前解析连接，并在后续每个对话回合刷新连接，使短期凭证轮换和授权撤销及时生效，同时不把秘密写入公开应用的配置或数据库。单个 provider 失败不会影响其他 provider，日志也不会包含 provider 抛出的异常内容。
