# OneMail Next 版本记录 / Release notes

## v26.1026.2232（2026-10-26）

完整累计更新说明：[v26.1026.2232](./docs/releases/v26.1026.2232.md)。升级基线为 `v26.1026.1352`，包含 `ad4dd58` 的同步范围与缓存改进，以及本次提交的安全、一致性和更新流程修复。

### 中文

- 新增“邮件同步范围”：元信息默认 30 天、全文默认 7 天、本地缓存保留默认 0 天；支持附件随正文缓存或单独下载，IMAP / POP3 按日期和缓存完整性补齐。
- 新增启动时及每 24 小时的本地过期缓存清理，支持手动清理和可选元信息清理；保护近期访问、看板关联和仍被任务使用的邮件，不影响服务器邮件或用户另存的附件。
- 修复数据库恢复与在途任务交叉写入，恢复后重建邮箱监听和提醒；加强 IPC 来源及附件文件授权，SQL 恢复禁止 `VACUUM` 文件副作用。
- 修复 MOVE 后目标文件夹和 UID 维护、普通同步漏标记远端缺失，以及旧同步结果覆盖新已读、移动或永久删除状态。
- 区分 SMTP 明确失败与投递结果未知；未知结果不允许直接重发。账号及文件夹配置原子提交，新邮件规则在邮件入库事务内登记，移除 1000 封登记上限。
- 检查更新不再自动下载，发现新版后切换为“下载更新”；显示进度、大小和速度，支持失败重试，移除独立 GitHub 查询对真实更新检查失败状态的覆盖。
- 升级包含数据库与同步设置迁移。旧失败发送记录会保守标记为投递结果未知，请先核对送达情况；建议升级前备份。
- 本地通过 67 个测试文件、386 项测试、类型检查、生产构建及改动文件 ESLint；浏览器验证覆盖更新流程。全仓既有 lint 问题、真实邮箱故障交错和各平台安装后人工验收不在本次验证结论内。

### English

Cumulative update from `v26.1026.1352`, including sync/cache changes in `ad4dd58` and the reliability, security, and update-workflow fixes in this release commit.

- Added independent metadata, body, and retention ranges, per-message attachment download policy, and date/cache-based IMAP and POP3 backfill.
- Added local-only retention cleanup with protections for recent access, board-linked mail, and in-use messages; server mail and separately saved files are untouched.
- Isolated backup restore from in-flight tasks, rebuilt watchers/reminders after restore, enforced trusted IPC frames and attachment selection authorization, and blocked `VACUUM` during SQL import.
- Fixed MOVE identity tracking, routine remote-missing detection, and stale synchronization results overwriting newer local state.
- Distinguished uncertain SMTP delivery from definite rejection, blocked unsafe retries, made account/folder updates atomic, and registered new-mail rules transactionally without the 1,000-message limit.
- Separated update checks from explicit downloads, added progress/size/speed and retry controls, and removed the GitHub-release lookup that could mask updater failures.
- Database/settings migration is automatic. Previously failed sends are conservatively marked delivery-uncertain; verify delivery before resending and back up before upgrading.
- Passed 386 local tests in 67 files, type checks, production build, changed-file ESLint, and isolated browser checks. Existing repository lint issues, live-mailbox failure interleavings, and installed-package smoke tests remain outside this verification.

---

## v26.1026.1352（2026-10-26）

完整补丁与版本说明：[v26.1026.1352](./docs/releases/v26.1026.1352.md)。升级基线为 `v26.1024.1715`，应用版本为 `26.1026.1352`。

### 中文

