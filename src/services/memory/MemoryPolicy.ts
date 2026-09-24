import type { MemoryCandidate, MemoryRecord } from './MemoryTypes'

const sensitivePatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
  /\b(?:sk-[a-z0-9_-]{16,}|gh[opsu]_[a-z0-9_]{20,}|xox[baprs]-[a-z0-9-]{15,})\b/i,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\b(?:authorization\s*:\s*(?:bearer|basic)|cookie\s*:|set-cookie\s*:)/i,
  /\b(?:bearer|basic)\s+[a-z0-9+/_=-]{12,}\b/i,
  /\b(?:password|passwd|secret|api[_-]?key|access[_-]?token)["']?\s*[:=：]\s*["']?\S+/i,
  /(?:密码|密钥|令牌)\s*[:=：]\s*\S+/,
]

export function containsSensitiveData(text: string): boolean {
  return sensitivePatterns.some(pattern => pattern.test(text))
}

export function assertSafeMemory(memory: Pick<MemoryRecord, 'subject' | 'content' | 'description' | 'sources' | 'tags'>): void {
  if (
    containsSensitiveData(memory.subject) ||
    containsSensitiveData(memory.content) ||
    containsSensitiveData(memory.description) ||
    memory.tags.some(containsSensitiveData) ||
    memory.sources.some(source => containsSensitiveData(`${source.quote || ''} ${source.ref || ''}`))
  ) {
    throw new Error('记忆包含可能的密钥或敏感信息，已拒绝保存')
  }
}

export function candidateDecision(candidate: MemoryCandidate): 'automatic' | 'confirm' {
  return candidate.confirmed && candidate.confidence >= 0.8 ? 'automatic' : 'confirm'
}
