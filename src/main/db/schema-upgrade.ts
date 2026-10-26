import type { SqliteDatabaseSync, SqliteRow } from './connection'
import { REMOTE_MESSAGE_MISSING_NOTICE } from '../mail/remote-message-error'

type TableColumnRow = SqliteRow & {
  name: string
}

type ColumnDefinition = {
  name: string
  definition: string
}

const TABLE_COLUMN_UPGRADES: Record<string, ColumnDefinition[]> = {
  onemail_provider_presets: [
    { name: 'smtp_host', definition: 'smtp_host TEXT' },
    { name: 'smtp_port', definition: 'smtp_port INTEGER' },
    {
      name: 'smtp_security',
      definition: "smtp_security TEXT CHECK (smtp_security IN ('ssl_tls', 'starttls', 'none'))"
    },
    {
      name: 'smtp_auth_type',
      definition:
        "smtp_auth_type TEXT CHECK (smtp_auth_type IN ('oauth2', 'app_password', 'password', 'bridge', 'manual'))"
    },
    {
      name: 'smtp_requires_auth',
      definition:
        'smtp_requires_auth INTEGER NOT NULL DEFAULT 1 CHECK (smtp_requires_auth IN (0, 1))'
    }
  ],
  onemail_mail_accounts: [
    {
      name: 'desktop_notifications_enabled',
      definition:
        'desktop_notifications_enabled INTEGER NOT NULL DEFAULT 1 CHECK (desktop_notifications_enabled IN (0, 1))'
    },
    { name: 'smtp_host', definition: 'smtp_host TEXT' },
    {
      name: 'smtp_port',
      definition:
        'smtp_port INTEGER CHECK (smtp_port IS NULL OR (smtp_port > 0 AND smtp_port <= 65535))'
    },
    {
      name: 'smtp_security',
      definition: "smtp_security TEXT CHECK (smtp_security IN ('ssl_tls', 'starttls', 'none'))"
    },
    {
      name: 'smtp_auth_type',
      definition:
        "smtp_auth_type TEXT CHECK (smtp_auth_type IN ('oauth2', 'app_password', 'password', 'bridge', 'manual'))"
    },
    {
      name: 'smtp_enabled',
      definition: 'smtp_enabled INTEGER NOT NULL DEFAULT 1 CHECK (smtp_enabled IN (0, 1))'
    },
    {
      name: 'remote_delete_policy',
      definition:
        "remote_delete_policy TEXT NOT NULL DEFAULT 'inherit' CHECK (remote_delete_policy IN ('inherit', 'enabled', 'disabled'))"
    },
    {
      name: 'receive_protocol',
      definition:
        "receive_protocol TEXT NOT NULL DEFAULT 'imap' CHECK (receive_protocol IN ('imap', 'pop3'))"
    },
    { name: 'pop_host', definition: 'pop_host TEXT' },
    {
      name: 'pop_port',
      definition:
        'pop_port INTEGER CHECK (pop_port IS NULL OR (pop_port > 0 AND pop_port <= 65535))'
    },
    {
      name: 'pop_security',
      definition: "pop_security TEXT CHECK (pop_security IN ('ssl_tls', 'starttls', 'none'))"
    },
    {
      name: 'idle_supported',
      definition:
        'idle_supported INTEGER CHECK (idle_supported IS NULL OR idle_supported IN (0, 1))'
    },
    {
      name: 'proxy_mode',
      definition:
        "proxy_mode TEXT NOT NULL DEFAULT 'global' CHECK (proxy_mode IN ('global', 'none', 'system', 'custom'))"
    },
    { name: 'custom_proxy_url', definition: 'custom_proxy_url TEXT' },
    {
      name: 'signature_mode',
      definition:
        "signature_mode TEXT NOT NULL DEFAULT 'global' CHECK (signature_mode IN ('global', 'none', 'custom'))"
    },
    { name: 'signature_id', definition: 'signature_id INTEGER' },
    {
      name: 'account_sync_mode',
      definition:
        "account_sync_mode TEXT NOT NULL DEFAULT 'global' CHECK (account_sync_mode IN ('global', 'fallback', 'idle', 'interval', 'manual'))"
    }
  ],
  onemail_message_bodies: [{ name: 'raw_source', definition: 'raw_source TEXT' }],
  onemail_message_attachments: [{ name: 'cached_content', definition: 'cached_content BLOB' }],
  onemail_pop3_messages: [
    { name: 'mail_date', definition: 'mail_date TEXT' },
    { name: 'raw_source', definition: 'raw_source TEXT' }
  ],
  onemail_mail_messages: [
    {
      name: 'download_attachments_separately',
      definition:
        'download_attachments_separately INTEGER NOT NULL DEFAULT 0 CHECK (download_attachments_separately IN (0, 1))'
    },
    { name: 'last_user_accessed_at', definition: 'last_user_accessed_at TEXT' },
    {
      name: 'sync_backfill',
      definition: 'sync_backfill INTEGER NOT NULL DEFAULT 0 CHECK (sync_backfill IN (0, 1))'
    },
    {
      name: 'read_state_revision',
      definition: 'read_state_revision INTEGER NOT NULL DEFAULT 0 CHECK (read_state_revision >= 0)'
    },
    {
      name: 'remote_missing',
      definition: 'remote_missing INTEGER NOT NULL DEFAULT 0 CHECK (remote_missing IN (0, 1))'
    },
    {
      name: 'user_deleted',
      definition: 'user_deleted INTEGER NOT NULL DEFAULT 0 CHECK (user_deleted IN (0, 1))'
    },
    {
      name: 'user_hidden',
      definition: 'user_hidden INTEGER NOT NULL DEFAULT 0 CHECK (user_hidden IN (0, 1))'
    },
    { name: 'deleted_at', definition: 'deleted_at TEXT' },
    { name: 'delete_error', definition: 'delete_error TEXT' },
    { name: 'last_operation_at', definition: 'last_operation_at TEXT' }
  ]
}