- 修复邮箱、草稿箱和发送队列切换时侧边栏宽度跳变，共享外层账号栏布局。
- 修复添加账号时服务商下拉框的滚动与定位冲突；窗口默认调整为 520 × 680，支持缩放。
- 主题和正文均为空白时不保存草稿，仅填写收件人也不保存；附件和内嵌图片仍视为有效内容。
- 确认远端原位置不存在后保留可见的本地副本，允许本地已读更新和阅读缓存内容，停止无效远端写回；未缓存内容明确提示不可获取。
- 将邮件批量操作栏固定在列表面板底部，始终预留 48px，避免选择操作引起列表跳动。
- 修复翻译按钮覆盖设置、写信及弹层；添加 POP 协议的服务器保留原件提示。
- 升级自动增加远端缺失标记和已读状态修订号，恢复此前因全量同步隐藏的本地副本，保留用户主动删除状态；建议升级前备份。
- Release 工作流按标签检出代码、核对应用版本，并使用对应独立说明文件作为发布正文。
- 本地通过 58 个测试文件、271 个用例、类型检查、生产构建和浏览器交互验证；暂存区 TS/TSX 无 ESLint 错误。既有全仓库 lint 错误、真实 IMAP 延迟交错及各平台安装包人工验收仍未解决或完成。

### English

Patch release following `v26.1024.1715`, with application version `26.1026.1352`.

- Shared sidebar sizing across mail, drafts, and outbox; fixed provider-menu scrolling and made the add-account window larger and resizable.
- Skip whitespace-only drafts, including recipient-only drafts, while retaining attachments and inline images as meaningful content.
- Preserve visible local copies when the original remote location is confirmed missing, allow local read-state updates and cached content access, and stop obsolete remote writebacks. Uncached content remains unavailable.
- Keep the selection toolbar in a reserved 48px footer; correct translation-button layering and add the POP server-retention warning.
- Automatically migrate remote-missing/read-revision fields and recover copies hidden by earlier full synchronization without undoing deliberate local deletions. Back up before upgrading.
- Release builds check out and validate the selected version tag and use its standalone notes.
- Local verification passed 271 tests in 58 files, type checks, production build, browser interaction checks, and error-level ESLint for staged TS/TSX files. Existing repository lint errors, live-server timing validation, and installed-package smoke tests remain outside this verification.

---

## v26.1024.1715（2026-10-24）

完整累计更新说明：[v26.730.1039 至 v26.1024.1715](./docs/releases/v26.1024.1715.md)。GitHub Release 正文使用这份独立说明，不包含下方历史开发记录。

本次正式版本合并 2026-10-23 和 2026-10-24 尚未发布的改动，升级基线为 `v26.730.1039`。发布标签为 `v26.1024.1715`，应用版本为 `26.1024.1715`。下方开发记录用于保留逐次变更和当时的验证状态，其中“未生成安装包”等描述指对应的历史提交，不代表本次发布状态。

### 中文

#### 主要更新

- **联系人管理**：支持多地址、备注、星标、vCard 导入导出；从邮件地址悬浮卡快速添加联系人；新增多分组、关键词与分组组合筛选、按组添加收件人，以及复选框批量删除。
- **邮件看板**：从邮件创建事项，管理状态、备注和提醒；支持多选后批量拖拽到其他分栏、右键编辑信息和提醒时间。看板提醒独立于全局新邮件通知开关。
- **草稿箱与发送队列**：改为主区域列表，统一展示各账号本地草稿，保留发件账号；支持搜索、账号筛选、分页和批量删除，修复草稿箱反复刷新卡顿。发送队列支持清除全部已发送或失败的本地记录，不影响远端邮件、草稿及排队或发送中的项目。
- **布局与窗口**：设置改为全窗口侧边导航；侧边栏依次显示草稿箱、发送队列、全部邮箱；修复联系人与看板独立窗口的拖动和窗口按钮重叠。
- **通知与隐私**：新增账号级新邮件通知、批量开关及新账号默认值；远程内容支持严格、宽松、不限制模式、账号覆盖及可信发件人。
- **规则与操作记录**：支持按邮件条件执行已读、加入看板、移入已删除等规则；增加持久化远端写回记录及状态面板。
- **备份与构建**：本地、WebDAV 和 S3 备份可选择是否包含邮件；恢复后重新应用相关设置；新增 Windows PowerShell 打包脚本并收紧应用打包范围。
- **Outlook 图标**：改用内置图标，修复账号左侧破图；该修复不改变认证和同步逻辑。

