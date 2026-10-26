import { Socket } from 'node:net'
import { TLSSocket, connect as connectTls } from 'node:tls'
import type { AccountCreateInput, MailAccount } from '../ipc/types'
import { connectMailSocket } from '../services/network-proxy'

type PopAccount = Pick<
  MailAccount,
  | 'email'
  | 'popHost'
  | 'popPort'
  | 'popSecurity'
  | 'imapHost'
  | 'imapPort'
  | 'imapSecurity'
  | 'proxyMode'
  | 'customProxyUrl'
>
type PopInput = Pick<
  AccountCreateInput,
  | 'email'
  | 'popHost'
  | 'popPort'
  | 'popSecurity'
  | 'imapHost'
  | 'imapPort'
  | 'imapSecurity'
  | 'proxyMode'
  | 'customProxyUrl'
>

const RESPONSE_TIMEOUT_MS = 30000

export class Pop3Session {
  private topSupported = true
  private constructor(private socket: Socket | TLSSocket) {}

  static async connect(account: PopAccount | PopInput): Promise<Pop3Session> {
    const host = account.popHost || account.imapHost
    const port = account.popPort || (account.popSecurity === 'ssl_tls' ? 995 : 110)
    const security = account.popSecurity ?? account.imapSecurity
    let socket = await connectMailSocket(account, host, port, security === 'ssl_tls')
    const session = new Pop3Session(socket)
    await session.readPositiveLine('POP3 服务器拒绝连接')

    if (security === 'starttls') {
      await session.single('STLS')
      socket = await upgradeToTls(socket as Socket, host)
      session.socket = socket
    }
    return session
  }

  async login(username: string, password: string): Promise<void> {
    await this.single(`USER ${sanitizeArgument(username)}`)
    await this.single(`PASS ${sanitizeArgument(password)}`)
  }

  async listUniqueIds(): Promise<Array<{ number: number; uidl: string }>> {
    const response = await this.multi('UIDL')
    return response
      .split(/\r?\n/)
      .map((line) => /^(\d+)\s+(.+)$/.exec(line.trim()))
      .filter((match): match is RegExpExecArray => Boolean(match))
      .map((match) => ({ number: Number(match[1]), uidl: match[2] }))
      .filter((item) => Number.isInteger(item.number) && item.number > 0)
  }

  async retrieve(number: number): Promise<string> {
    if (!Number.isInteger(number) || number <= 0) throw new Error('POP3 邮件编号无效。')
    return this.multi(`RETR ${number}`)
  }

  async retrieveHeaders(number: number): Promise<string | undefined> {
    if (!this.topSupported) return undefined
    if (!Number.isSafeInteger(number) || number <= 0) throw new Error('POP3 邮件编号无效。')
    try {
      return await this.multi(`TOP ${number} 0`)
    } catch (error) {
      if (!(error instanceof Pop3NegativeResponseError)) throw error
      this.topSupported = false
      return undefined
    }
  }

  async listSizes(): Promise<Map<number, number>> {
    const response = await this.multi('LIST')
    const sizes = new Map<number, number>()
    for (const line of response.split(/\r?\n/)) {
      const match = /^(\d+)\s+(\d+)$/.exec(line.trim())
      if (match) sizes.set(Number(match[1]), Number(match[2]))
    }
    return sizes
  }

  async quit(): Promise<void> {
    if (this.socket.destroyed) return
    await this.single('QUIT').catch(() => undefined)
    this.socket.destroy()
  }

  private async single(command: string): Promise<string> {
    await writeLine(this.socket, command)
    return this.readPositiveLine(`POP3 命令失败：${command.split(' ')[0]}`)
  }

  private async multi(command: string): Promise<string> {
    await writeLine(this.socket, command)
    const first = await this.readPositiveLine(`POP3 命令失败：${command.split(' ')[0]}`)
    void first
    const payload = await readUntil(this.socket, Buffer.from('\r\n.\r\n'))
    return payload
      .subarray(0, Math.max(0, payload.length - 5))
      .toString('utf8')
      .replace(/^\.\./gm, '.')
  }

  private async readPositiveLine(errorPrefix: string): Promise<string> {
    const line = (await readUntil(this.socket, Buffer.from('\r\n'))).toString('utf8').trim()
    if (line.startsWith('-ERR'))
      throw new Pop3NegativeResponseError(`${errorPrefix}：${line.slice(0, 240)}`)
    if (!line.startsWith('+OK')) throw new Error(`${errorPrefix}：${line.slice(0, 240)}`)
    return line.slice(3).trim()
  }
}

class Pop3NegativeResponseError extends Error {}

export async function testPop3Connection(input: AccountCreateInput): Promise<void> {
  if (!input.email?.trim()) throw new Error('请输入邮箱地址。')
  const password = input.password?.trim()
  if (!password) throw new Error('请输入邮箱授权码或密码。')
  const session = await Pop3Session.connect(input)
  try {
    await session.login(input.email, password)
    await session.listUniqueIds()
  } finally {
    await session.quit()
  }
}

function sanitizeArgument(value: string): string {
  if (/\r|\n/.test(value)) throw new Error('POP3 登录参数无效。')
  return value
}

function writeLine(socket: Socket | TLSSocket, value: string): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.write(`${value}\r\n`, (error) => (error ? reject(error) : resolve()))
  })
}

function readUntil(socket: Socket | TLSSocket, marker: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0)
    const timeout = setTimeout(
      () => finish(new Error('POP3 服务器响应超时。')),
      RESPONSE_TIMEOUT_MS
    )
    const onData = (chunk: Buffer): void => {
      buffer = Buffer.concat([buffer, chunk])
      const index = buffer.indexOf(marker)
      if (index >= 0) finish(undefined, index + marker.length)
    }
    const onError = (error: Error): void => finish(error)
    const onClose = (): void => finish(new Error('POP3 连接已断开。'))
    function finish(error?: Error, size = 0): void {
      clearTimeout(timeout)
      socket.off('data', onData)
      socket.off('error', onError)
      socket.off('close', onClose)
      if (error) {
        reject(error)
        return
      }
      const value = buffer.subarray(0, size)
      const remainder = buffer.subarray(size)
      if (remainder.length) socket.unshift(remainder)
      resolve(value)
    }
    socket.on('data', onData)
    socket.once('error', onError)
    socket.once('close', onClose)
  })
}

function upgradeToTls(socket: Socket, servername: string): Promise<TLSSocket> {
  return new Promise((resolve, reject) => {
    const tlsSocket = connectTls({ socket, servername, rejectUnauthorized: true })
    const timeout = setTimeout(
      () => finish(new Error('POP3 STARTTLS 握手超时。')),
      RESPONSE_TIMEOUT_MS
    )
    const onSecure = (): void => finish()
    const onError = (error: Error): void => finish(error)
    function finish(error?: Error): void {
      clearTimeout(timeout)
      tlsSocket.off('secureConnect', onSecure)
      tlsSocket.off('error', onError)
      if (error) reject(error)
      else resolve(tlsSocket)
    }
    tlsSocket.once('secureConnect', onSecure)
    tlsSocket.once('error', onError)
  })
}
