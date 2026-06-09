# GitLab Runner 运维指南

本文档覆盖 RongxinAI 项目 GitLab CI 的完整运维场景，包括安装、配置、镜像管理、缓存策略及故障排查。

---

## 一、架构概览

```
┌─────────────────────────────────────────────────────┐
│                   cicd 服务器                        │
│  ┌──────────────────────┐  ┌──────────────────────┐ │
│  │ GitLab CE (Docker)   │  │ GitLab Runner (Docker)│ │
│  │ 8180:80, 8122:22     │  │ --network host       │ │
│  │                      │  │ volumes:             │ │
│  │ gitlab/gitlab-ce     │  │  /opt/ci-cache       │ │
│  │                      │  │  /var/run/docker.sock│ │
│  └──────────────────────┘  └──────────────────────┘ │
│                                                      │
│  宿主机卷: /opt/ci-cache/node_modules (rw)           │
│  本地镜像: rongxinai-ci:latest                       │
│  预加载镜像: gitlab-runner-helper:x86_64-v19.0.1     │
└─────────────────────────────────────────────────────┘
```

**关键设计**：
- GitLab 与 Runner **同机部署**，Runner 使用 `network_mode = "host"` 直接访问 `127.0.0.1:8180`
- Runner 以 **Docker executor** + `network_mode = "host"` 运行，每个 job 容器共享宿主机网络
- CI 镜像在服务器**本地构建**（`pull_policy: if-not-present`），不推送 registry
- node_modules 通过**宿主机读写卷**挂载，lint job 自动维护缓存
- **Helper 镜像**需预加载（内网无法访问 `registry.gitlab.com`）

---

## 二、Runner 部署

### 2.1 前置条件

- 服务器已安装 Docker
- GitLab 已部署并可通过 `127.0.0.1:8180` 访问
- 本地已加载 `rongxinai-ci:latest` CI 镜像（见第三章）
- 本地已加载 gitlab-runner-helper 镜像（见 2.2）

### 2.2 预加载 Helper 镜像

内网环境无法访问 `registry.gitlab.com`。需从有网机器导出并导入：

```bash
# 有网机器上
docker pull registry.gitlab.com/gitlab-org/gitlab-runner/gitlab-runner-helper:x86_64-v19.0.1
docker save registry.gitlab.com/gitlab-org/gitlab-runner/gitlab-runner-helper:x86_64-v19.0.1 -o helper.tar
scp helper.tar sysadm@cicd:~/docker-images/

# cicd 服务器上
docker load -i ~/docker-images/helper.tar
```

### 2.3 创建 Runner（API 方式）

因 Docker bridge 网络下验证会超时，推荐用 API 直接创建 runner 再注册：

```bash
# 1. 用 Personal Access Token 通过 API 创建 runner
#    （在 GitLab → Settings → Access Tokens 创建，勾选 api 权限）
curl -s -X POST "http://127.0.0.1:8180/api/v4/user/runners" \
  -H "PRIVATE-TOKEN: <personal_access_token>" \
  -H "Content-Type: application/json" \
  -d '{"runner_type":"project_type","project_id":1,"description":"docker-runner-02","run_untagged":true,"locked":true}'

# 返回示例：{"id":3,"token":"glrt-xxxx","token_expires_at":null}

# 2. 启动 Runner 容器（必须 --network host）
docker run -d --name gitlab-runner-02 \
  --restart always \
  --network host \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v /opt/ci-cache:/opt/ci-cache \
  gitlab/gitlab-runner:latest

# 3. 用 API 返回的 token 注册（注意 --network host 下用 127.0.0.1:8180）
docker exec -it gitlab-runner-02 gitlab-runner register \
  --non-interactive \
  --url "http://127.0.0.1:8180" \
  --token "glrt-<API返回的token>" \
  --executor "docker" \
  --docker-image "rongxinai-ci:latest" \
  --docker-pull-policy "if-not-present" \
  --clone-url "http://127.0.0.1:8180"
```

### 2.4 补充配置

注册后需手动添加 `network_mode` 和 volumes：