#### 升级注意事项

- 恢复备份会替换本地数据库，不执行合并。仅设置备份恢复后需要重新同步邮件；SQL 备份不包含磁盘附件文件。备份含敏感凭据材料，请妥善保存，详见[备份范围](./docs/backup-coverage.md)。
- 远端永久删除要求 UID 定向删除，当前 IMAP 实现尚未提供相应能力，因此会拒绝该操作；恢复及规则移动要求服务器支持 `MOVE`。
- Gmail / Outlook 重连、OAuth 刷新以及完整代理覆盖仍待处理。邮件远程图片、背景、允许加载的跟踪资源及 OAuth 请求尚未统一走账号代理；现有隐私拦截策略保持不变。
- 宽松隐私模式不能保证拦截所有跟踪资源；部分新增界面的英文覆盖尚不完整。

#### 验证与下载

- 功能提交已通过 Windows / Linux CI；本地 56 个测试文件、237 个用例、类型检查和生产构建通过。未宣称全仓库 ESLint 通过。
- 标签发布工作流构建 Windows 安装程序、macOS DMG/ZIP 和 Linux AppImage/DEB，各包含 x64 与 ARM64。安装包可用性以本标签 Release 附件和 Release 工作流结果为准；尚未进行各平台安装后的人工验收。

### English

This release combines the previously unreleased changes from October 23 and 24, 2026, following `v26.730.1039`. The application version is `26.1024.1715`. Development entries below retain their historical verification and packaging status.

- Added contact management, address hover-card creation, multiple groups per contact, combined search/group filtering, group recipients, and bulk deletion.
- Added mail tasks and reminders, multi-task board dragging, and context-menu editing. Board reminders are independent of new-mail notification settings.
- Moved unified local drafts and the sending queue into the main workspace, with draft search/filtering/pagination/bulk deletion and sent/failed queue cleanup. Fixed repeated draft refreshes and standalone-window dragging/control overlap.
- Added full-window settings, per-account mail notifications, remote-content privacy policies and trusted senders, mail rules, and persistent remote-writeback records.
- Added optional mail inclusion for local/WebDAV/S3 backups and Windows packaging scripts; bundled the Outlook provider icon locally.
- Backup restores replace the database, and SQL backups exclude attachment files on disk. IMAP permanent deletion is currently rejected because UID-scoped expunge is unavailable; restore/rule moves require server `MOVE` support.
- Gmail/Outlook reconnection, OAuth refresh, and full account-proxy coverage remain unresolved. Existing remote-content blocking remains in effect. Some new UI strings are Chinese-only.
- The feature commit passed Windows/Linux CI, with 237 local tests in 56 files plus type checks and production build. The tag workflow builds Windows, macOS, and Linux packages for x64/ARM64; consult its result and release assets for availability. Installed-package smoke tests have not been completed on each platform.

---

## 下一版本增量更新（2026-10-24） / Next version update

对比基线：`main` 提交 `5aa786c`。本节记录联系人、看板、草稿箱和发送队列的后续改进；此前的功能说明保留在下方。`package.json` 版本保持 `26.730.1039`，本次提交不创建发布标签，也不代表安装包已更新。

### 中文

#### 联系人与分组

- 邮件发件人和收件人的悬浮信息卡新增“添加到联系人”，可直接从邮件保存联系人。
- 新增联系人分组管理，同一联系人可加入多个分组；联系人搜索支持同时按关键词和分组筛选，写信时可按联系人组添加收件人。
- 联系人列表新增复选框、全选筛选结果和批量删除确认。删除当前正在编辑的联系人时会提示；删除其他联系人不会清空当前未保存的编辑内容。

#### 草稿箱与发送队列

