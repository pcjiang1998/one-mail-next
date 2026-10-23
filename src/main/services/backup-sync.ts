import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  scryptSync
} from 'node:crypto'
import type {
  BackupExportOptions,
  BackupSyncDownloadResult,
  BackupSyncSettings,
  BackupSyncTestResult,
  BackupSyncTransferResult
} from '../ipc/types'
import {
  getBackupSyncSettingsForMain,
  resolveBackupSyncSettingsForMain
} from '../db/repositories/settings.repository'
import {
  createDatabaseSqlBackup,
  importDatabaseSqlBackupContent,
  type BackupImportProgressReporter
} from './database-backup'

type ConfiguredBackupSyncSettings = Exclude<BackupSyncSettings, { provider: 'none' }>

type RemoteDownload = {
  sql: string
  remotePath: string
  sourceName: string
}

const EMPTY_SHA256 = sha256('')
const CONNECTION_TEST_BODY = 'OneMail backup sync connection test\n'
const ENCRYPTED_BACKUP_HEADER = 'ONEMAIL-REMOTE-BACKUP-V2\n'

export async function testBackupSync(input: BackupSyncSettings): Promise<BackupSyncTestResult> {
  const settings = resolveBackupSyncSettingsForMain(input)
  if (settings.provider === 'none') {
    throw new Error('请先选择 WebDAV 或 S3 远端类型。')
  }

  const remotePath =
    settings.provider === 'webdav' ? await testWebDavBackup(settings) : await testS3Backup(settings)

  return {
    provider: settings.provider,
    remotePath,
    testedAt: new Date().toISOString()
  }
}

export async function uploadBackupSync(
  options?: BackupExportOptions
): Promise<BackupSyncTransferResult> {
  const settings = requireBackupSyncSettings()
  const backup = createDatabaseSqlBackup(options)
  const protectedBackup = protectRemoteBackup(backup.sql, requireReadKey(settings))
  const remotePath =
    settings.provider === 'webdav'
      ? await uploadWebDavBackup(settings, protectedBackup)
      : await uploadS3Backup(settings, protectedBackup)

  return {
    provider: settings.provider,
    remotePath,
    fileName: backup.fileName,
    exportedAt: backup.exportedAt,
    transferredAt: new Date().toISOString()
  }
}

export async function downloadBackupSync(
  reportProgress?: BackupImportProgressReporter
): Promise<BackupSyncDownloadResult> {
  const settings = requireBackupSyncSettings()
  return downloadBackupSyncWithSettings(settings, reportProgress)
}

export async function downloadBackupSyncFromSettings(
  input: BackupSyncSettings,
  reportProgress?: BackupImportProgressReporter
): Promise<BackupSyncDownloadResult> {
  const settings = resolveBackupSyncSettingsForMain(input)
  if (settings.provider === 'none') {
    throw new Error('请先配置 WebDAV 或 S3 远端备份。')
  }

  return downloadBackupSyncWithSettings(settings, reportProgress)
}

async function downloadBackupSyncWithSettings(
  settings: ConfiguredBackupSyncSettings,
  reportProgress?: BackupImportProgressReporter
): Promise<BackupSyncDownloadResult> {
  reportProgress?.({
    source: settings.provider,
    stage: 'downloading_remote',
    percent: 15
  })
  const remote =
    settings.provider === 'webdav'
      ? await downloadWebDavBackup(settings)
      : await downloadS3Backup(settings)
  const sql = unprotectRemoteBackup(remote.sql, requireReadKey(settings))
  const imported = importDatabaseSqlBackupContent(sql, remote.sourceName, {
    source: settings.provider,
    remotePath: remote.remotePath,
    reportProgress
  })

  return {
    ...imported,
    provider: settings.provider,
    remotePath: remote.remotePath
  }
}

function requireReadKey(settings: ConfiguredBackupSyncSettings): string {
  const readKey = settings.readKey?.trim()
  if (!readKey) throw new Error('请先输入并保存数据读取密钥。')
  return readKey
}

