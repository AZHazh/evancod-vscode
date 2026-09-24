import { createHash } from 'crypto'
import type { MemoryCandidate, MemoryRecord } from './MemoryTypes'

export function reconcileMemory(candidate: MemoryCandidate, records: MemoryRecord[]): {
  record?: MemoryRecord
  previous?: MemoryRecord
  conflict?: MemoryCandidate
} {
  const formalRecord = { ...candidate }
  Reflect.deleteProperty(formalRecord, 'decision')
  const previous = records.find(record => record.scope === candidate.scope &&
    record.scopePath === candidate.scopePath && record.kind === candidate.kind &&
    record.subject === candidate.subject && (record.status === 'active' || record.status === 'disputed'))
  if (!previous) return { record: { ...formalRecord, status: 'active' } }
  if (previous.content.trim() === candidate.content.trim()) {
    return { record: {
      ...previous, updatedAt: new Date().toISOString(),
      confidence: Math.max(previous.confidence, candidate.confidence),
      confirmed: previous.confirmed || candidate.confirmed,
      sources: [...previous.sources, ...candidate.sources],
    } }
  }
  const suffix = createHash('sha256').update(candidate.content).digest('hex').slice(0, 8)
  return { previous, conflict: {
    ...candidate, id: `${candidate.id}-dispute-${suffix}`,
    decision: 'confirm', confirmed: false, relatedIds: [previous.id],
  } }
}