- 本地草稿箱统一汇总各账号草稿，保留每封草稿的发件账号，支持搜索、账号筛选和每页 50 条分页。修复打开草稿箱时反复刷新导致界面卡住的问题。
- 草稿箱与发送队列改为主区域列表，不再使用抽屉。侧边栏按“草稿箱”“发送队列”“全部邮箱”的顺序排列，其后为各邮箱账号。
- 草稿列表新增复选框、当前页全选和批量删除确认；切换分页、搜索或账号筛选时清空选择，避免误删此前选中的草稿。
- 发送队列新增“清除已发送”和“清除失败”，确认后按状态清理全部本地发送记录，不受当前列表加载条数限制。清理不删除服务器邮件、草稿或正在排队、发送中的记录；已发送记录虽不显示在活动队列中，仍可清理。

#### 看板与窗口

- 看板支持多选邮件事项后批量拖拽至其他分栏，并可通过右键菜单修改事项标题、备注和提醒时间。
- 看板提醒独立于全局新邮件通知设置，关闭设置中的新邮件通知不会关闭看板提醒。
- 修复联系人、看板独立窗口的拖动区域，并将页面工具栏与原生最小化、最大化、关闭按钮分开，避免相互重叠。

#### 图标修复与已知问题

- Outlook 账号标志改用随应用打包的本地 Microsoft Outlook 图标，修复远程图标加载失败显示破图的问题；Outlook、Hotmail 和 Microsoft 对应的 Outlook 标志不再依赖远程 favicon 请求。其他服务商的图标逻辑保持不变。
- Gmail / Outlook 掉线、重连及 OAuth 刷新问题仅完成排查，本次未修改连接或认证逻辑，尚不能确认此前 Outlook 异常的实际原因。图标修复不等于账号连接问题已解决。
- **账号代理尚未覆盖全部网络请求。** 新建 IMAP / POP3 / SMTP 连接以及正文、附件读取使用现有代理逻辑；允许加载的邮件远程图片、背景、跟踪资源及 OAuth 相关请求尚未统一走账号代理。隐私策略仍会阻止被判定为禁止加载的资源，本次未放宽策略。

#### 验证与发布范围

- 本地完整回归通过：56 个测试文件、237 个用例。类型检查及生产构建通过；浏览器验证覆盖草稿和队列操作、联系人批量删除、看板交互及 Outlook 本地图标解码。
- 现有部分文件仍有 ESLint 报错，未宣称全仓库 lint 通过。CI 按现有工作流在 Windows / Linux 上运行测试、类型检查和生产构建。
- 本次未重新生成安装包，不触发标签发布工作流。CI 实际执行结果以本次提交对应的 GitHub Actions 记录为准。

### English

Baseline: `main` at `5aa786c`. The package version remains `26.730.1039`; this update does not create a release tag or publish new installers.

- Added an Add to Contacts action to sender/recipient hover cards, multi-group contact membership, combined text/group filtering, and recipient selection by contact group.
- Added contact checkboxes, select-all for filtered results, and confirmed bulk deletion while preserving unrelated unsaved contact edits.
- Unified local drafts across accounts while retaining each draft's sender. Added search, account filtering, 50-item pagination, page selection, and confirmed bulk deletion. Fixed repeated draft refreshes that could freeze the view.
- Moved drafts and the sending queue into the main workspace. Sidebar order is now Drafts, Sending Queue, All Accounts, then individual accounts.
- Added Clear Sent and Clear Failed actions for all matching local outbox records, regardless of the displayed list limit. These actions preserve server mail, drafts, queued messages, and messages currently being sent.
- Added multi-item board dragging and context-menu editing of task titles, notes, and reminder times. Board reminders remain independent of global new-mail notification settings.
- Fixed dragging and title-bar control overlap in the standalone Contacts and Board windows.
- Bundled a local Microsoft Outlook icon to fix broken provider images without relying on remote favicon loading for Outlook-related aliases. Other providers are unchanged.
- Gmail/Outlook reconnection and OAuth issues were investigated, not fixed. Full account-proxy coverage remains pending for remote HTML resources and OAuth requests; existing privacy blocking remains in effect.
- Local verification passed all 237 tests in 56 files, type checks, and production build, with browser checks for the updated workflows and Outlook icon. Existing ESLint errors remain in some files. Installers were not rebuilt; consult the commit's GitHub Actions run for Windows/Linux CI results.

