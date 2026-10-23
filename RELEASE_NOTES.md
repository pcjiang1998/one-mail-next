# OneMail Next 版本记录 / Release notes

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