export function upgradeSchema(db: SqliteDatabaseSync): void {
  const needsRemoteMissingUpgrade = !getTableColumns(db, 'onemail_mail_messages').has(
    'remote_missing'
  )
  db.exec(`
    CREATE TABLE IF NOT EXISTS onemail_mail_signatures (
      signature_id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL UNIQUE CHECK (length(trim(title)) > 0),
      content TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
  `)
  db.exec(`
    CREATE TABLE IF NOT EXISTS onemail_pop3_messages (
      account_id INTEGER NOT NULL,
      uidl TEXT NOT NULL,
      message_id INTEGER,
      seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      PRIMARY KEY (account_id, uidl),
      FOREIGN KEY (account_id) REFERENCES onemail_mail_accounts(account_id) ON DELETE CASCADE,
      FOREIGN KEY (message_id) REFERENCES onemail_mail_messages(message_id) ON DELETE SET NULL
    );
  `)
  for (const [tableName, columns] of Object.entries(TABLE_COLUMN_UPGRADES)) {
    addMissingColumns(db, tableName, columns)
  }
  if (needsRemoteMissingUpgrade) {
    // Older full scans hid missing UIDs using remote_deleted, without a user deletion.
    db.exec(`
      UPDATE onemail_mail_messages
      SET remote_missing = 1, remote_deleted = 0
      WHERE remote_deleted = 1 AND is_deleted = 0 AND user_deleted = 0;
      UPDATE onemail_mail_folders
      SET total_count = total_count + (
            SELECT COUNT(*) FROM onemail_mail_messages m
            WHERE m.folder_id = onemail_mail_folders.folder_id
              AND m.remote_missing = 1 AND m.user_hidden = 0
          ),
          unread_count = unread_count + (
            SELECT COUNT(*) FROM onemail_mail_messages m
            WHERE m.folder_id = onemail_mail_folders.folder_id
              AND m.remote_missing = 1 AND m.user_hidden = 0 AND m.is_read = 0
          );
    `)
    db.prepare(
      `UPDATE onemail_remote_writebacks
       SET status = 'cancelled', error_message = :notice,
           finished_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE status IN ('queued', 'running', 'failed')
         AND operation_kind IN ('mark_read', 'mark_unread', 'mark_answered')
         AND message_id IN (
           SELECT message_id FROM onemail_mail_messages WHERE remote_missing = 1
         )`
    ).run({ notice: REMOTE_MESSAGE_MISSING_NOTICE })
  }
  ensureFeatureColumns(db)
  ensureRemoteWritebackOperationKinds(db)
}