---

## 下一版本（开发中，2026-10-23） / Next version (in development)

对比基线：`origin/main`，提交 `3cc38678519d7c38ee9e25a8f9989b5169934000`（`feat: improve mailbox folders and message actions`）。远端默认分支为 `main`，没有 `master` 分支。当前 `package.json` 版本仍为 `26.730.1039`；本节描述相对主线的代码变化，不代表已发布新的安装包或 GitHub Release。

### 中文

#### 相对主线的功能变化

| 功能           | 主线基线                     | 当前版本                                                                               |
| -------------- | ---------------------------- | -------------------------------------------------------------------------------------- |
| 设置布局       | 弹窗式设置                   | 占满应用窗口，左侧导航、右侧内容，左上角返回邮箱                                       |
| 桌面新邮件通知 | 未提供各邮箱独立开关         | 添加和编辑时可选，通知设置页支持逐个切换和全部开启/关闭；常规设置提供新邮箱默认值      |
| 远程内容隐私   | 全局外部图片开关及单封加载   | 严格、宽松、不限制模式，支持账号覆盖和可信邮箱/域名，在设置侧边栏管理                  |
| 远端操作状态   | 缺少统一的持久化写回记录面板 | 记录账号、邮件摘要、操作状态及错误；支持清除完成记录，保留排队和运行中的任务           |
| 联系人         | 缺少独立联系人管理           | 多地址、备注、星标、搜索、vCard 导入导出，以及写信地址建议                             |
| 待办和提醒     | 无邮件任务看板               | 从邮件创建待办，管理备注、状态和提醒                                                   |
| 邮件规则       | 无规则管理和执行流程         | 按收件人、发件人、主题、正文及附件条件匹配，执行标为已读、加入看板、移入“已删除”等动作 |
| 备份范围       | 导出完整数据库               | 增加“是否备份邮件”，支持仅备份账号、联系人和配置，本地导出与 WebDAV / S3 上传共用选择  |
| Windows 打包   | package.json 命令            | 增加 PowerShell 7 脚本、环境和版本检查、构建日志，分别生成 x64 目录版或安装包          |

#### 行为和数据变化

- 新增联系人、隐私策略与可信发件人、待办及提醒、邮件规则及执行记录、远端写回等数据库表；账号新增桌面通知开关。已有账号迁移后默认开启通知，新邮箱默认值初始为“是”，修改默认值不追溯改变已有账号。
- “远程内容隐私”和“邮件规则”位于设置侧边栏的“网络”和“翻译”之间。“通知设置”支持立即保存，账号通知开关只控制新邮件桌面弹窗和声音，待办提醒独立处理。
- 规则按顺序处理新增邮件，保存执行进度；首次同步、历史回填和 UIDVALIDITY 重置不批量触发历史邮件规则。
- 远端写回增加持久化状态、邮件身份核验及受限制的失败重试；应用重启或恢复数据库后不自动重放未完成的远端命令。
- 仅设置备份保留账号及凭据、联系人、隐私设置、通知设置、文件夹选择、代理、签名、同步方式、邮件规则、全局翻译设置及密钥、远端备份配置等。上述大部分设置原本已随整库备份保存，本次增加了选择性导出及恢复测试，并非新增所有配置的存储能力。
- 不备份邮件时，排除邮件、正文、搜索索引、附件元数据、草稿、发件箱、待办提醒、同步进度和邮件操作记录；保留文件夹配置并重置邮件计数和同步游标，导出不会删除源数据。
- 导入后重新应用开机启动和自动更新检查频率，并刷新同步服务。
- Windows 打包文件范围由整个 `out` 缩小到 `out/main`、`out/preload` 和 `out/renderer`，避免测试用户数据进入应用包。

