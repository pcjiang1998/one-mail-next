# OneMail

<p align="left">
  <img src="https://img.shields.io/badge/Electron-42-47848F?logo=electron&logoColor=white" alt="Electron 42" />
  <img src="https://img.shields.io/badge/React-19-282C34?logo=react&logoColor=61DAFB" alt="React 19" />
  <img src="https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white" alt="TypeScript 5.9" />
  <img src="https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?logo=tailwind-css&logoColor=white" alt="Tailwind CSS 4" />
  <img src="https://img.shields.io/badge/shadcn/ui-black?style=flat&logo=vercel&logoColor=white" alt="shadcn/ui" />
  <img src="https://img.shields.io/badge/Lucide_React-yellow?logo=lucide&logoColor=black" alt="Lucide React" />
  <img src="https://img.shields.io/badge/SQLite-local-003B57?logo=sqlite&logoColor=white" alt="SQLite" />
  <img src="https://img.shields.io/badge/pnpm-orange?logo=pnpm&logoColor=white" alt="pnpm" />
  <img src="https://img.shields.io/badge/Prettier-code_style-F7B93E?logo=prettier&logoColor=black" alt="Prettier" />
</p>

OneMail 是一个本地优先的桌面邮件客户端，使用 Electron + React + TypeScript 构建。它通过 IMAP 同步邮件到本地 SQLite，支持多邮箱聚合、邮件筛选、正文安全预览、附件下载和 SQL 备份导入导出。

**语言**：中文 | [English](./README.en.md)

**更新说明**：[本次更新与版本记录](./RELEASE_NOTES.md) · **备份说明**：[备份范围与恢复行为](./docs/backup-coverage.md)

