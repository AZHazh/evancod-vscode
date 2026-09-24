import * as path from 'path'
import type { MemoryRecord, MemoryRetrievalRequest } from './MemoryTypes'

export function retrieveMemories(records: MemoryRecord[], request: MemoryRetrievalRequest): MemoryRecord[] {
  const now = Date.now()
  const query = request.query.toLowerCase()
  const englishWords = query.match(/[a-z0-9_-]{2,}/g) || []
  const chineseWords = (query.match(/[\u4e00-\u9fff]{2,}/g) || []).flatMap(sequence =>
    Array.from({ length: sequence.length - 1 }, (_, index) => sequence.slice(index, index + 2))
  )
  const words = [...new Set([...englishWords, ...chineseWords])]
  const applicable = records.filter(record => {
    if (record.status !== 'active' || (record.expiresAt && Date.parse(record.expiresAt) <= now)) return false
    if (record.kind === 'episode' && record.scope !== 'task' && record.scope !== 'session') return false
    switch (record.scope) {
      case 'global': return true
      case 'workspace': return Boolean(request.workspace && record.scopePath === request.workspace)
      case 'module': {
        if (!request.modulePath || !record.scopePath || !request.workspace) return false
        const modulePath = path.resolve(request.workspace, record.scopePath)
        if (!modulePath.startsWith(path.resolve(request.workspace) + path.sep)) return false
        return request.modulePath === modulePath || request.modulePath.startsWith(modulePath + path.sep)
      }
      case 'task': return Boolean(request.taskId && record.scopePath === request.taskId)
      case 'session': return Boolean(request.sessionId && record.scopePath === request.sessionId)
    }
  })
  const codingRequest = /代码|编码|实现|修改|文件|格式|编程|测试|组件|函数|开发|修复|功能|\.vue\b|\.tsx?\b|typescript|javascript|\b(?:ts|js)\b/i.test(query)
  const ranked = applicable.map(record => {
    const text = `${record.subject} ${record.description} ${record.tags.join(' ')} ${record.content}`.toLowerCase()
    const relevance = words.filter(word => text.includes(word)).length +
      (query.includes(record.subject.toLowerCase()) ? 2 : 0)
    const score = relevance * 10 + (record.scope === 'module' ? 5 : record.scope === 'task' ? 6 : record.scope === 'workspace' ? 4 : record.scope === 'global' ? 3 : 1) + record.confidence
    return { record, relevance, score }
  }).filter(item => item.relevance > 0 || (codingRequest && (
    item.record.subject === 'code-style-quotes' ||
    item.record.subject === 'code-documentation' ||
    item.record.kind === 'convention' ||
    (item.record.kind === 'preference' && /代码|编码|实现|文件|测试|工具|修改|编辑|格式/.test(item.record.content))
  )))
    .sort((left, right) => right.score - left.score || right.record.updatedAt.localeCompare(left.record.updatedAt))

  const result: MemoryRecord[] = []
  let used = 0
  for (const item of ranked) {
    const length = item.record.content.length + item.record.description.length + 80
    if (result.length >= (request.maxItems ?? 8)) break
    if (used + length > (request.maxChars ?? 3500)) continue
    result.push(item.record)
    used += length
  }
  return result
}
