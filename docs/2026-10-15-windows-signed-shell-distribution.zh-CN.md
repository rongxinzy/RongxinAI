# Windows 安装器与自动更新交付契约

## 构建产物

社区版 `bun run dist:win:offline` / `bun run dist:win:signed` 都先构建完整应用和全部七个离线组件，再输出两份不同用途的可执行文件：

- `release/ZhiYuanAgent-Setup-${version}.exe`：用户下载的 WebView2 单文件安装器。
- 原有 `${productName}-Setup-${version}.exe`：electron-updater 使用的 NSIS 更新器。其文件名、`latest.yml`、`.blockmap` 及自动更新协议保持一致。

发布候选清单分别将两者标为 `installer` 和 `updater`。不能把 WebView2 安装器填入 NSIS 更新元数据，也不能因安装壳变更裁剪 channel-runtime、skills、mcps、portable-git、python、skill-python 或 uv。

安装壳构建需要 .NET 8 SDK，支持 PATH 中的 `dotnet`、本地 `.cache/dotnet/dotnet.exe` 或 `ZHIYUAN_DOTNET` 指定路径。自包含单文件启用压缩，不要求终端用户安装 .NET。WebView2 缺失时仍必须由安装器明确提示；不以不明下载或静默失败替代。

## Certum 签名顺序

正式发布继续使用受保护的 `release` 环境、现有 `setup-certum-signing` action 和同一 Certum 证书：

1. electron-builder 签名应用、原生 NSIS 卸载器与 NSIS 更新器，`forceCodeSigning` 阻止无证书降级。
2. 通过官方 NSIS `!finalize` 编译钩子，在最终 NSIS 安装器生成后、electron-builder 删除中间卸载器前，将已经签名的卸载器原样保留为 `out/ZhiYuanUninstall.exe`。第一次 `BUILD_UNINSTALLER` 编译先清除旧副本；钩子失败必须中止构建。
3. 同时记录 `kind=nsis-uninstall-host`、实际 checkout commit、version、原中间文件名、安装后的原生文件名、bytes、sourceSha256 与 sha256。只接受当前配置推导的精确 `UNINSTALLER_OUT_FILE`，不用 glob 选旧文件；复制前后 SHA-256 必须相等。两次打包入口再次验证这个记录。
4. 发布压缩的未签名 .NET 安装壳，将原生卸载器作为 `uninstall.exe` 放入 ZIP payload，不再复制第二套 .NET 运行时，也不重新签名卸载器。VC++ redistributable 只保留应用 `resources` 中的原文件，解包应用后执行它。
5. 使用现有 `scripts/runtime-signing/sign-runtime.ps1` 与相同 Certum 签名最终 SFX，验证签名，再生成记录最终字节 SHA-256 的 manifest。

安装时复制 payload 中的原生卸载器，并使用 NSIS 的 `Uninstall ${productName}.exe` 文件名。首装仍使用 WebView2 界面；卸载复用原生 NSIS 界面，静默命令使用 `/S`，默认保留用户数据。不能裁掉已签名 SFX 的尾部来恢复宿主，也不能采用自定义差分重建签名字节。流水线不创建新凭据、不改变环境权限，也不绕过已有签名或发布门禁。

钩子依据：[NSIS !finalize](https://nsis.sourceforge.io/Docs/Chapter5.html#finalize)。本仓锁定的 electron-builder 26.16.1 在 `computeScriptAndSignUninstaller` 中先完成卸载器签名，再执行最终 `executeMakensis`，随后才删除中间卸载器。升级 electron-builder 时必须重新核实此顺序。

## ZYP2 容器

布局为 `[未签名 x64 PE 宿主][payload.zip][0–7 字节零填充][24 字节尾记录][可选证书表]`。

尾记录以小端序保存：偏移 0 为 ZIP 绝对位置（uint64），偏移 8 为 ZIP 长度（uint64），偏移 16 为尾记录长度 24（uint32），偏移 20 为 ASCII `ZYP2`。填充使签名前文件末端为 8 字节对齐。

签名后尾记录不在文件末端。读取器通过 PE optional header 的 Security Directory（索引 4）获得证书表文件偏移，以证书表起点作为尾记录末端；无签名时使用文件末端。不扫描证书数据寻找魔术字。证书表必须边界合法、8 字节对齐并终止于 EOF，ZIP 位置、长度、填充与头标识都需校验。

格式依据：[Microsoft PE Format](https://learn.microsoft.com/en-us/windows/win32/debug/pe-format#the-attribute-certificate-table-image-only)。容器检查只能确认签名数据的位置与结构，不能替代 Windows Authenticode 信任链、指定证书与时间戳验证。

## 验收与发布

daily、手动 candidate、tag 发布和手动平台构建都对最终安装器运行真实 WebView2 交互验收与 evidence 检查。证据绑定安装器最终 SHA-256、实际构建 source commit、CI run，以及安装后的应用字节；正式流水线先签名再验收。候选发布/上传必须位于此门之后。

正式 daily、candidate、tag 发布另运行 WebView2 安装后原生 NSIS 卸载验收，核对卸载器哈希、Certum 证书、时间戳、注册命令，以及应用/注册表移除和用户数据保留。签名有效性必须在 Windows 上检查，文件哈希与容器结构检查不能替代它。

静态 SFX 测试覆盖附加证书后的定位、八种填充、伪造尾记录、异常证书目录、越界长度及签后 manifest 更新。它们使用合成证书结构，不声称证明真实签名有效。实际 Windows GUI、Certum 签名、安装启动与最终包大小需要 Windows CI 验证。

## 按产物用途独立控制体积

经 Windows 真实构建确认并批准，新 WebView2 安装器使用独立上限：最终完整文件 500 MiB、非组件部分 220 MiB。旧 NSIS 更新器仍为 450 MiB / 150 MiB；七组件合计上限仍为 300 MiB。非组件部分统一定义为最终安装器字节数减去七组件归档的真实字节合计，不通过扩大组件申报值挪用预算。

提交 `02b8a66` 的 Windows PR 构建实测（尚未加入正式 Certum 签名）：

- WebView2 安装器：491,244,872 字节（468.49 MiB），其中非组件 202,618,210 字节（193.23 MiB）。
- NSIS 更新器：439,171,500 字节（418.83 MiB），其中非组件 150,544,838 字节（143.57 MiB）。
- 相同七组件归档合计：288,626,662 字节；压缩的自包含 .NET 外壳为 72,154,001 字节（68.81 MiB）。两种完整安装器净差 49.66 MiB，主要来自无需用户另装 .NET 的自包含壳；应用归档压缩布局不同抵消了部分外壳成本。

打包前禁止把已内置于应用的 VC++ redistributable 再复制到 payload 根目录，也禁止以第二份 .NET 壳替代原生 NSIS 卸载器或新增重复根文件。正式构建在签名后再次读取最终 SFX 文件大小，并对七组件逐项核对实际归档大小与 SHA-256，再执行 500 / 220 / 300 MiB 门禁；签名证书与时间戳新增的字节同样计入上限。预算检查不替代既有 Authenticode 验证。
