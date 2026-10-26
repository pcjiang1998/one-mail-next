export const REMOTE_MESSAGE_MISSING_NOTICE =
  '远端原位置已不存在，已停止远端写回；邮件仅在本地保留。'

export const REMOTE_MESSAGE_MISSING_BODY_ERROR =
  '远端原位置已不存在，且本地未缓存正文，无法加载邮件内容。'

export class RemoteMessageMissingError extends Error {
  constructor() {
    super(REMOTE_MESSAGE_MISSING_NOTICE)
    this.name = 'RemoteMessageMissingError'
  }
}
