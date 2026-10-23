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

OneMail is a local-first desktop mail client built with Electron, React, and TypeScript. It syncs mail over IMAP into a local SQLite database and provides unified inboxes, mail filters, safe HTML previews, attachment downloads, and SQL backup import/export.

**Language**: [中文](./README.md) | English

**Release notes**: [Changes and version notes](./RELEASE_NOTES.md) · **Backup details**: [Coverage and restore behavior (Chinese)](./docs/backup-coverage.md)

**Website / Downloads**: [https://github.com/pcjiang1998/one-mail-next](https://github.com/pcjiang1998/one-mail-next)

This software is based on the [one-mail](https://github.com/zhihui-hu/one-mail) project. The original copyright owner is [zhihui-hu](https://github.com/zhihui-hu), and this version is maintained by [pcjiang1998](https://github.com/pcjiang1998). It is released under the GNU Affero General Public License v3.0.

## Features

- **Multiple mail accounts**: supports Gmail, Yahoo, Alibaba Mail, Alibaba Mail Enterprise, 189 Mail, Sohu, QQ/Foxmail, Tencent Exmail, NetEase Mail, Outlook/Hotmail, Sina, 139 Mail, 21CN, Perfect Mail, iCloud, AOL, Yandex, Mail.ru, and custom IMAP/SMTP.
- **Unified inbox**: view mail across accounts with unread counts, sync status, and account actions.
- **Fast filters**: filter by unread, attachments, starred, today, and more.
- **Read-state sync**: opening an unread message marks it as read locally and syncs the change back over IMAP.
- **Lazy body loading**: message bodies load on demand to reduce startup and sync cost.
- **Safe HTML preview**: sanitizes HTML mail and blocks remote images and external resources by default.
- **Attachment table and download**: view attachment metadata in the message body and choose where to save files.
- **Gmail-style composer**: supports new mail, reply, reply all, forward, CC/BCC expansion, rich text formatting, attachments, and drafts.
- **Encrypted local credentials**: mailbox passwords and app passwords are stored with AES-256-GCM encryption.
- **Local SQLite cache**: accounts, headers, bodies, attachment metadata, search indexes, and settings stay on your machine.
- **Selectable backup scope**: local SQL export/import and encrypted WebDAV / S3 backups can include mail or retain only accounts, contacts, and configuration.
- **Per-account notifications**: choose desktop notifications when adding or editing an account, or enable/disable all accounts in settings. New accounts have a separate global default.
- **Remote writeback status**: inspect accounts, message summaries, operation status, and errors. Clearing completed records preserves queued and running tasks.
- **Contacts**: manage contacts with multiple addresses, import/export vCards, and use address suggestions while composing.
- **Task board and reminders**: turn messages into tasks, add notes, change task status, and schedule reminders.
- **Remote content privacy**: strict, loose, and unrestricted modes, with per-account overrides and trusted sender addresses or domains.
- **Mail rules**: process newly synchronized messages by recipient, sender, subject, body, and attachment conditions; mark as read, add to the board, or move to Deleted.
- **Configurable sync policy**: control sync interval, cache window, and external image behavior.
- **Folder-level sync**: refresh remote folders with IMAP `LIST` while editing an account, then select folders to sync in addition to INBOX.

---

## Screenshots

<p>
  <img src="https://img.huzhihui.com/2026/05/15/OnaMail-03.webp" alt="OneMail message reader" width="100%" />
</p>

<p>
  <img src="https://img.huzhihui.com/2026/05/15/OnaMail-02.webp" alt="OneMail message list" width="100%" />
</p>

<p>
  <img src="https://img.huzhihui.com/2026/05/15/OnaMail-01.webp" alt="OneMail account management" width="100%" />
</p>

---

## Interface

OneMail uses a three-column desktop layout:

1. **Account sidebar**: manage mail accounts, view unread counts, and sync one or all accounts.
2. **Message list**: browse the selected account or unified inbox with quick filters.
3. **Reader**: view subject, sender, recipients, safe preview status, message body, and attachments.

The composer is a floating Gmail-like window. It can expand or restore, CC/BCC fields open on demand, and the footer contains send, formatting, attachment, link, save draft, and discard actions.

Settings fill the application window, with navigation on the left, content on the right, and a back button at the top left. Sections include General, Mailbox Management, Sync, Notifications, Signatures, Network, Remote Content Privacy, Mail Rules, Translation, Backup, and About. Privacy and rules are edited inside settings. About includes version information, the project link, and manual update checks.

When no account exists, you can add an account or restore a SQL backup directly.

---

## Local Development

### Requirements

- Node.js 22.13.0 or newer; Windows builds have been verified locally with Node.js 24.16.0
- pnpm 10.34.1, matching `packageManager` in `package.json`; the Windows scripts check this version
- macOS, Windows, or Linux desktop environment
- PowerShell 7 and native Windows Node.js for the Windows build scripts

### Install Dependencies

```bash
pnpm install
# or
npm install
```

### Start Development Mode

```bash
pnpm dev
# or
npm run dev
```

Development mode starts Electron and Vite. The renderer supports hot reload.

### Type Check

```bash
pnpm typecheck
# or
npm run typecheck
```

### Lint

```bash
pnpm lint
# or
npm run lint
```

### Production Build

```bash
pnpm build
# or
npm run build
```

### Package Desktop Apps

```bash
# unpacked output
pnpm build:unpack

# Windows installer
pnpm build:win

# macOS DMG
pnpm build:mac

# Linux AppImage / snap / deb
pnpm build:linux
```

### Windows x64 Build Scripts

Run from the project root in PowerShell 7:

```powershell
# Set these when using the local proxy; adjust for your environment
$env:HTTP_PROXY = 'http://127.0.0.1:7890'
$env:HTTPS_PROXY = 'http://127.0.0.1:7890'

# Produce dist\win-unpacked without an installer
pwsh -NoProfile -File .\scripts\build-win-unpacked.ps1

# Produce an x64 installer and keep win-unpacked
pwsh -NoProfile -File .\scripts\build-win-x64.ps1
```

The scripts install locked dependencies, run type checks, build production assets, and package the application. Add `-SkipInstall` when complete Windows dependencies are already installed and unchanged:

```powershell
pwsh -NoProfile -File .\scripts\build-win-unpacked.ps1 -SkipInstall
pwsh -NoProfile -File .\scripts\build-win-x64.ps1 -SkipInstall
```

- Directory entry point: `dist\win-unpacked\OneMailNext.exe`. Distribute the entire directory.
- Installer: `dist\one-mail-next-<version>-win-x64-setup.exe`, using the version from `package.json`.
- Logs: `dist\build-logs\`. The scripts do not publish or change version numbers.
- For both x64 and ARM64, run `scripts\build-win-pwsh7.ps1`; use `-Architecture x64` or `-Architecture arm64` to select one architecture.

An `EBUSY: resource busy or locked` error referencing `dist\win-unpacked\OneMailNext.exe` means the output executable is locked. Exit applications launched from that directory before packaging. The lock observed during this update cleared on retry; its owner was not identified. If source compilation succeeded and the source has not changed, retry only packaging after the lock clears:

```powershell
pnpm exec electron-builder --win --dir --publish never --x64
```

### Notifications and Backup Scope

Set desktop notifications when adding or editing an account. Settings > Notifications provides individual switches and enable-all/disable-all actions. General settings retain the default for newly added accounts, initially enabled; changing that default does not change existing accounts.

In Settings > Backup, **Include mail in backup** is checked by default and applies to both local SQL exports and WebDAV / S3 uploads. Both modes preserve accounts and credentials, contacts, privacy policies and trusted senders, notification preferences, folder selections, proxies, signatures, sync preferences, mail rules, global translation settings and service keys, remote backup configuration, and other database-backed app settings.

| Content                                                   | Checked      | Unchecked    |
| --------------------------------------------------------- | ------------ | ------------ |
| Accounts, contacts, and configuration above               | Included     | Included     |
| Cached mail, bodies, search indexes, attachment metadata  | Included     | Omitted      |
| Drafts, outbox, tasks, and reminders                      | Included     | Omitted      |
| Sync progress, rule execution, and mail operation history | Included     | Omitted      |
| Attachment files on disk                                  | Not included | Not included |

**Import replaces the local database; it does not merge data.** A settings-only restore keeps folder selections but clears local mail, counts, and sync cursors. Messages are fetched again according to the restored sync preferences. Manual or disabled accounts need synchronization to be started explicitly. Export does not remove mail from the source database.

Keep attachment files separately, especially local files referenced by unsent drafts. Local SQL backups contain the database key needed to decrypt credentials and must be treated as sensitive files. Remote uploads encrypt the backup with the configured read key.

---

## Usage

1. **Add an account**: click the add button and choose a common provider or custom IMAP.
2. **Enter credentials**: built-in providers need email, password/app password/auth code, and optional alias. Custom accounts can configure separate IMAP and SMTP servers, ports, and security modes.
3. **Sync mail**: OneMail starts syncing the inbox after the account is saved. You can also sync manually from the account sidebar.
4. **Choose synced folders**: edit the account, refresh its remote folders, and select the folders to sync. INBOX is always synced.
5. **Filter mail**: use unread, attachment, starred, today, and other filters to narrow the list.
6. **Read mail**: click a message to load its body. HTML mail opens in safe-preview mode first.
7. **Load full content**: click the reader action when you need remote images.
8. **Download attachments**: click an attachment row or download button and choose a save path.
9. **Compose and reply**: use compose, reply, reply all, or forward. CC/BCC expand on demand, and `Aa` toggles formatting tools.
10. **Save or discard drafts**: closing a non-empty composer saves a draft. The trash button discards a saved draft.
11. **Back up data**: export a SQL backup in Settings. Empty first-launch state can import a SQL backup directly.

---

## Data and Security

- The SQLite database is stored under Electron `userData/OneMail/onemail.sqlite`.
- Mailbox passwords, auth codes, and app passwords are encrypted with an AES-256-GCM key derived from the local database key.
- SQL backup files are validated with the key, Linux timestamp, and SQL header information in the filename/content.
- HTML mail is sanitized. Remote images and external resources are blocked by default to reduce privacy leakage.
- Attachments are stored as metadata until you explicitly download them.

---

## Project Structure

```text
src/
├── main/                 # Electron main process, IPC, SQLite, IMAP sync
│   ├── db/               # Database connection, schema, repositories
│   ├── ipc/              # accounts/messages/sync/settings/system IPC
│   ├── mail/             # IMAP sync, body parsing, attachment download
│   └── services/         # Credential encryption, SQL backup, app services
├── preload/              # Safe APIs exposed to the renderer through contextBridge
├── renderer/src/         # React UI
│   ├── components/       # Mail, account, settings, and shadcn/ui components
│   ├── lib/              # Renderer API adapters and utilities
│   └── assets/           # Icons and styles
└── shared/               # Types shared across main, preload, and renderer
```

---

## Tech Stack

- [Electron](https://www.electronjs.org/) - cross-platform desktop runtime
- [electron-vite](https://electron-vite.org/) - Electron + Vite tooling
- [React](https://react.dev/) - renderer UI
- [TypeScript](https://www.typescriptlang.org/) - type system
- [Tailwind CSS](https://tailwindcss.com/) - utility-first styling
- [shadcn/ui](https://ui.shadcn.com/) - UI components
- [Lucide React](https://lucide.dev/) - icon library
- [SQLite](https://www.sqlite.org/) - local data storage

---

## Contributing

Pull requests targeting `main` and pushes to `main` automatically run tests, type checks, and production builds on Windows and Linux. The Release workflow builds release packages when a `v*` tag is pushed.

Issues and pull requests are welcome. Before submitting, please run:

```bash
pnpm typecheck
pnpm lint
```

## License

OneMail is licensed under the [GNU Affero General Public License v3.0](./LICENSE) (AGPL-3.0-only).

You may use, copy, modify, and distribute this project under AGPL v3.0. If you provide a modified version over a network, you must also provide the corresponding source code as required by the AGPL.

## Credits

- [Electron](https://www.electronjs.org/) - desktop runtime
- [electron-vite](https://electron-vite.org/) - development and build tooling
- [shadcn/ui](https://ui.shadcn.com/) - UI component library
- [Lucide](https://lucide.dev/) - icons
- [SQLite](https://www.sqlite.org/) - local database

---

**Note**: OneMail currently focuses on local IMAP sync and desktop reading. For Gmail, Outlook, QQ, NetEase, Yahoo, iCloud, and similar providers, enable IMAP/SMTP in the provider settings first and use an app password, authorization code, or dedicated password when required.