**项目主页 / 下载页**：[https://github.com/pcjiang1998/one-mail-next](https://github.com/pcjiang1998/one-mail-next)

本软件基于 [one-mail](https://github.com/zhihui-hu/one-mail) 项目修改。原项目版权所有者为 [zhihui-hu](https://github.com/zhihui-hu)，修改者为 [pcjiang1998](https://github.com/pcjiang1998)。本软件按照 GNU Affero General Public License v3.0 发布。

## ✨ 功能特性

- 📬 **多邮箱账号**：支持 Gmail、Yahoo、阿里邮箱、阿里企业邮箱、189、搜狐、QQ/Foxmail、腾讯企业邮、网易、Outlook/Hotmail、新浪、139、21CN、完美邮箱、iCloud、AOL、Yandex、Mail.ru 和自定义 IMAP/SMTP。
- 🧩 **统一收件箱体验**：多账号聚合查看，账号列表展示未读数、同步状态和账号操作。
- 🔎 **邮件快速筛选**：支持未读、有附件、星标、今日等组合筛选。
- ✅ **已读状态同步**：打开未读邮件后自动标记已读，并通过 IMAP 同步到远端邮箱。
- 📨 **正文按需加载**：点击邮件后再拉取正文，减少启动和同步成本。
- 🛡️ **HTML 安全预览**：净化邮件 HTML，默认阻止远程图片和外部资源。
- 📎 **附件表格与下载**：正文区域以表格展示附件元数据，点击即可选择路径下载。
- ✍️ **Gmail 风格写信窗口**：支持新邮件、回复、回复全部、转发、抄送/密送按需展开、富文本格式、附件和草稿保存。
- 🔐 **本地凭据加密**：邮箱密码或授权码使用 AES-256-GCM 加密后保存到本地数据库。
- 💾 **SQLite 本地缓存**：账号、邮件头、正文、附件元数据、搜索索引和设置均保存在本机。
- ♻️ **可选范围备份**：支持本地 SQL 导入导出及 WebDAV / S3 加密远端备份，可选择包含邮件或仅保留账号、联系人和配置。
- 🔔 **按邮箱控制通知**：添加和编辑邮箱时可设置桌面通知，在设置中批量开启或关闭；新增邮箱使用独立的全局默认值。
- 📋 **远端写回状态**：查看账号、邮件摘要、操作状态和失败原因，清除已完成记录时保留排队及正在执行的任务。
- 👥 **联系人**：管理联系人及多个邮箱地址，支持 vCard 导入导出和写信时的地址建议。
- 🗂️ **待办看板与提醒**：将邮件加入看板，记录备注、更新任务状态并设置提醒。
- 🛡️ **远程内容隐私策略**：支持严格、宽松和不限制模式，可按账号覆盖全局策略，并维护可信发件邮箱或域名。
- 🧩 **邮件规则**：按收件人、发件人、主题、正文和附件条件处理新同步的邮件，支持标记已读、加入看板和移入“已删除”。
- ⚙️ **可配置同步策略**：分别设置元信息范围、全文范围、本地缓存保留天数和附件下载方式。
- 📁 **按文件夹同步**：编辑账号时通过 IMAP `LIST` 刷新远端文件夹，并选择除 INBOX 外需要同步的文件夹。

---

## 📸 预览图

<p>
  <img src="https://img.huzhihui.com/2026/05/15/OnaMail-03.webp" alt="OneMail 邮件阅读预览" width="100%" />
</p>

<p>
  <img src="https://img.huzhihui.com/2026/05/15/OnaMail-02.webp" alt="OneMail 邮件列表预览" width="100%" />
</p>

<p>
  <img src="https://img.huzhihui.com/2026/05/15/OnaMail-01.webp" alt="OneMail 账号管理预览" width="100%" />
</p>

---

## 🖥️ 界面概览

OneMail 当前采用三栏桌面布局：

1. **账号栏**：管理邮箱账号，查看未读数，同步单个账号或全部账号。
2. **邮件列表**：展示当前账号或统一收件箱的邮件，顶部提供标签筛选。
3. **阅读区**：展示邮件主题、收发件人、正文、安全预览提示和附件表格。

写信窗口采用贴近 Gmail 的浮层交互：顶部可展开/还原或保存并关闭；收件人行可按需展开抄送、密送；底部提供发送、格式栏开关、附件、链接、保存草稿和丢弃草稿操作。

设置页占满应用窗口，保留左侧页面列表和右侧设置内容，左上角返回键可回到邮箱主页面。侧边栏依次提供常规、邮箱管理、邮件同步、邮件同步范围、通知设置、签名、网络、远程内容隐私、邮件规则、翻译、备份和关于；远程内容隐私和邮件规则直接在设置页内编辑。关于页显示版本信息、项目入口，并可手动检查更新。

首次没有账号时，可以直接添加账号，也可以通过 **导入 SQL** 恢复已有备份。

---

## 🛠️ 本地开发

### 环境要求

- Node.js 22.13.0 或更高版本；本机 Windows 构建已使用 Node.js 24.16.0 验证
- pnpm 10.34.1，与 `package.json` 的 `packageManager` 一致；下文构建脚本会检查版本
- macOS / Windows / Linux 桌面环境
- 使用 Windows 专用构建脚本时需要 PowerShell 7 和原生 Windows Node.js

### 安装依赖

```bash
pnpm install
# 或
npm install
```

### 启动开发模式

```bash
pnpm dev
# 或
npm run dev
```

开发模式会启动 Electron + Vite，渲染层支持热更新。

### 类型检查

```bash
pnpm typecheck
# 或
npm run typecheck
```

### 代码检查

```bash
pnpm lint
# 或
npm run lint
```

### 构建生产版本

```bash
pnpm build
# 或
npm run build
```

### 打包桌面应用

```bash
# 生成未打包目录
pnpm build:unpack

# Windows 安装包
pnpm build:win

# macOS DMG
pnpm build:mac

# Linux AppImage / snap / deb
pnpm build:linux
```

### Windows x64 构建脚本

在项目根目录使用 PowerShell 7：

```powershell
# 本机使用代理时设置；其他环境按实际代理地址调整
$env:HTTP_PROXY = 'http://127.0.0.1:7890'
$env:HTTPS_PROXY = 'http://127.0.0.1:7890'

# 生成 dist\win-unpacked，不生成安装包
pwsh -NoProfile -File .\scripts\build-win-unpacked.ps1

# 生成 Windows x64 安装包，同时保留 win-unpacked
pwsh -NoProfile -File .\scripts\build-win-x64.ps1
```

脚本默认安装锁定的依赖，再执行类型检查、生产构建和打包。已有完整 Windows 依赖且依赖未变更时，可添加 `-SkipInstall`：

```powershell
pwsh -NoProfile -File .\scripts\build-win-unpacked.ps1 -SkipInstall
pwsh -NoProfile -File .\scripts\build-win-x64.ps1 -SkipInstall
```

- 目录版入口：`dist\win-unpacked\OneMailNext.exe`，分发时需要保留整个目录。
- 安装包：`dist\one-mail-next-<版本号>-win-x64-setup.exe`，版本读取自 `package.json`。
- 日志：`dist\build-logs\`。脚本不自动发布，也不自动修改版本号。
- 同时构建 x64 和 ARM64：运行 `scripts\build-win-pwsh7.ps1`；可用 `-Architecture x64` 或 `-Architecture arm64` 指定架构。

如果出现 `EBUSY: resource busy or locked`，且路径指向 `dist\win-unpacked\OneMailNext.exe`，表示打包输出文件被占用。先退出从该目录运行的应用；本次遇到的占用在重试时已解除，未确定具体占用来源。若日志确认源码构建成功且源码未变更，可在占用解除后只重试打包：

```powershell
pnpm exec electron-builder --win --dir --publish never --x64
```

---

## 🎯 使用说明

1. **添加邮箱账号**：点击右上角添加按钮，选择常见邮箱服务商或自定义 IMAP。
2. **填写凭据**：内置邮箱只需填写邮箱、密码/授权码和可选别名；自定义账号可分别配置 IMAP 与 SMTP 服务器、端口和安全模式。
3. **同步邮件**：新增账号后会自动同步收件箱，也可以在账号栏手动同步。
4. **选择同步文件夹**：在账号菜单中打开编辑账号，刷新远端文件夹并勾选需要同步的文件夹；INBOX 始终同步。
5. **筛选邮件**：使用未读、有附件、星标、今日标签快速缩小邮件范围。
6. **自动标记已读**：打开未读邮件后会自动标记已读，并同步到远端邮箱。
7. **阅读正文**：点击邮件后加载正文；HTML 邮件会先以安全预览方式显示。
8. **加载完整内容**：需要查看远程图片时，可在阅读区顶部点击加载完整内容。
9. **保存附件**：在正文底部附件表格中点击附件行或“保存”按钮，选择保存路径；“保存（已缓存）”表示无需重新下载。
10. **撰写和回复**：点击写信、回复、回复全部或转发打开写信窗口；点击抄送/密送可展开更多收件人行，`Aa` 可切换格式工具栏。
11. **保存或丢弃草稿**：关闭有内容的写信窗口会保存草稿；底部垃圾桶可丢弃已保存草稿。
12. **管理通知**：添加或编辑邮箱时设置“是否需要桌面通知”；在设置 > 通知设置逐个切换或一键全部开启、关闭。“常规”中的新邮箱默认值初始为“是”，只影响后续添加时的默认勾选。
13. **管理隐私和规则**：在设置侧边栏打开远程内容隐私或邮件规则；全局隐私默认值可被账号策略和可信发件人配置覆盖。
14. **备份数据**：打开设置 > 备份，选择“是否备份邮件”，然后导出 SQL 或上传到已配置的 WebDAV / S3。该选项默认勾选，作用于两种导出方式。

### 同步范围与缓存

邮件同步与缓存的默认值为：元信息 30 天、全文 7 天、本地缓存保留 0 天。在“设置 > 邮件同步范围”中修改，元信息最多 90 天、全文最多 30 天，且元信息范围必须大于全文范围。IMAP 与 POP3 均按邮件日期和本地缓存完整性补齐，不按已读、未读区分；缩小同步范围不删除已有缓存。

缓存保留为 0 时不自动清理，手动清理按钮也不可用；非零时必须大于元信息范围。启动及每 24 小时检查一次，按邮件日期和最近用户访问时间的较新值计算过期时间。默认只清正文和附件内容，勾选“清理时同时清理元信息”才删除本地元信息。时间窗口内及仍关联看板的邮件均受保护，包括已完成、已取消但未解除关联的任务。清理不删除或移动服务器邮件，不删除用户另存的附件。

附件默认随正文缓存。“附件单独下载”只影响之后首次获取元信息的邮件，手动打开旧邮件也遵循其原有策略。切换开关不会删除已有附件，也不会在后台重拉已缓存正文来补附件。POP3 等协议可能必须获取整封邮件，多取得的内容会保留复用。

升级时旧 `syncWindowDays` 用于元信息范围：旧值 0 转为 90，其他有效整数限制在 8～90；全文初始化为 7，新的缓存保留天数为 0。迁移不清除缓存。

### 备份范围与恢复

无论是否勾选“是否备份邮件”，都会保留账号及凭据、联系人、隐私和可信发件人、通知设置、文件夹选择、代理、签名、同步方式、邮件规则、全局翻译设置及服务密钥、远端备份配置和其他数据库内的软件设置。

| 内容                                   | 勾选   | 不勾选 |
| -------------------------------------- | ------ | ------ |
| 账号、联系人和上述配置                 | 保留   | 保留   |
| 已缓存邮件、正文、搜索索引和附件元数据 | 保留   | 不保留 |
| 草稿、发件箱、待办及提醒               | 保留   | 不保留 |
| 同步进度、规则执行及邮件操作记录       | 保留   | 不保留 |
| 磁盘上的附件文件                       | 不包含 | 不包含 |

**导入会替换当前本地数据库，不会合并。** 仅设置备份恢复后，本地邮件为空，文件夹选择仍然保留，邮件计数和同步游标已重置。按原同步设置重新拉取邮件；手动同步或禁用同步的邮箱需要自行启动同步。导出不会删除源数据库中的邮件。

附件文件需要另行保留，尤其是尚未发送草稿引用的本地文件。完整说明见[备份范围](./docs/backup-coverage.md)。

---

## 🔐 数据与安全

- OneMail 的数据库文件位于 Electron `userData/OneMail/onemail.sqlite`。
- 邮箱密码或授权码不会明文写入数据库，会使用本地数据库密钥派生的 AES-256-GCM 密钥加密。
- SQL 备份文件会校验文件名中的密钥、Linux 时间戳和 SQL 头部信息。
- 本地 SQL 备份包含解密凭据所需的数据库密钥，应作为敏感文件保存；WebDAV / S3 上传使用读取密钥加密备份。
- HTML 邮件会经过基础净化，默认阻止远程图片和外部资源，降低隐私泄露风险。
- 附件默认只保存元数据，只有用户点击下载时才写入本地文件。

---

## 📁 项目结构

```text
src/
├── main/                 # Electron 主进程、IPC、SQLite、IMAP 同步
│   ├── db/               # 数据库连接、schema、repositories
│   ├── ipc/              # accounts/messages/sync/settings/system IPC
│   ├── mail/             # IMAP 同步、正文解析、附件下载
│   └── services/         # 凭据加密、SQL 备份等服务
├── preload/              # contextBridge 暴露给渲染进程的安全 API
├── renderer/src/         # React UI
│   ├── components/       # 邮件、账号、设置和 shadcn/ui 组件
│   ├── lib/              # 渲染层 API 适配和工具函数
│   └── assets/           # 图标和样式资源
└── shared/               # 主进程、preload、渲染进程共享类型
```

---

## 📦 技术栈

- [Electron](https://www.electronjs.org/) - 跨平台桌面应用框架
- [electron-vite](https://electron-vite.org/) - Electron + Vite 开发构建工具
- [React](https://react.dev/) - 渲染层 UI
- [TypeScript](https://www.typescriptlang.org/) - 类型系统
- [Tailwind CSS](https://tailwindcss.com/) - 原子化样式
- [shadcn/ui](https://ui.shadcn.com/) - UI 组件
- [Lucide React](https://lucide.dev/) - 图标库
- [SQLite](https://www.sqlite.org/) - 本地数据存储

---

## 🤝 贡献

提交到 `main` 的 Pull Request 和合并后的 `main` 推送会自动触发 CI，在 Windows / Linux 上运行测试、类型检查和生产构建。发布安装包由 `v*` 标签触发的 Release 工作流负责。

欢迎提交 Issue 和 Pull Request。建议在提交前运行：

```bash
pnpm typecheck
pnpm lint
```

## 📄 许可证

本项目采用 [GNU Affero General Public License v3.0](./LICENSE)（AGPL-3.0-only）许可。

你可以在遵守 AGPL v3.0 条款的前提下使用、复制、修改和分发本项目；如果通过网络提供修改后的版本，也需要按 AGPL 要求向用户提供相应源代码。

## 🙏 致谢

- [Electron](https://www.electronjs.org/) - 桌面应用运行时
- [electron-vite](https://electron-vite.org/) - 开发构建工具
- [shadcn/ui](https://ui.shadcn.com/) - UI 组件库
- [Lucide](https://lucide.dev/) - 图标库
- [SQLite](https://www.sqlite.org/) - 本地数据库

---

**注意**：OneMail 目前以本地 IMAP 邮件同步和桌面阅读为核心能力。使用 Gmail、Outlook、QQ、网易、Yahoo、iCloud 等服务时，请先在邮箱后台开启 IMAP/SMTP，并按服务商要求使用应用专用密码、授权码或专用密码。
