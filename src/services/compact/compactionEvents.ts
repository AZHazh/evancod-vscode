import type { AgentTranscriptBlock } from '../../types'
import type { AgentServerEvent } from '../../types/messages'

type SystemNotification = Extract<AgentServerEvent, { type: 'system_notification' }>

/** 将一次压缩的开始和结果写入同一条会话记录，固定其发生位置。 */
export function recordCompactionEvent(
  transcript: AgentTranscriptBlock[],
  event: SystemNotification,
  createId: () => string,
  now = Date.now()
): SystemNotification {
  const data = (event.data || {}) as Record<string, unknown>
  const started = event.subtype === 'compact_started'
  const pending = started
    ? undefined
    : [...transcript].reverse().find(
        (block): block is Extract<AgentTranscriptBlock, { type: 'context_compaction' }> =>
          block.type === 'context_compaction' && block.status === 'compacting'
      )
  const automatic = pending?.automatic ?? data.automatic !== false
  const status = started ? 'compacting' : data.success === false ? 'failed' : 'completed'
  const block: Extract<AgentTranscriptBlock, { type: 'context_compaction' }> = {
    id: pending?.id || createId(),
    type: 'context_compaction',
    status,
    message:
      typeof data.message === 'string'
        ? data.message
        : started
          ? '上下文正在压缩'
          : status === 'failed'
            ? '上下文压缩失败'
            : automatic
              ? '上下文已自动压缩'
              : '上下文已压缩',
    timestamp: pending?.timestamp ?? now,
    automatic,
  }
  if (pending) Object.assign(pending, block)
  else transcript.push(block)

  return { ...event, data: { ...data, compaction: block } }
}
