import type { UIMessage } from '../types'
import type { ActivityItem } from './activityGrouping'

type AssistantMessage = Extract<UIMessage, { type: 'assistant_text' }>

export interface TurnActivityGroup {
  id: string
  type: 'turn_activity_group'
  items: ActivityItem[]
  startedAt: number
  endedAt: number
}

export type ConversationItem = ActivityItem | TurnActivityGroup

export function isFinalAnswer(message: ActivityItem): message is AssistantMessage {
  return (
    message.type === 'assistant_text' &&
    message.phase === 'final' &&
    message.status !== 'streaming' &&
    message.status !== 'interrupted'
  )
}

function messagesIn(item: ActivityItem): UIMessage[] {
  return item.type === 'tool_activity_group' ? item.messages : [item]
}

function needsAttention(item: ActivityItem): boolean {
  return messagesIn(item).some(message => {
    if (message.type === 'interaction_request') {
      return !message.responseState || message.responseState === 'pending'
    }
    if (message.type === 'plan_approval') return message.plan.state === 'planning'
    return false
  })
}

/** 完成后只改变展示投影，原始消息、交互和工具记录仍保持完整。 */
export function groupCompletedTurns(
  items: ActivityItem[],
  isRunning: boolean
): ConversationItem[] {
  const result: ConversationItem[] = []
  let pending: ActivityItem[] = []
  let startedAt: number | undefined

  function complete(final: AssistantMessage) {
    if (!pending.length || pending.some(needsAttention)) {
      result.push(...pending, final)
      pending = []
      startedAt = undefined
      return
    }

    // 图片是本轮产物，完成后仍留在最终答复旁，避免被过程折叠隐藏。
    const process = pending.filter(item => item.type !== 'image_generation')
    const images = pending.filter(item => item.type === 'image_generation')
    if (process.length) {
      const timestamps = process
        .flatMap(messagesIn)
        .map(message => message.timestamp)
        .filter(Number.isFinite)
      const start = startedAt ?? timestamps[0] ?? final.timestamp
      const end = timestamps.reduce(
        (latest, time) => Math.max(latest, time),
        final.endedAt ?? final.timestamp
      )
      result.push({
        id: `turn:${final.id}`,
        type: 'turn_activity_group',
        items: process,
        startedAt: start,
        endedAt: Math.max(start, end),
      })
    }
    result.push(...images, final)
    pending = []
    startedAt = undefined
  }

  function flush(allowLegacyFinal: boolean) {
    const last = pending.at(-1)
    // 旧会话没有阶段字段时，仅将已结束轮次最后的无状态正文视为答复。
    // 明确中断或仍在流式输出的记录始终保留原展示，不推断为完成。
    const interrupted = pending.some(item =>
      messagesIn(item).some(
        message =>
          (message.type === 'assistant_text' &&
            (message.status === 'interrupted' || message.status === 'streaming')) ||
          (message.type === 'tool_use' && message.isPending)
      )
    )
    if (
      allowLegacyFinal &&
      !interrupted &&
      last?.type === 'assistant_text' &&
      last.phase === undefined &&
      last.status === undefined
    ) {
      pending.pop()
      complete({ ...last, phase: 'final' })
    } else {
      result.push(...pending)
      pending = []
    }
  }

  for (const item of items) {
    if (item.type === 'user_text') {
      flush(true)
      result.push(item)
      startedAt = item.timestamp
    } else if (isFinalAnswer(item)) {
      complete(item)
    } else {
      pending.push(item)
    }
  }
  flush(!isRunning)
  return result
}
