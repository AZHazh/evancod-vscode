import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

let logPath = path.join(os.tmpdir(), 'evancod-performance.log')
let pendingWrite: Promise<void> = Promise.resolve()
let eventLoopTimer: NodeJS.Timeout | undefined

export function initializePerformanceLogger(workspaceRoot?: string): string {
  logPath = workspaceRoot ? path.join(workspaceRoot, '.evancod', 'performance.log') : path.join(os.tmpdir(), 'evancod-performance.log')
  pendingWrite = pendingWrite.then(async () => {
    await fs.promises.mkdir(path.dirname(logPath), { recursive: true })
    await fs.promises.appendFile(logPath, '\n=== Evancod performance session ' + new Date().toISOString() + ' ===\n', 'utf8')
  }).catch(() => undefined)
  if (!eventLoopTimer) {
    let expected = Date.now() + 1000
    eventLoopTimer = setInterval(() => {
      const now = Date.now()
      const lagMs = Math.max(0, now - expected)
      if (lagMs >= 50) performanceLog('eventLoop.lag', { lagMs })
      expected = now + 1000
    }, 1000)
    eventLoopTimer.unref()
  }
  return logPath
}

export function performanceLog(event: string, data: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ time: new Date().toISOString(), event, ...data })
  pendingWrite = pendingWrite.then(() => fs.promises.appendFile(logPath, line + '\n', 'utf8')).catch(() => undefined)
}

export function performanceSnapshot(): Record<string, unknown> {
  const memory = process.memoryUsage()
  const cpu = process.cpuUsage()
  return { cpuUserMs: Math.round(cpu.user / 1000), cpuSystemMs: Math.round(cpu.system / 1000), rssMb: Math.round((memory.rss / 1024 / 1024) * 10) / 10, heapUsedMb: Math.round((memory.heapUsed / 1024 / 1024) * 10) / 10, heapTotalMb: Math.round((memory.heapTotal / 1024 / 1024) * 10) / 10 }
}

export async function performanceMeasure<T>(event: string, action: () => Promise<T>, data: Record<string, unknown> = {}): Promise<T> {
  const startedAt = performance.now()
  try {
    const result = await action()
    performanceLog(event, { ...data, durationMs: Math.round(performance.now() - startedAt), ...performanceSnapshot() })
    return result
  } catch (error) {
    performanceLog(event + '.error', { ...data, durationMs: Math.round(performance.now() - startedAt), error: error instanceof Error ? error.message : String(error), ...performanceSnapshot() })
    throw error
  }
}