#### 兼容性与已知限制

- **恢复备份会替换当前本地数据库，不会合并。** 仅设置备份恢复后，本地邮件为空，按同步设置重新拉取；手动同步或禁用同步的账号需要自行启动同步。
- **SQL 备份不包含磁盘附件文件。** 本地 SQL 包含解密凭据所需的数据库密钥，应作为敏感文件保存；远端上传沿用读取密钥加密。详见[备份范围](./docs/backup-coverage.md)。
- **远端永久删除的可用性发生变化：** 新代码要求 UID 定向删除；当前 `SimpleImapSession` 尚未提供 `uidExpunge`，因此 IMAP 永久删除会被拒绝。恢复及规则移动要求服务器支持 `MOVE`，不再使用复制后整箱清除的替代路径。
- 宽松隐私模式使用启发式跟踪识别，不能保证阻止所有跟踪资源。联系人、看板、规则和写回界面仍有中文固定文案，英文覆盖尚不完整。
- 本次不重复列入主线已有的邮件多选、文件夹视图、默认邮件客户端、POP3、翻译、代理和签名等功能；这些功能的历史说明保留在下方。

#### 构建与验证

- 新增 PR 和 `main` 推送触发的 CI，在 Windows / Linux、Node.js 24 环境安装锁定依赖、运行测试及类型检查和生产构建。原有标签触发的 Release 工作流继续负责发布打包。

- `scripts/build-win-unpacked.ps1`：Windows x64 目录版；`scripts/build-win-x64.ps1`：Windows x64 安装包；共用 `build-win-pwsh7.ps1`，支持 `-SkipInstall`，日志位于 `dist/build-logs`。
- 已完成类型检查、生产构建和修改文件的 ESLint 检查。回归共覆盖 50 个测试文件、188 个用例；其中 4 个旧用例补齐 Electron 模拟后通过定向复测。
- 已重新生成 Windows x64 `win-unpacked` 并检查文件与版本信息，尚未对该产物做启动验收。本次更改后的安装包尚未重新生成。
- 曾在写入输出 EXE 时遇到 `EBUSY`；解除占用后单独重试打包成功，具体占用来源未确定。未添加自动结束进程或自动重试。

### English

Baseline: `origin/main` at `3cc38678519d7c38ee9e25a8f9989b5169934000`. The remote default branch is `main`; there is no `master` branch. The package version remains `26.730.1039`. These notes describe code changes relative to the baseline, not a new published release.

#### Changes from the baseline

- Replaced dialog-sized settings with a full-window layout, sidebar navigation, and a back button. Privacy and Mail Rules are sidebar sections between Network and Translation.
- Added per-account desktop new-mail notifications to account creation and editing, a Notifications page with individual and bulk switches, and a separate default for new accounts. Existing accounts migrate with notifications enabled. Task reminders remain independent.
- Replaced the single global remote-image preference with strict, loose, and unrestricted privacy modes, account overrides, and trusted addresses/domains.
- Added persistent remote writeback records and a status panel with account, message, operation, status, and error details. Clearing completed entries preserves queued/running work. Remote actions verify message identity, restrict retries, and do not automatically replay unfinished commands after restart or restore.
- Added contacts with multiple addresses, notes, stars, search, vCard import/export, and composer suggestions.
- Added mail tasks, notes, status management, and reminders.
- Added ordered mail rules based on recipient, sender, subject, body, and attachment conditions, with mark-as-read, add-to-board, and move-to-Deleted actions. Initial sync, historical backfill, and UIDVALIDITY resets do not apply rules to historical mail in bulk.
- Added selective backup scope to existing local SQL and WebDAV / S3 backups. Both modes retain accounts, credentials, contacts, privacy, notifications, folder selections, proxies, signatures, sync preferences, rules, translation settings/keys, and remote backup configuration. Most settings were already included in full-database backups; this change adds selective export and restore verification.
- Settings-only backups omit mail, bodies, indexes, attachment metadata, drafts, outbox, tasks/reminders, sync progress, and operation history. Folder configuration is retained while counts and cursors are reset. Export does not modify source mail. Import now reapplies login startup and update-check preferences.
- Added PowerShell 7 scripts for Windows x64 directory builds and installers, with dependency/version checks and build logs. Packaging now includes only the main, preload, and renderer build directories under `out`, excluding test user data.

