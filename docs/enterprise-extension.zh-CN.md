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

API v1 有意只开放生命周期和非敏感宿主上下文。认证 IPC、托管模型投影、Skill 收敛和管控事件操作必须作为明确的版本化能力逐步加入，不能直接导入 Renderer 状态或应用私有内部模块。