```bash
# 添加 host 网络模式
docker exec -it gitlab-runner-02 sh -c "sed -i '/\[runners.docker\]/a \ \ \ \ network_mode = \"host\"' /etc/gitlab-runner/config.toml"

# 添加缓存卷挂载
docker exec -it gitlab-runner-02 sh -c "sed -i 's|volumes = \[\"\/cache\"\]|volumes = [\"\/opt\/ci-cache:\/opt\/ci-cache\", \"\/cache\"]|' /etc/gitlab-runner/config.toml"

docker restart gitlab-runner-02
```

### 2.5 最终配置文件（`/etc/gitlab-runner/config.toml`）

```toml
concurrent = 8
check_interval = 0
shutdown_timeout = 0

[session_server]
  session_timeout = 1800

[[runners]]
  name = "cicd"
  url = "http://127.0.0.1:8180"
  id = 3
  token = "glrt-<TOKEN>"
  executor = "docker"
  clone_url = "http://127.0.0.1:8180"
  [runners.cache]
    MaxUploadedArchiveSize = 0
  [runners.docker]
    tls_verify = false
    image = "rongxinai-ci:latest"
    privileged = false
    disable_entrypoint_overwrite = false
    oom_kill_disable = false
    disable_cache = false
    volumes = ["/opt/ci-cache:/opt/ci-cache", "/cache"]
    pull_policy = ["if-not-present"]
    network_mode = "host"
    shm_size = 0
```

**参数说明**：

| 参数 | 值 | 说明 |
|------|-----|------|
| `concurrent` | 8 | 最多同时执行 8 个 job |
| `executor` | docker | 每个 job 在独立容器中运行 |
| `pull_policy` | if-not-present | 优先使用本地镜像 |
| `network_mode` | host | **关键**：容器共享宿主机网络，才能访问 127.0.0.1:8180 的 GitLab |
| `volumes` | `/opt/ci-cache:/opt/ci-cache` | **读写挂载**，lint job 写回缓存 |
| `clone_url` | `http://127.0.0.1:8180` | 同机部署必须用 127.0.0.1，不能用外网 IP |
| `privileged` | false | 安全策略：不启用特权模式 |

### 2.6 注意事项

- **`--network host` 是必须的**：Docker executor 起的 job 容器默认在 bridge 网络，无法访问宿主机的 GitLab。host 模式下 job 可以直接 `git clone http://127.0.0.1:8180/...`
- **Helper 镜像必须预加载**：每个 job 启动时会尝试拉取 `registry.gitlab.com/gitlab-org/gitlab-runner/gitlab-runner-helper`，内网不通会导致卡死
- **Token 不要外泄**：config.toml 中的 `token` 是 runner 认证凭证

### 2.7 管理 Runner

```bash
# 查看运行日志
docker logs -f gitlab-runner-02

# 查看配置
docker exec -it gitlab-runner-02 cat /etc/gitlab-runner/config.toml

# 重启
docker restart gitlab-runner-02

# 完全重建
docker stop gitlab-runner-02 && docker rm gitlab-runner-02
# 然后按 2.3-2.4 节重新创建
```

---

## 三、CI Docker 镜像

### 3.1 镜像规格

| 字段 | 值 |
|------|-----|
| 镜像名 | `rongxinai-ci:latest` |
| 基础系统 | Ubuntu 24.04 |
| GCC 版本 | 14.x |
| Node.js | 24.x（NodeSource） |
| 预装包 | build-essential, python3, git, curl, Electron 运行时依赖 |

### 3.2 Dockerfile

文件位置：开发机 `docker/ci/Dockerfile`（Git 仓库 `.gitignore` 排除）

```dockerfile
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive TZ=Asia/Shanghai

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl wget git ca-certificates \
    build-essential python3 \
    libgtk-3-0 libnotify4 libnss3 libxss1 libxtst6 \
    xdg-utils libatspi2.0-0 libuuid1 libsecret-1-0 \
    dpkg-dev fakeroot libfuse2 \
    jq xz-utils \
    && curl -fsSL https://deb.nodesource.com/setup_24.x | bash - \
    && apt-get install -y nodejs \
    && npm install -g npm@latest \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/* /root/.cache

ENV PATH="/builds/node_modules/.bin:${PATH}"
WORKDIR /builds
```