function ensureFeatureColumns(db: SqliteDatabaseSync): void {
  addMissingColumns(db, 'onemail_rule_executions', [
    { name: 'progress_json', definition: "progress_json TEXT NOT NULL DEFAULT '{}'" }
  ])
}

function ensureRemoteWritebackOperationKinds(db: SqliteDatabaseSync): void {
  const row = db
    .prepare<{
      sql: string | null
    }>("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'onemail_remote_writebacks'")
    .get()
  if (!row?.sql || row.sql.includes("'smtp_send'") || row.sql.includes("'permanent_delete'")) return

  db.exec('PRAGMA foreign_keys = OFF;')
  try {
    db.exec(`
      ALTER TABLE onemail_remote_writebacks RENAME TO onemail_remote_writebacks_legacy;
      CREATE TABLE onemail_remote_writebacks (
        writeback_id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id INTEGER NOT NULL,
        message_id INTEGER,
        operation_kind TEXT NOT NULL CHECK (operation_kind IN ('mark_read', 'mark_unread', 'move_to_trash', 'restore', 'permanent_delete', 'mark_answered', 'append_sent', 'smtp_send', 'rule_action')),
        status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'success', 'failed', 'cancelled')),
        message_subject_snapshot TEXT,
        message_sender_snapshot TEXT,
        payload_json TEXT NOT NULL DEFAULT '{}',
        error_message TEXT,
        attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
        idempotency_key TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        started_at TEXT,
        finished_at TEXT,
        dismissed_at TEXT,
        FOREIGN KEY (account_id) REFERENCES onemail_mail_accounts(account_id) ON DELETE CASCADE,
        FOREIGN KEY (message_id) REFERENCES onemail_mail_messages(message_id) ON DELETE SET NULL
      );
      INSERT INTO onemail_remote_writebacks (
        writeback_id, account_id, message_id, operation_kind, status,
        message_subject_snapshot, message_sender_snapshot, payload_json,
        error_message, attempt_count, idempotency_key, created_at, started_at,
        finished_at, dismissed_at
      )
      SELECT writeback_id, account_id, message_id, operation_kind, status,
        message_subject_snapshot, message_sender_snapshot, COALESCE(payload_json, '{}'),
        error_message, attempt_count, idempotency_key, created_at, started_at,
        finished_at, dismissed_at
      FROM onemail_remote_writebacks_legacy;
      DROP TABLE onemail_remote_writebacks_legacy;
      CREATE INDEX IF NOT EXISTS idx_onemail_remote_writebacks_status
        ON onemail_remote_writebacks(status, dismissed_at, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_onemail_remote_writebacks_account
        ON onemail_remote_writebacks(account_id, created_at DESC);
    `)
  } finally {
    db.exec('PRAGMA foreign_keys = ON;')
  }
}

function addMissingColumns(
  db: SqliteDatabaseSync,
  tableName: string,
  columns: ColumnDefinition[]
): void {
  const existingColumns = getTableColumns(db, tableName)

  for (const column of columns) {
    if (!existingColumns.has(column.name)) {
      db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${column.definition};`)
    }
  }
}

function getTableColumns(db: SqliteDatabaseSync, tableName: string): Set<string> {
  return new Set(
    db
      .prepare<TableColumnRow>(`PRAGMA table_info(${tableName});`)
      .all()
      .map((row) => row.name)
  )
}