#### Compatibility and limitations

- **Import replaces the current local database; it does not merge.** Settings-only restores require mail to be fetched again according to sync preferences. Manual or disabled accounts need synchronization to be started explicitly.
- **SQL backups do not include attachment files on disk.** Local SQL contains the database key required to decrypt credentials and must be treated as sensitive data. Remote backups retain read-key encryption. See [backup coverage (Chinese)](./docs/backup-coverage.md).
- **Remote permanent deletion availability has changed:** the new implementation requires UID-scoped deletion, but the current `SimpleImapSession` does not provide `uidExpunge`, so IMAP permanent deletion is rejected. Restore and rule-based moves require server `MOVE` support; the copy-and-unscoped-expunge alternative is no longer used.
- Loose privacy mode uses heuristic tracker detection and cannot guarantee blocking every tracker. Some contacts, board, rules, and writeback UI strings remain Chinese-only.
- Multi-selection, folder views, default mail handling, POP3, translation, proxies, and signatures already exist in the baseline and are not counted as new features here. Earlier notes are retained below.

#### Verification

Added CI for pull requests targeting `main` and pushes to `main`, installing locked dependencies and running tests, type checks, and production builds on Windows and Linux with Node.js 24. The existing tag-triggered Release workflow continues to handle release packaging.

Type checks, production builds, and ESLint checks for changed files passed. Regression verification covers 188 tests in 50 files, including four targeted reruns after correcting Electron mocks. The Windows x64 directory build was regenerated and its files/version checked, but not launch-tested. Installers have not been rebuilt for these changes. An output-EXE `EBUSY` error cleared on a packaging-only retry; the lock owner was not identified and no process termination or retry automation was added.

---

## 历史版本 / Previous version

# OneMail Next v26.730.1039

## 中文

### 新功能

- 重构邮箱文件夹视图。每个邮箱固定显示收件箱、本地草稿箱、发件箱、垃圾箱和已删除，并显示用户选择同步的其他文件夹；“全部邮箱”仅汇总各邮箱收件箱。
- 新增邮件列表 Ctrl/Command 多选、全选与取消全选，以及单封和多封邮件右键菜单。单封邮件支持标为已读、回复、回复全部、转发和删除；多封邮件支持标为已读、逐个转发、批量转发原始 EML 和删除。
- 已发送邮件会保存至对应邮箱的发件箱。全局发送状态入口仅保留正在发送、等待发送和发送失败的邮件。
- 网易邮箱拆分为网易 163、网易 126 和网易 Yeah，并分别使用对应的 IMAP、POP3 与 SMTP 服务器预设。
- 设置 > 邮箱管理新增系统默认邮件处理器状态和配置入口，并完善 Windows `mailto:` 注册信息。

### 修复与改进