### 3.3 构建镜像

在 **Runner 服务器**上执行：

```bash
# 首次构建
mkdir -p ~/docker-images/rongxinai-ci
vi ~/docker-images/rongxinai-ci/Dockerfile    # 粘贴上方内容
cd ~/docker-images/rongxinai-ci
sudo docker build -t rongxinai-ci:latest .

# 更新镜像（修改 Dockerfile 后）
sudo docker build -t rongxinai-ci:latest .

# 清理旧版本（确认新镜像可用后）
sudo docker image prune -f
```

### 3.4 镜像跨服务器迁移

```
场景：A 服务器已有镜像，B 服务器也有 Runner，需要同步镜像。
```

**方法一：导出导入**

```bash
# A 服务器导出
sudo docker save rongxinai-ci:latest | gzip > rongxinai-ci.tar.gz
scp rongxinai-ci.tar.gz user@B-server:/tmp/

# B 服务器导入
sudo docker load < /tmp/rongxinai-ci.tar.gz
rm /tmp/rongxinai-ci.tar.gz
```

**方法二：推送私有 Registry**

如果多台服务器需要统一镜像，可以部署 GitLab Container Registry 或 Harbor，通过 `docker push/pull` 分发。

### 3.5 同步其他服务器 Runner 配置

```bash
# 复制 config.toml 到新服务器（注意修改机器名）
scp /etc/gitlab-runner/config.toml user@new-server:/tmp/
# 在 new-server 上
sudo cp /tmp/config.toml /etc/gitlab-runner/
sudo gitlab-runner restart
```

---

## 四、node_modules 缓存卷

### 4.1 设计原则

- 采用**宿主机卷挂载**方式，维护一份预装好的 node_modules
- 卷以**读写**方式挂载到 `/opt/ci-cache`
- CI job 通过 `cp -r /opt/ci-cache/node_modules node_modules` 恢复缓存
- **只有 lint job 执行 `npm install`**（保证单一写入者，无并发冲突）
- **lint job 执行完后写回缓存**（`cp -r node_modules /opt/ci-cache/node_modules`）
- 其余 build/test job 仅读取缓存，不执行 `npm install`

### 4.2 首次预装缓存卷

```bash
cd /tmp && git clone http://127.0.0.1:8180/rxzy-opensource/RongxinAI.git
cd RongxinAI
npm install
sudo rm -rf /opt/ci-cache/node_modules
sudo cp -r node_modules /opt/ci-cache/node_modules
cd /tmp && rm -rf RongxinAI
```

> 注意：如果 clone 默认 main 分支，需按实际目标分支 checkout 后再 `npm install`。

### 4.3 缓存自动维护（CI 内）

lint job 的 `.gitlab-ci.yml` 末尾：

```yaml
lint:
  script:
    - # ... lint 逻辑 ...
    - cp -r node_modules /opt/ci-cache/node_modules 2>/dev/null || true
```

**效果**：每次 `package-lock.json` 变更后，lint job 跑完自动更新缓存，无需手动干预。

### 4.4 缓存策略说明

| 组件 | 策略 | 说明 |
|------|------|------|
| lint job | `cp` 恢复 → `npm install` 校验 → `cp` 写回 | 唯一写入者，保证无并发冲突 |
| build-* / test jobs | 仅 `cp` 恢复缓存 | 信任 lint 已维护好完整 node_modules |
| 首次部署 | 手动 `npm install` + `cp` 预热 | 此后 CI 自动维护 |

```
Pipeline 时间线：
  lint:     [cp 缓存 1.5s][npm install 5s][eslint 30s][cp 写回 1.5s]  ≈ 2 min
  build:    [cp 缓存 1.5s] [tsc/vite 1-3min]                            ≈ 3-5 min（并行）
  test:     [cp 缓存 1.5s] [vitest 3s]                                   ≈ 2 min

  首次无缓存：lint 需完整 npm install（~2 min），自动填充缓存
```

---

## 五、CI/CD 配置文件（`.gitlab-ci.yml`）

### 5.1 关键设计决策