export function protectRemoteBackup(sql: string, readKey: string): string {
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const key = scryptSync(readKey, salt, 32)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(sql, 'utf8'), cipher.final()])
  return `${ENCRYPTED_BACKUP_HEADER}${JSON.stringify({
    version: 2,
    algorithm: 'aes-256-gcm+scrypt',
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64')
  })}`
}

export function unprotectRemoteBackup(value: string, readKey: string): string {
  if (!value.startsWith(ENCRYPTED_BACKUP_HEADER)) {
    throw new Error('远端备份不是受读取密钥保护的新格式；本版本不兼容旧版明文远端备份。')
  }
  try {
    const payload = JSON.parse(value.slice(ENCRYPTED_BACKUP_HEADER.length)) as {
      version: number
      salt: string
      iv: string
      authTag: string
      ciphertext: string
    }
    if (payload.version !== 2) throw new Error('unsupported version')
    const key = scryptSync(readKey, Buffer.from(payload.salt, 'base64'), 32)
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(payload.iv, 'base64'))
    decipher.setAuthTag(Buffer.from(payload.authTag, 'base64'))
    return Buffer.concat([
      decipher.update(Buffer.from(payload.ciphertext, 'base64')),
      decipher.final()
    ]).toString('utf8')
  } catch {
    throw new Error('数据读取密钥错误，或远端备份内容已损坏。')
  }
}

function requireBackupSyncSettings(): ConfiguredBackupSyncSettings {
  const settings = getBackupSyncSettingsForMain()
  if (settings.provider === 'none') {
    throw new Error('请先配置 WebDAV 或 S3 远端同步。')
  }

  return settings
}

async function testWebDavBackup(
  settings: Extract<BackupSyncSettings, { provider: 'webdav' }>
): Promise<string> {
  const testUrl = getWebDavConnectionTestUrl(settings.remoteUrl)
  let created = false
  let actionError: unknown

  try {
    const putResponse = await fetch(testUrl, {
      method: 'PUT',
      headers: buildWebDavHeaders(settings, {
        'content-type': 'text/plain; charset=utf-8'
      }),
      body: CONNECTION_TEST_BODY
    })

    if (!putResponse.ok) {
      throw new Error(`WebDAV 连接测试失败：写入测试文件 HTTP ${putResponse.status}`)
    }
    created = true

    const getResponse = await fetch(testUrl, {
      method: 'GET',
      headers: buildWebDavHeaders(settings)
    })

    if (!getResponse.ok) {
      throw new Error(`WebDAV 连接测试失败：读取测试文件 HTTP ${getResponse.status}`)
    }
    if ((await getResponse.text()) !== CONNECTION_TEST_BODY) {
      throw new Error('WebDAV 连接测试失败：测试文件内容不匹配。')
    }
  } catch (error) {
    actionError = error
  }

  if (created) {
    await cleanupRemoteTestFile(
      () =>
        fetch(testUrl, {
          method: 'DELETE',
          headers: buildWebDavHeaders(settings)
        }),
      'WebDAV 连接测试文件清理失败',
      actionError
    )
  }

  if (actionError) throw actionError
  return settings.remoteUrl
}

async function uploadWebDavBackup(
  settings: Extract<BackupSyncSettings, { provider: 'webdav' }>,
  sql: string
): Promise<string> {
  const response = await fetch(settings.remoteUrl, {
    method: 'PUT',
    headers: buildWebDavHeaders(settings, {
      'content-type': 'application/sql; charset=utf-8'
    }),
    body: sql
  })

  if (!response.ok) {
    throw new Error(`WebDAV 上传失败：HTTP ${response.status}`)
  }

  return settings.remoteUrl
}

