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

/**
 * Microcompact - 便宜的预压缩
 * 清理旧的工具结果内容，避免触发昂贵的模型摘要
 *
 * @param messages 原始消息数组
 * @param keepRecent 保留最近 N 个工具结果
 * @returns 压缩后的消息数组
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
  const toCompact = toolResults.slice(0, -keepRecent)
  const compacted = [...messages]

  for (const { index, message } of toCompact) {
    compacted[index] = {
      ...message,
      content: '[Tool result content cleared by microcompact]',
    }
  }

  return compacted
}
