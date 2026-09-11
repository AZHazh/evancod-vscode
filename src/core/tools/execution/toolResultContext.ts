import * as crypto from 'crypto'
import * as fs from 'fs/promises'
import * as path from 'path'

const MAX_INLINE_RESULT_BYTES = 64 * 1024
const HEAD_PREVIEW_CHARS = 12_000
const TAIL_PREVIEW_CHARS = 4_000

export interface ContextToolResult {
  content: string
  archivedPath?: string
  originalBytes: number
}

/**
 * 将超长工具结果完整归档，只把可恢复的头尾预览送回模型。
 * 归档失败时返回原文，宁可多用 token 也不丢失能力。
 */
export async function prepareToolResultForContext(
  cwd: string,
  toolUseId: string,
  toolName: string,
  content: string
): Promise<ContextToolResult> {
  const originalBytes = Buffer.byteLength(content, 'utf8')
  if (originalBytes <= MAX_INLINE_RESULT_BYTES) {
    return { content, originalBytes }
  }

  const safeId = toolUseId.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100) || 'result'
  const digest = crypto.createHash('sha256').update(content).digest('hex').slice(0, 16)
  const relativePath = path.posix.join(
    '.tmp',
    'evancod-tool-results',
    `${safeId}-${digest}.txt`
  )
  const absolutePath = path.join(cwd, ...relativePath.split('/'))

  try {
    await fs.mkdir(path.dirname(absolutePath), { recursive: true })
    await fs.writeFile(absolutePath, content, 'utf8')
  } catch (error) {
    console.warn('[ToolResultContext] 归档超长工具结果失败，回退为完整回灌:', error)
    return { content, originalBytes }
  }

  const head = content.slice(0, HEAD_PREVIEW_CHARS)
  const tail = content.slice(-TAIL_PREVIEW_CHARS)
  const bounded = [
    `[${toolName} 结果过长：${originalBytes} 字节；以下仅展示头尾预览。]`,
    `完整原文已保存到 ${relativePath}（SHA-256: ${digest}）。`,
    `需要中间内容时使用 read_file 按 offset/limit 分段读取该文件，不要重新执行原工具。`,
    '',
    '--- 结果开头 ---',
    head,
    '',
    '--- 中间内容已省略，可从归档文件读取 ---',
    '',
    '--- 结果结尾 ---',
    tail,
  ].join('\n')

  return { content: bounded, archivedPath: relativePath, originalBytes }
}
