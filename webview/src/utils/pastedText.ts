import type { InlineMessageSegment } from '@/types'

export function isLongText(text: string): boolean {
  return text.length > 2000 || text.split('\n').length >= 20
}

export function pastedTextTitle(text: string): string {
  return text.split(/\r?\n/).find(line => line.trim())?.trim().slice(0, 80) || '粘贴的文本'
}

/** 仅改变展示结构；text 始终保留完整内容，供发送、复制和历史恢复使用。 */
export function collapseLongText(segments: InlineMessageSegment[]): InlineMessageSegment[] {
  const joined: InlineMessageSegment[] = []
  for (const segment of segments) {
    const previous = joined[joined.length - 1]
    if (segment.type === 'text' && previous?.type === 'text') {
      joined[joined.length - 1] = { ...previous, text: (previous.text || '') + (segment.text || '') }
    } else joined.push(segment)
  }
  return joined.map(segment =>
    segment.type === 'text' && isLongText(segment.text || '')
      ? { ...segment, type: 'pasted_text', name: pastedTextTitle(segment.text || '') }
      : segment
  )
}
