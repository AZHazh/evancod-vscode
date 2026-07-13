/**
 * 消息分组和排序工具
 *
 * 将 transcript 中的消息按「轮次」（以用户消息为界）分组，
 * 组内保持**原始时间顺序**交错渲染：
 *   thinking → assistant_text → tool_use(+tool_result) → thinking → assistant_text → tool_use …
 *
 * 这样模型的文字回答与工具调用交叉出现，和主流 AI 编辑器一致，
 * 避免所有文字堆在上方、工具堆在下方产生的割裂感。
 */

import type { UIMessage } from '../types'

interface OrderedItem {
  /** 在原始 transcript 中的位置，用于稳定的交错排序 */
  order: number
  block: UIMessage
  /** tool_use 对应的结果，渲染时紧跟其后 */
  toolResult?: UIMessage
}

interface MessageGroup {
  user?: UIMessage
  items: OrderedItem[]
}

/**
 * 将 transcript 按用户消息分组（每个用户消息及其后续的助手响应为一组），
 * 组内所有块记录其原始顺序，tool_result 归并到对应的 tool_use。
 */
export function groupMessages(transcript: UIMessage[]): MessageGroup[] {
  const groups: MessageGroup[] = []
  let currentGroup: MessageGroup | null = null

  transcript.forEach((block, index) => {
    if (block.type === 'user_text') {
      // 新的用户消息，开启新组
      if (currentGroup) {
        groups.push(currentGroup)
      }
      currentGroup = { user: block, items: [] }
      return
    }

    if (!currentGroup) {
      // 没有用户消息，创建一个空组（边缘情况）
      currentGroup = { items: [] }
    }

    if (block.type === 'tool_result') {
      // 归并到对应的 tool_use，不作为独立项
      const resultBlock = block as Extract<UIMessage, { type: 'tool_result' }>
      const toolEntry = currentGroup.items.find(
        item => item.block.type === 'tool_use' && item.block.toolUseId === resultBlock.toolUseId
      )
      if (toolEntry) {
        toolEntry.toolResult = resultBlock
      } else {
        // 找不到匹配的 tool_use，仍按原顺序保留，避免结果丢失
        currentGroup.items.push({ order: index, block })
      }
      return
    }

    // thinking / assistant_text / tool_use / image_generation / permission_request
    currentGroup.items.push({ order: index, block })
  })

  if (currentGroup) {
    groups.push(currentGroup)
  }

  return groups
}

/**
 * 将分组后的消息重新展平，组内按原始顺序交错排列，
 * tool_result 紧跟其 tool_use。
 */
export function flattenGroups(groups: MessageGroup[]): UIMessage[] {
  const result: UIMessage[] = []

  for (const group of groups) {
    if (group.user) {
      result.push(group.user)
    }

    const orderedItems = [...group.items].sort((a, b) => a.order - b.order)
    for (const item of orderedItems) {
      result.push(item.block)
      if (item.toolResult) {
        result.push(item.toolResult)
      }
    }
  }

  return result
}

/**
 * 主入口：对 transcript 进行分组并按原始时间顺序交错展平
 */
export function reorderTranscript(transcript: UIMessage[]): UIMessage[] {
  const groups = groupMessages(transcript)
  return flattenGroups(groups)
}