async function downloadWebDavBackup(
  settings: Extract<BackupSyncSettings, { provider: 'webdav' }>
): Promise<RemoteDownload> {
  const response = await fetch(settings.remoteUrl, {
    method: 'GET',
    headers: buildWebDavHeaders(settings)
  })

  if (!response.ok) {
    throw new Error(`WebDAV 下载失败：HTTP ${response.status}`)
  }

  return {
    sql: await response.text(),
    remotePath: settings.remoteUrl,
    sourceName: new URL(settings.remoteUrl).pathname.split('/').at(-1) ?? 'onemail-backup.sql'
  }
}

function buildWebDavHeaders(
  settings: Extract<BackupSyncSettings, { provider: 'webdav' }>,
  headers: Record<string, string> = {}
): Record<string, string> {
  const nextHeaders = { ...headers }

  if (settings.username || settings.password) {
    nextHeaders.authorization = `Basic ${Buffer.from(
      `${settings.username ?? ''}:${settings.password ?? ''}`,
      'utf8'
    ).toString('base64')}`
  }

  return nextHeaders
}

function getWebDavConnectionTestUrl(remoteUrl: string): string {
  const url = new URL(remoteUrl)
  const parentPath = url.pathname.split('/').slice(0, -1).join('/')
  url.pathname = joinUrlPath(parentPath, createConnectionTestFileName())
  return url.toString()
}

async function testS3Backup(
  settings: Extract<BackupSyncSettings, { provider: 's3' }>
): Promise<string> {
  const testSettings = { ...settings, key: getS3ConnectionTestKey(settings.key) }
  let created = false
  let actionError: unknown

  try {
    const putResponse = await signedS3Request(testSettings, 'PUT', CONNECTION_TEST_BODY)
    if (!putResponse.ok) {
      throw new Error(`S3 连接测试失败：写入测试文件 HTTP ${putResponse.status}`)
    }
    created = true

    const getResponse = await signedS3Request(testSettings, 'GET')
    if (!getResponse.ok) {
      throw new Error(`S3 连接测试失败：读取测试文件 HTTP ${getResponse.status}`)
    }
    if ((await getResponse.text()) !== CONNECTION_TEST_BODY) {
      throw new Error('S3 连接测试失败：测试文件内容不匹配。')
    }
  } catch (error) {
    actionError = error
  }

  if (created) {
    await cleanupRemoteTestFile(
      () => signedS3Request(testSettings, 'DELETE'),
      'S3 连接测试文件清理失败',
      actionError
    )
  }

  if (actionError) throw actionError
  return buildS3ObjectUrl(settings).toString()
}

async function uploadS3Backup(
  settings: Extract<BackupSyncSettings, { provider: 's3' }>,
  sql: string
): Promise<string> {
  const response = await signedS3Request(settings, 'PUT', sql)

  if (!response.ok) {
    throw new Error(`S3 上传失败：HTTP ${response.status}`)
  }

  return buildS3ObjectUrl(settings).toString()
}

async function downloadS3Backup(
  settings: Extract<BackupSyncSettings, { provider: 's3' }>
): Promise<RemoteDownload> {
  const response = await signedS3Request(settings, 'GET')

  if (!response.ok) {
    throw new Error(`S3 下载失败：HTTP ${response.status}`)
  }

  return {
    sql: await response.text(),
    remotePath: buildS3ObjectUrl(settings).toString(),
    sourceName: settings.key.split('/').at(-1) ?? 'onemail-backup.sql'
  }
}

async function signedS3Request(
  settings: Extract<BackupSyncSettings, { provider: 's3' }>,
  method: 'GET' | 'PUT' | 'DELETE',
  body = ''
): Promise<Response> {
  const url = buildS3ObjectUrl(settings)
  const now = new Date()
  const amzDate = formatAmzDate(now)
  const dateStamp = amzDate.slice(0, 8)
  const payloadHash = method === 'PUT' ? sha256(body) : EMPTY_SHA256
  const headers: Record<string, string> = {
    host: url.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate
  }

  if (method === 'PUT') {
    headers['content-type'] = 'application/sql; charset=utf-8'
  }

  headers.authorization = createS3Authorization({
    settings,
    method,
    url,
    headers,
    payloadHash,
    dateStamp,
    amzDate
  })

  return fetch(url, {
    method,
    headers,
    body: method === 'PUT' ? body : undefined
  })
}

