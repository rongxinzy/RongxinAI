# 发布说明模板（维护者） / Release notes template (maintainers)

`release.yml` 在创建 GitHub **pre-release** 时会自动生成 PR 列表（`generate_release_notes: true`）。**面向用户的说明请以此模板为主**：在 GitHub Release 编辑器中把下方「用户版」粘贴到正文**顶部**，自动生成的 changelog 保留在**附录**即可。

Beta 用户：设置 → 关于 → Beta 更新通道。Stable 由 [RELEASING.md](../RELEASING.md) 中的 `promote.yml` 提升。

---

## 用户版（复制到 Release 正文顶部）— User-facing (paste at top)

```markdown
## 知远智能体 v<版本号> / ZhiYuan Agent v<version>

> 渠道：**beta** | **stable**（删去不适用项）  
> 完整安装包与校验信息见下方 Assets；也可从 [官网下载](https://www.rongxzyai.com/#download)。

### 亮点 / Highlights

- （用户能感知的新能力、体验改进，1–5 条，中文为主）
- (Optional 1–2 English bullets for international readers)

### 修复 / Fixes

- （重要 bug 修复；小修可合并为「其他稳定性与界面修复」）
- (Key bug fixes in English if needed)

### 破坏性变更 / Breaking changes

- （无则写：**无** / None）
- （若有：旧行为 → 新行为、用户需要做什么）

### 下载选包指南 / Which package to download

| 你的环境 | 推荐包 | 说明 |
| --- | --- | --- |
| **Windows x64**，不需要本地 GGUF 推理 | **lite** | 体积最小，不含 llama.cpp |
| **Windows x64**，要本地模型、无 NVIDIA 独显或不用 CUDA | **cpu** | 内置 llama.cpp（CPU + Vulkan） |
| **Windows x64**，NVIDIA 显卡（推荐 RTX 40 系列，CUDA 12.4） | **cuda** | GPU 加速 + CPU 回退；需匹配驱动 |
| **macOS Apple Silicon (arm64)** | **cpu** | Metal 加速的 llama.cpp |
| **macOS Intel (x64)** | **cpu** | 同上 |
| **Linux x64**，无 NVIDIA / 不用 CUDA | **cpu** | `.deb` 或 AppImage |
| **Linux x64**，NVIDIA + CUDA | **cuda** | `.deb` 或 AppImage；需 NVIDIA 驱动与 CUDA 运行库 |

**GitHub Assets 命名：** 当前流水线将文件发布为  
`<platform>-<arch>-<variant>-<原始安装包文件名>`  
例如 `win32-x64-lite-知远-Setup-<version>.exe`。  
历史 Release 中可能出现 `-.ZhiYuan.Agent.-` 等旧命名；**新发布以流水线产物为准**，无需改动历史附件。

**English quick pick:** Windows **lite** = no bundled llama.cpp; **cpu** = local GGUF without CUDA; **cuda** = NVIDIA GPU (CUDA 12.4, RTX 40-class build). macOS/Linux: **cpu** or **cuda** deb/AppImage as above.

---

<details>
<summary>附录：完整变更列表 / Appendix: full changelog</summary>

（保留 GitHub 自动生成的 **What's Changed** 或链接到 Compare：  
`https://github.com/rongxinzy/RongxinAI/compare/<上一tag>...v<version>`）

</details>
```

---

## 维护者检查清单 / Maintainer checklist

- [ ] 版本号与 tag `v<semver>` 一致（见 [RELEASING.md](../RELEASING.md)）
- [ ] 用户版已写亮点 / 修复 / 破坏性变更 / 选包指南
- [ ] Beta pre-release 提升 stable 前，在 Promote 后更新 Release 标题与「latest」说明
- [ ] 涉及安全修复时，同步 [SECURITY.md](../SECURITY.md) 流程与 GitHub Security Advisory（如适用）