| 决策 | 原因 |
|------|------|
| `changes` + 分支 `if` 双重规则 | MR 始终全量构建；push 仅变更文件触发；主干分支始终全量 |
| lint 独跑 `npm install` + 写回 | 只有 lint 阶段单 job 运行，无并发写冲突 |
| build/test 不跑 `npm install` | 信任 lint 维护的缓存，加快构建速度 |
| `build-renderer` 独立内存 8GB | Vite 处理 5000+ 模块需要大内存 |
| `ELECTRON_SKIP_BINARY_DOWNLOAD=1` | CI 仅需类型定义，无需 electron 二进制 |
| `GIT_DEPTH: 0`（仅 lint） | MR diff 需要完整 git 历史 |

### 5.2 缓存流程

```
lint job:
  before_script: cp /opt/ci-cache/node_modules → node_modules
                 npm install --prefer-offline  （校验 + 补装缺包）
  script:         eslint ...
  after_script:   cp node_modules → /opt/ci-cache/node_modules  （写回）

build-* / test jobs:
  before_script: cp /opt/ci-cache/node_modules → node_modules   （纯读取）
  script:         npm run build / npx tsc / npm test
```

### 5.3 关键 ENV 变量

| 变量 | 值 | 说明 |
|------|-----|------|
| `ELECTRON_SKIP_BINARY_DOWNLOAD` | 1 | 跳过 electron 二进制下载（CI 仅需类型定义） |
| `NODE_OPTIONS` | `--max-old-space-size=8192` | 仅 build-renderer：Vite 需要大内存 |

---

## 六、项目端配置

### 6.1 Vitest 配置（`vitest.config.ts`）

```ts
import path from 'node:path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, './src/shared'),
      '@': path.resolve(__dirname, './src/renderer'),
      electron: path.resolve(__dirname, './tests/__mocks__/electron.ts'),
    },
  },
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
```

**说明**：
- `electron` alias 指向 mock，解决 CI 无 electron 二进制的问题
- `testTimeout` 设为 30s，防止大组件 import 超时

### 6.2 Electron Mock（`tests/__mocks__/electron.ts`）

为 CI 环境中所有 electron API 提供 mock 实现，覆盖 app、BrowserWindow、ipcMain、ipcRenderer、dialog、shell、Menu、Tray、nativeImage、nativeTheme、net、powerMonitor、screen、session 等。

---

## 七、完整部署 Checklist

### 新 Runner 服务器上线

- [ ] 安装 Docker
- [ ] 预加载 CI 镜像：`docker build -t rongxinai-ci:latest .`
- [ ] 预加载 Helper 镜像（见 2.2 节）
- [ ] 创建 `/opt/ci-cache` 目录：`sudo mkdir -p /opt/ci-cache && sudo chmod 777 /opt/ci-cache`
- [ ] 通过 GitLab API 创建 runner（见 2.3 节）
- [ ] 启动 Runner 容器（`--network host`，挂载 volumes）
- [ ] 注册 runner（见 2.3 节）
- [ ] 补充配置（`network_mode = "host"`、volumes）
- [ ] 预热 node_modules 缓存（见 4.2 节）
- [ ] `docker logs -f gitlab-runner-02` 确认连接
- [ ] GitLab UI 确认 runner 在线（绿灯）
- [ ] 触发测试 pipeline 验证

### Runner 迁移（从旧服务器到新服务器）

- [ ] 在新服务器上完成上述"新 Runner 上线"Checklist
- [ ] 在 GitLab Settings → CI/CD → Runners 暂停旧 runner
- [ ] 验证新 runner 上 pipeline 全部通过
- [ ] 等旧 runner 无活跃 job 后注销/删除旧 runner

### CI 镜像更新

- [ ] 修改 `~/docker-images/rongxinai-ci/Dockerfile`
- [ ] `docker build -t rongxinai-ci:latest .`
- [ ] `docker run --rm rongxinai-ci:latest node --version`（验证）
- [ ] 触发测试 pipeline 验证

### node_modules 缓存更新（手动）

- [ ] `cd /tmp && git clone http://127.0.0.1:8180/rxzy-opensource/RongxinAI.git`
- [ ] `cd RongxinAI && npm install`
- [ ] `sudo rm -rf /opt/ci-cache/node_modules && sudo cp -r node_modules /opt/ci-cache/node_modules`
- [ ] 触发测试 pipeline 验证