function createS3Authorization({
  settings,
  method,
  url,
  headers,
  payloadHash,
  dateStamp,
  amzDate
}: {
  settings: Extract<BackupSyncSettings, { provider: 's3' }>
  method: 'GET' | 'PUT' | 'DELETE'
  url: URL
  headers: Record<string, string>
  payloadHash: string
  dateStamp: string
  amzDate: string
}): string {
  const region = settings.region || 'us-east-1'
  const credentialScope = `${dateStamp}/${region}/s3/aws4_request`
  const signedHeaderNames = Object.keys(headers)
    .map((header) => header.toLowerCase())
    .sort()
  const canonicalHeaders = signedHeaderNames
    .map((header) => `${header}:${headers[header].trim().replace(/\s+/g, ' ')}`)
    .join('\n')
  const signedHeaders = signedHeaderNames.join(';')
  const canonicalRequest = [
    method,
    url.pathname || '/',
    url.searchParams.toString(),
    `${canonicalHeaders}\n`,
    signedHeaders,
    payloadHash
  ].join('\n')
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256(canonicalRequest)
  ].join('\n')
  const signature = hmacHex(
    deriveS3SigningKey(settings.secretAccessKey ?? '', dateStamp, region),
    stringToSign
  )

  return `AWS4-HMAC-SHA256 Credential=${settings.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
}

function deriveS3SigningKey(secretAccessKey: string, dateStamp: string, region: string): Buffer {
  const dateKey = hmacBuffer(`AWS4${secretAccessKey}`, dateStamp)
  const regionKey = hmacBuffer(dateKey, region)
  const serviceKey = hmacBuffer(regionKey, 's3')
  return hmacBuffer(serviceKey, 'aws4_request')
}

function buildS3ObjectUrl(settings: Extract<BackupSyncSettings, { provider: 's3' }>): URL {
  const keyPath = encodeS3Path(settings.key)

  if (settings.endpoint) {
    const endpoint = new URL(settings.endpoint)
    endpoint.pathname = joinUrlPath(endpoint.pathname, settings.bucket, keyPath)
    endpoint.search = ''
    return endpoint
  }

  return new URL(
    `https://${settings.bucket}.s3.${settings.region || 'us-east-1'}.amazonaws.com/${keyPath}`
  )
}

function getS3ConnectionTestKey(key: string): string {
  const parentParts = key.split('/').filter(Boolean).slice(0, -1)
  return [...parentParts, createConnectionTestFileName()].join('/')
}

function createConnectionTestFileName(): string {
  return `.onemail-connection-test-${randomUUID()}.txt`
}

async function cleanupRemoteTestFile(
  cleanup: () => Promise<Response>,
  failureLabel: string,
  existingError: unknown
): Promise<void> {
  try {
    const response = await cleanup()
    if (!response.ok && response.status !== 404 && !existingError) {
      throw new Error(`${failureLabel}：HTTP ${response.status}`)
    }
  } catch (error) {
    if (!existingError) throw error
  }
}

function encodeS3Path(value: string): string {
  return value
    .split('/')
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join('/')
}

function joinUrlPath(...parts: string[]): string {
  const joined = parts
    .flatMap((part) => part.split('/'))
    .filter(Boolean)
    .join('/')

  return `/${joined}`
}

function formatAmzDate(date: Date): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, '')
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function hmacBuffer(key: string | Buffer, value: string): Buffer {
  return createHmac('sha256', key).update(value, 'utf8').digest()
}

function hmacHex(key: string | Buffer, value: string): string {
  return createHmac('sha256', key).update(value, 'utf8').digest('hex')
}
