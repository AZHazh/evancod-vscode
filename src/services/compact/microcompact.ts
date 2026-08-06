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
  const toCompact = toolResults.slice(0, -keepRecent)
  const compacted = [...messages]

  for (const { index, message } of toCompact) {
    compacted[index] = {
      ...message,
      // 占位符必须告诉模型「这次调用已经发生过」，否则模型会认为自己还没读过，
      // 从而重复调用同一个工具，形成死循环。
      content: `[${message.toolName} 的结果正文已因上下文超限被省略。该调用已成功执行过，不要为了重新获取内容而重复调用；只有确实必须重新查看时才再次调用。]`,
      // content 被清理时 contentBlocks 也必须一起清理：
      // API 层（convertAnthropicMessages）优先使用 contentBlocks，
      // 若留着旧 blocks，占位符不会生效，压缩也就没有实际省下 token。
      contentBlocks: undefined,
    }
  }

  return compacted
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
