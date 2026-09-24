import { createHash } from 'crypto'
import type { MemoryCandidate, MemoryKind, MemoryScope } from './MemoryTypes'

export function stableMemoryId(scope: MemoryScope, kind: MemoryKind, subject: string, scopePath = ''): string {
  return `${scope}.${kind}.${createHash('sha256').update(`${scopePath}:${subject.trim().toLowerCase()}`).digest('hex').slice(0, 16)}`
}

export function extractExplicitMemory(text: string, workspace?: string): MemoryCandidate | undefined {
  const normalized = text.trim()
  const projectMemory = normalized.match(
    /^(?:请)?记住(?:这个项目|本项目|当前项目|此项目|工作区)[：:，,\s]*([\s\S]+)$/
  )
  const match = projectMemory || normalized.match(/^(?:请)?(?:记住|以后(?:都|请)?|今后(?:都|请)?|之后都|统一|不要再|别再|我习惯|我更喜欢|我偏好|我的习惯是|我的偏好是|我希望以后|(?:本项目|这个项目|当前项目)(?:以后(?:都)?|统一|确认决定|决定)|确认采用)(?:[：:，,\s]*)?([\s\S]+)$/)
  if (!match || match[1].trim().length < 3 || match[1].length > 1000) return undefined
  const content = match[1].trim()
  const projectDecision = /^(?:(?:本项目|这个项目|当前项目)(?:确认)?决定|确认采用)/.test(normalized)
  const scope: MemoryScope = (/本项目|这个项目|当前项目|此项目|工作区/.test(`${text} ${content}`) || projectDecision) && workspace
    ? 'workspace'
    : 'global'
  const kind: MemoryKind = /^(?:请)?(?:不要再|别再|纠正)/.test(normalized)
    ? 'feedback'
    : projectDecision
      ? 'decision'
      : projectMemory || /^(?:请)?记住(?:这个项目|本项目|当前项目|此项目|工作区)|^(?:本项目|这个项目|当前项目)(?:以后(?:都)?|统一)/.test(normalized)
        ? 'convention'
        : 'preference'
  const subject = /单引号|双引号|single.quote|double.quote/i.test(content)
    ? 'code-style-quotes'
    : /jsdoc/i.test(content) && /函数|function/i.test(content)
      ? 'code-documentation'
      : content.split(/\r?\n/)[0].replace(/[。.!！]$/, '').trim().toLowerCase()
  const now = new Date().toISOString()
  return {
    id: stableMemoryId(scope, kind, subject, scope === 'workspace' ? workspace : undefined),
    scope,
    scopePath: scope === 'workspace' ? workspace : undefined,
    kind,
    subject,
    content,
    description: content.replace(/\s+/g, ' ').slice(0, 100),
    status: 'candidate',
    confidence: 0.9,
    confirmed: true,
    sources: [{ type: 'user', capturedAt: now }],
    tags: [],
    createdAt: now,
    updatedAt: now,
    decision: 'automatic',
  }
}

export function extractUserMemories(text: string, workspace?: string): MemoryCandidate[] {
  if (text.length > 2000 || text.trim().startsWith('/')) return []
  if (!/[。！？!?；;]/.test(text) && text.length <= 300) {
    const entireMessage = extractExplicitMemory(text, workspace)
    if (entireMessage) return [entireMessage]
  }

  const candidates: MemoryCandidate[] = []
  let inCodeBlock = false
  for (const line of text.split(/\r?\n/)) {
    if (line.trim().startsWith('```')) {
      inCodeBlock = !inCodeBlock
      continue
    }
    if (inCodeBlock || /^\s*(?:>|\/\/)/.test(line)) continue
    for (const sentence of line.split(/[。！？!?；;]/)) {
      const projectDirective = sentence.match(
        /(?:^|[，,])\s*(?:请)?记住(?:这个项目|本项目|当前项目|此项目|工作区)\s*[，,:：]?\s*(.+)$/
      )
      if (projectDirective) {
        const rule = projectDirective[1].split(/[，,](?=(?:然后|接着|现在|另外)(?:请|帮)|(?:请)?记住)/)[0]
        const candidate = extractExplicitMemory(`记住这个项目，${rule}`, workspace)
        if (candidate && !candidates.some(item => item.id === candidate.id)) {
          candidates.push(candidate)
        }
      }
      const clausesBeforeProjectRule = projectDirective
        ? sentence.slice(0, projectDirective.index)
        : sentence
      for (const clause of clausesBeforeProjectRule.split(/[，,]/)) {
        const trimmed = clause.trim()
        if (/^(?:请)?记住(?:这个项目|本项目|当前项目|此项目|工作区)$/.test(trimmed)) continue
        const candidate = extractExplicitMemory(trimmed, workspace)
        if (candidate && !candidates.some(item => item.id === candidate.id)) {
          candidates.push(candidate)
        }
        if (candidates.length === 3) return candidates
      }
    }
  }
  return candidates
}

export function extractAssistantDecision(text: string, workspace?: string): MemoryCandidate | undefined {
  if (!workspace) return undefined
  let inCodeBlock = false
  for (const line of text.split(/\r?\n/)) {
    if (line.trim().startsWith('```')) {
      inCodeBlock = !inCodeBlock
      continue
    }
    if (inCodeBlock || /^\s*>/.test(line)) continue
    for (const sentence of line.split(/[。！？!?；;]/)) {
      const match = sentence.trim().replace(/^[-*]\s+/, '')
        .match(/^(?:本项目|这个项目)(?:最终|已)?(?:决定|确定|采用|选择)(?:采用|使用)?[：:，,\s]*([^\r\n]{3,160})$/)
      if (!match) continue
      const content = match[1].trim()
      const now = new Date().toISOString()
      const subject = `technical-decision-${content.toLowerCase()}`
      return {
        id: stableMemoryId('workspace', 'decision', subject, workspace),
        scope: 'workspace',
        scopePath: workspace,
        kind: 'decision',
        subject,
        content: `本项目采用${content}`,
        description: `待确认：本项目采用${content}`,
        status: 'candidate',
        confidence: 0.6,
        confirmed: false,
        sources: [{ type: 'conversation', capturedAt: now }],
        tags: [],
        createdAt: now,
        updatedAt: now,
        decision: 'confirm',
      }
    }
  }
  return undefined
}
