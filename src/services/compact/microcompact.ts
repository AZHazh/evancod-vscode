import type { Message } from '../../types'

/**
 * 可压缩的工具列表
 * 这些工具的结果内容可以被清理，保留最近的几个
 */
const COMPACTABLE_TOOLS = new Set([
  'read_file',
  'bash',
  'grep',
  'glob',
  'web_search',
  'web_fetch',
  'edit_file',
  'write_file',
  'list_directory',
  'find',
  'lsp',
])

const PROTECTED_RESULT_PATTERN =
  /"success"\s*:\s*false|\b(error|failed|failure|timeout|cancelled)\b|错误|失败|超时|取消/i

const OLD_RESULT_HEAD_CHARS = 1000
const OLD_RESULT_TAIL_CHARS = 400

/**
 * 估算消息数组的 token 数（粗略：约 4 字符 = 1 token）。
 * 仅用于判断是否需要 microcompact，不追求精确。
 */
export function estimateMessagesTokens(messages: Message[]): number {
  let chars = 0

  for (const message of messages) {
    chars += message.content?.length || 0

    for (const block of message.contentBlocks || []) {
      chars += block.text?.length || 0
      // base64 图片按其编码长度计入，避免大图被低估
      chars += block.source?.data?.length || 0
    }

    for (const toolCall of message.toolCalls || []) {
      chars += JSON.stringify(toolCall.input ?? toolCall.args ?? '').length
    }
  }

  return Math.ceil(chars / 4)
}

/**
 * Microcompact - 便宜的预压缩
 * 清理旧的工具结果内容，避免触发昂贵的模型摘要
 *
 * 注意：这是有损操作，会永久丢弃工具结果正文。调用方必须：
 * 1. 只在上下文确实接近窗口上限时调用（见 shouldMicrocompact）；
 * 2. 作用于「发给 API 的副本」，不要覆盖会话真实历史，否则历史无法恢复。
 *
 * @param messages 原始消息数组
 * @param keepRecent 保留最近 N 个工具结果
 * @returns 压缩后的消息数组（新数组，不修改入参）
 */
export function microcompact(messages: Message[], keepRecent = 5): Message[] {
  // 找出所有可压缩工具结果
  const toolResults: Array<{ index: number; message: Message }> = []

  messages.forEach((msg, index) => {
    if (msg.role === 'tool' && msg.toolName && COMPACTABLE_TOOLS.has(msg.toolName)) {
      toolResults.push({ index, message: msg })
    }
  })

  // 如果可压缩结果少于等于保留数量，无需压缩
  if (toolResults.length <= keepRecent) {
    return messages
  }

  // 保留最近 N 个，其余内容替换
  const recentIndexes = new Set(toolResults.slice(-keepRecent).map(item => item.index))
  const toCompact = toolResults.filter(
    item => !recentIndexes.has(item.index) && !PROTECTED_RESULT_PATTERN.test(item.message.content || '')
  )
  const compacted = [...messages]

  for (const { index, message } of toCompact) {
    compacted[index] = {
      ...message,
      content: summarizeOldToolResult(message.toolName || 'tool', message.content || ''),
      // content 被清理时 contentBlocks 也必须一起清理：
      // API 层（convertAnthropicMessages）优先使用 contentBlocks，
      // 若留着旧 blocks，占位符不会生效，压缩也就没有实际省下 token。
      contentBlocks: undefined,
    }
  }

  return compacted
}

/** 保留旧结果的关键头尾与恢复说明，避免无信息占位导致模型重复探查。 */
export function summarizeOldToolResult(toolName: string, content: string): string {
  if (content.length <= OLD_RESULT_HEAD_CHARS + OLD_RESULT_TAIL_CHARS) {
    return content
  }

  return [
    `[${toolName} 的旧结果已因上下文接近上限而压缩；原调用已成功执行。]`,
    '如下面摘要不足，可使用原调用参数重新读取；若摘要包含归档路径，优先读取归档文件，不要重新执行昂贵命令。',
    '',
    '--- 原结果开头 ---',
    content.slice(0, OLD_RESULT_HEAD_CHARS),
    '',
    '--- 中间已省略 ---',
    '',
    '--- 原结果结尾 ---',
    content.slice(-OLD_RESULT_TAIL_CHARS),
  ].join('\n')
}

/**
 * 判断是否需要 microcompact。
 *
 * microcompact 会丢弃工具结果正文，属于有损操作，只应在上下文真的吃紧时执行。
 * 无条件执行会让模型看不到自己刚读过的文件，进而反复重读同一批文件。
 *
 * @param estimatedTokens 当前上下文的估算 token 数
 * @param effectiveWindow 模型的有效上下文窗口
 * @param ratio 触发阈值占比，默认 0.8
 */
export function shouldMicrocompact(
  estimatedTokens: number,
  effectiveWindow: number,
  ratio = 0.8
): boolean {
  if (effectiveWindow <= 0) return false
  return estimatedTokens >= effectiveWindow * ratio
}