> 通常情况下 lint job 会自动维护缓存，无需手动操作。仅在缓存损坏或 `node_modules/.bin` 缺失时需要。

---

## 八、故障排查

### 8.1 clone 失败：`port 80: Could not connect`

**原因**：Docker executor 起的 job 容器在 bridge 网络，访问不了宿主机端口。

**解决**：
1. 确认 Runner 使用 `--network host` 启动
2. 确认 `config.toml` 中 `network_mode = "host"`
3. 确认 `clone_url` 使用 `http://127.0.0.1:8180`（同机部署）

### 8.2 Helper 镜像无法拉取

```
Pulling docker image registry.gitlab.com/.../gitlab-runner-helper:x86_64-v19.0.1 ...
# 卡住不动
```

**原因**：内网服务器无法访问 `registry.gitlab.com`。

**解决**：从有网机器导出导入（见 2.2 节）。每次升级 gitlab-runner 版本后需重新预加载对应版本的 helper 镜像。

### 8.3 `tsc: not found` 或 build job 缺依赖

**原因**：`/opt/ci-cache/node_modules` 为空或不完整。

**解决**：手动预热缓存（见 4.2 节），确保 `npm install` 用的是目标分支的 `package.json`。

### 8.4 `npm install` 报 `Permission denied`

**原因**：`/opt/ci-cache` 目录权限不足。

**解决**：`sudo chmod 777 /opt/ci-cache`。

### 8.5 同时运行的 job 内存不足导致 OOM

**原因**：`NODE_OPTIONS: --max-old-space-size=4096` × 8 concurrent job = 32 GB+

**解决**：
- `concurrent` 与内存匹配，仅 build-renderer 设置 8GB，其余 job 使用 Node 默认值
- `ELECTRON_SKIP_BINARY_DOWNLOAD=1` 减少安装开销

### 8.6 test 阶段 electron 报错

**原因**：CI 环境无 electron 二进制。

**解决**：`vitest.config.ts` 中配置 electron mock alias。

### 8.7 npm install 时间过长

**检查清单**：
1. 缓存卷是否挂载成功：`docker exec gitlab-runner-02 grep volumes /etc/gitlab-runner/config.toml`
2. 缓存是否完整：`ls /opt/ci-cache/node_modules | wc -l`（预期 > 1500 个包）
3. `.gitlab-ci.yml` 的 default `before_script` 是否包含 `cp -r`
4. 镜像是否使用 `if-not-present`

### 8.8 Pipeline 一直 pending

**检查清单**：
1. Runner 是否在线：`docker logs gitlab-runner-02 | tail -5`
2. Runner 是否被暂停：`curl -s "http://127.0.0.1:8180/api/v4/runners/3" -H "PRIVATE-TOKEN: <token>"`
3. 是否有更早的 pending job 阻塞了队列

---

## 九、附录

### 9.1 查看 GitLab 状态

```bash
docker ps | grep gitlab
curl -s http://127.0.0.1:8180/api/v4/projects/1/runners -H "PRIVATE-TOKEN: <token>"
```

### 9.2 查看当前 Runner 配置

```bash
docker exec -it gitlab-runner-02 cat /etc/gitlab-runner/config.toml
```

### 9.3 Docker 镜像管理

```bash
docker images | grep -E "rongxinai-ci|gitlab-runner-helper"
docker image prune -f
docker system df
```

### 9.4 项目端关键文件

| 文件 | 用途 |
|------|------|
| `.gitlab-ci.yml` | CI 流水线定义 |
| `vitest.config.ts` | 测试配置（含 electron mock alias） |
| `tests/__mocks__/electron.ts` | electron API mock |
| `electron-tsconfig.json` | Electron 主进程 TypeScript 配置 |

### 9.5 服务端关键路径

| 路径 | 用途 |
|---|---|
| `/opt/ci-cache/node_modules/` | node_modules 缓存卷（宿主机） |
| `rongxinai-ci:latest` | CI 构建环境镜像（本地） |
| `gitlab-runner-helper:x86_64-v19.0.1` | Runner helper 镜像（预加载） |
