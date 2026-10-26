let activeTasks = 0
const restoreListeners = new Set<() => void>()

export async function withDatabaseTask<T>(run: () => T | Promise<T>): Promise<T> {
  activeTasks += 1
  try {
    return await run()
  } finally {
    activeTasks -= 1
  }
}

export function assertDatabaseIdle(): void {
  if (activeTasks !== 0) {
    throw new Error('邮件或设置任务仍在执行，暂时无法恢复备份。请等待任务完成后重试。')
  }
}

export function onDatabaseRestored(listener: () => void): void {
  restoreListeners.add(listener)
}

export function notifyDatabaseRestored(): void {
  for (const listener of restoreListeners) listener()
}