- 修复修改邮箱文件夹选择时保存无响应，以及更新已有文件夹时出现 `Unknown named parameter 'accountId'` 的问题。
- 普通文件夹现可取消同步；保存后会删除该邮箱对应的本地文件夹记录与缓存，不影响服务器上的远端文件夹。INBOX、Sent 和 Junk 在界面及后端均强制保留。
- 批量标为已读期间新增进度提示，并在完成后同步刷新文件夹、邮箱及全部邮箱的未读计数。
- 普通点击邮件摘要会退出多选并打开邮件；切换邮箱、文件夹、筛选条件或搜索视图时会自动清空选择。
- 修复邮件摘要右键事件未传递至实际 DOM 节点，导致右键菜单无法打开的问题。
- 修复邮件签名保存后切换设置页面会丢失的问题。
- 调整邮件删除规则：普通文件夹删除仅进入本地“已删除”；发件箱、垃圾箱及本地“已删除”按固定永久删除规则处理，并在需要时要求确认。
- 增强批量转发：优先使用本地缓存的原始邮件，必要时再从 IMAP 服务器读取 EML。

### 兼容性与限制

- 本版本调整了邮箱文件夹同步与删除策略。收件箱、发件箱和垃圾箱现为固定同步目录，旧版全局及账号级“同步删除到远程”设置不再决定删除行为。普通文件夹中的邮件删除后仅进入本地“已删除”，发件箱、垃圾箱及本地“已删除”中的删除按新的固定规则执行。升级后原有文件夹选择和删除行为可能发生变化。
- 取消普通文件夹同步会删除其本地缓存，但不会删除服务器上的文件夹或邮件；重新选择后需要重新同步。
- POP3 不支持向远端发件箱追加已发送邮件。IMAP 服务器未提供可用的 Sent 文件夹时，发送可以完成，但应用只能返回远端追加警告。
- Windows 仍可能要求用户在系统“默认应用”页面中确认 OneMail Next 为 `mailto:` 处理器。

## English

### New features

- Reworked mailbox folders. Each account now exposes Inbox, Local Drafts, Sent, Junk, Deleted, and any additional folders selected for synchronization. All Accounts aggregates Inbox messages only.
- Added Ctrl/Command multi-selection, select-all toggling, and native context menus for single and multiple messages. Single-message actions include mark as read, reply, reply all, forward, and delete. Multi-message actions include mark as read, individual forwarding, original EML attachment forwarding, and delete.
- Sent messages are stored in the corresponding account's Sent folder. The global delivery-status entry now contains only queued, sending, and failed messages.
- Split NetEase presets into 163, 126, and Yeah, each with its corresponding IMAP, POP3, and SMTP servers.
- Added default mail-handler status and configuration under Settings > Mailbox Management, including complete Windows `mailto:` registration.

### Fixes and improvements

- Fixed mailbox folder selections failing to save and the `Unknown named parameter 'accountId'` error when updating existing folders.
- Optional folders can now be deselected. Saving removes the target account's local folder record and cache without deleting the remote folder. INBOX, Sent, and Junk remain mandatory in both the UI and backend.
- Added progress feedback for bulk mark-as-read operations and refreshed folder, account, and All Accounts unread counters after completion.
- A plain click now exits multi-selection before opening a message. Changing accounts, folders, filters, or searches clears the current selection.
- Fixed context-menu events not reaching the actual message-summary DOM node.
- Fixed signatures disappearing after saving and navigating between settings sections.
- Updated deletion behavior: regular folders move messages to local Deleted, while Sent, Junk, and local Deleted use fixed permanent-deletion rules with confirmation where required.
- Improved bulk forwarding by using cached raw messages first and fetching EML data from IMAP only when necessary.

### Compatibility and limitations

- This release changes folder synchronization and deletion behavior. Inbox, Sent, and Junk are now mandatory synchronized folders, and legacy global or per-account remote-delete settings no longer control deletion. Deleting from regular folders moves messages to local Deleted; deletion from Sent, Junk, and local Deleted follows the new fixed rules. Existing folder selections and deletion behavior may change after upgrading.
- Deselecting an optional folder removes its local cache but does not delete the remote folder or messages. Re-enabling it requires synchronization again.
- POP3 cannot append sent messages to a remote Sent folder. If an IMAP server does not expose a usable Sent folder, sending can complete but the app reports a remote-append warning.
- Windows may still require confirmation in Default Apps before OneMail Next becomes the active `mailto:` handler.
