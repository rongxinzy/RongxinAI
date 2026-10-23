# 安全政策 / Security Policy

**知远智能体 (ZhiYuan Agent)** 欢迎负责任地披露可能影响用户安全的问题。请先阅读下文再报告；**请勿在 GitHub 公开 Issue 中讨论尚未修复的漏洞细节**。

We welcome responsible disclosure of security issues that may affect ZhiYuan Agent users. Please read this policy before reporting. **Do not discuss unfixed vulnerability details in public GitHub issues.**

---

## 如何报告 / How to report

请通过 **GitHub 私有漏洞报告（Private vulnerability reporting）** 私下提交，以便维护者在修复发布前保密处理：

Please report vulnerabilities **privately** using **GitHub Private vulnerability reporting** so maintainers can address them before public disclosure:

**https://github.com/rongxinzy/RongxinAI/security/advisories/new**

在报告中请尽量包含：受影响版本、平台（Windows / macOS / Linux）、复现步骤、影响说明（机密性 / 完整性 / 可用性）、以及 PoC 或日志（如适用）。若您有修复建议或 PR 思路，也欢迎一并说明。

Include, when possible: affected version(s), platform, steps to reproduce, impact (confidentiality / integrity / availability), and proof-of-concept or logs. Suggested fixes or PR ideas are welcome.

本仓库 **未** 在 CONTRIBUTING、README 或其他文档中公布专用安全邮箱；请以上述 GitHub 私有报告渠道为准。

This repository does **not** publish a dedicated security email in CONTRIBUTING, README, or other docs. Use the GitHub private reporting link above.

---

## 响应时间 / Response timeline

- 我们会在 **几个工作日内** 确认收到您的报告（通常 3 个工作日内）。
- 确认后会评估严重程度与影响范围，并在可行时与您同步修复计划与披露时间线。
- 严重问题会优先处理；修复经测试后会通过版本发布与（如适用）GitHub Security Advisory 披露。

We aim to **acknowledge** new reports within **a few business days** (typically within three). After triage we will assess severity and scope, coordinate a fix when possible, and disclose via a release and GitHub Security Advisory when appropriate.

---

## 范围 / Scope

### 范围内（In scope）

与 **本仓库发布的知远智能体桌面应用及其官方更新渠道** 直接相关的安全问题，例如：

Security issues in the **ZhiYuan Agent desktop application and its official update mechanisms** shipped from this repository, including:

- Electron 主进程、Preload 桥、渲染进程边界（context isolation、IPC 处理、权限审批流程）
- 应用内自动更新（签名验证、清单与下载完整性）
- 本地数据：SQLite 数据库、配置与密钥存储、工作区与 Artifacts 的访问控制
- 内置或打包的运行时与工具链：**llama.cpp 本地推理服务**、托管 Python 运行时、内置 Skills 的默认执行路径
- 应用内置或官方文档支持的 **消息渠道连接器**（微信、企业微信、钉钉、飞书等）在客户端侧的凭证与消息处理
- 依赖供应链中 **可被本应用发布流程引入** 的明显恶意或可被远程利用的缺陷（在维护者可控范围内）

### 范围外（Out of scope）

以下通常 **不在** 本政策范围内；请改用相应厂商或公开 Issue（功能缺陷、非安全问题）：

The following are generally **out of scope**:

- **第三方模型/API 提供商**（云端推理、BYOK 密钥在对方平台的泄露或滥用）
- **用户自行安装、配置或运行的 MCP 服务器、外部 Skills、自定义脚本** 导致的数据泄露或 RCE（除非能证明是知远默认配置下、无需用户额外危险操作即可利用的缺陷）
- **社会工程**、钓鱼、对最终用户设备的物理访问
- 仅影响开发环境、未随安装包发布的示例配置或文档中的虚构密钥
- 对官网、CDN 或 GitHub 组织设置的一般性扫描结果（无针对本应用可利用链时）
- 缺少安全加固建议、纯最佳实践咨询、或已有公开 CVE 且与本项目无关的上游问题（仍欢迎附带链接，便于跟踪）

---

## 安全更新 / Security updates

修复会随 **正式版本发布**（见 [GitHub Releases](https://github.com/rongxinzy/RongxinAI/releases) 与 [RELEASING.md](RELEASING.md)）提供。启用应用内更新时，请保持客户端为当前稳定或您选择的 beta 通道最新版本。

Security fixes ship in **application releases**. Keep the app updated via the in-app updater or by installing the latest release from GitHub or the official website.

---

## 感谢 / Recognition

我们感谢研究者的负责任披露。是否公开致谢取决于您的意愿与问题的性质；请在私有报告中说明是否希望匿名。

We appreciate responsible disclosure. Public credit is optional and depends on your preference; note in your private report if you wish to remain anonymous.
