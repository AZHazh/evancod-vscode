/**
 * 消息分组和排序工具
 *
 * 将 transcript 中的消息按「轮次」分组，并在每轮内重新排序：
 * 1. thinking（如果有）
 * 2. tool_use + tool_result（按调用顺序）
 * 3. assistant_text（最终回答）
 *
 * 这样用户先看到工具调用过程，最后看到结论，体验更好。
 */

import type { UIMessage } from '../types'

interface MessageGroup {
  user?: UIMessage
  thinking?: UIMessage
  tools: Array<{
    toolUse: UIMessage
    toolResult?: UIMessage
  }>
  images: UIMessage[]
  assistantTexts: UIMessage[]
  permissionRequests: UIMessage[]
}

/**
 * 将 transcript 按用户消息分组（每个用户消息及其后续的助手响应为一组）
 */
export function groupMessages(transcript: UIMessage[]): MessageGroup[] {
  const groups: MessageGroup[] = []
  let currentGroup: MessageGroup | null = null

  for (const block of transcript) {
    if (block.type === 'user_text') {
      // 新的用户消息，开启新组
      if (currentGroup) {
        groups.push(currentGroup)
      }
      currentGroup = {
        user: block,
        tools: [],
        images: [],
        assistantTexts: [],
        permissionRequests: [],
      }
      continue
    }

    if (!currentGroup) {
      // 没有用户消息，创建一个空组（边缘情况）
      currentGroup = {
        tools: [],
        images: [],
        assistantTexts: [],
        permissionRequests: [],
      }
    }

    switch (block.type) {
      case 'thinking':
        currentGroup.thinking = block
        break

      case 'tool_use': {
        // 查找对应的 tool_result
        const toolUseBlock = block as Extract<UIMessage, { type: 'tool_use' }>
        currentGroup.tools.push({
          toolUse: toolUseBlock,
          toolResult: undefined, // 稍后匹配
        })
        break
      }

      case 'tool_result': {
        const resultBlock = block as Extract<UIMessage, { type: 'tool_result' }>
        // 找到对应的 tool_use
        const toolEntry = currentGroup.tools.find(t => t.toolUse.type === 'tool_use' && t.toolUse.toolUseId === resultBlock.toolUseId)
        if (toolEntry) {
          toolEntry.toolResult = resultBlock
        }
        break
      }

      case 'assistant_text':
        currentGroup.assistantTexts.push(block)
        break

      case 'image_generation':
        currentGroup.images.push(block)
        break

      case 'permission_request':
        currentGroup.permissionRequests.push(block)
        break
    }
  }

  if (currentGroup) {
    groups.push(currentGroup)
  }

  return groups
}

/**
 * 将分组后的消息重新展平，按理想顺序排列
 */
export function flattenGroups(groups: MessageGroup[]): UIMessage[] {
  const result: UIMessage[] = []

  for (const group of groups) {
    // 1. 用户消息
    if (group.user) {
      result.push(group.user)
    }

    // 2. thinking（如果有）
    if (group.thinking) {
      result.push(group.thinking)
    }

    // 3. 权限请求（紧跟工具调用前）
    for (const permReq of group.permissionRequests) {
      result.push(permReq)
    }

    // 4. 工具调用 + 结果（成对出现）
    for (const { toolUse, toolResult } of group.tools) {
      result.push(toolUse)
      if (toolResult) {
        result.push(toolResult)
      }
    }

    // 5. 生成图片（在最终回答之前展示）
    for (const image of group.images) {
      result.push(image)
    }

    // 6. 助手文本（最终回答）
    for (const text of group.assistantTexts) {
      result.push(text)
    }
  }

  return result
}

/**
 * 主入口：对 transcript 进行智能排序
 */
export function reorderTranscript(transcript: UIMessage[]): UIMessage[] {
  const groups = groupMessages(transcript)
  return flattenGroups(groups)
}
