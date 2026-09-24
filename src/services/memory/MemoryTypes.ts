export type MemoryScope = 'global' | 'workspace' | 'module' | 'task' | 'session'
export type MemoryKind = 'preference' | 'convention' | 'fact' | 'decision' | 'feedback' | 'episode'
export type MemoryStatus = 'active' | 'candidate' | 'superseded' | 'disputed' | 'expired'

export interface MemorySource {
  type: 'user' | 'conversation' | 'file' | 'tool' | 'system'
  ref?: string
  quote?: string
  capturedAt: string
}

export interface MemoryRecord {
  id: string
  scope: MemoryScope
  scopePath?: string
  kind: MemoryKind
  subject: string
  content: string
  description: string
  status: MemoryStatus
  confidence: number
  confirmed: boolean
  sources: MemorySource[]
  tags: string[]
  createdAt: string
  updatedAt: string
  lastUsedAt?: string
  lastVerifiedAt?: string
  expiresAt?: string
  supersedes?: string[]
  relatedIds?: string[]
}

export interface MemoryCandidate extends MemoryRecord {
  status: 'candidate'
  decision: 'automatic' | 'confirm'
}

export interface MemoryRetrievalRequest {
  query: string
  workspace?: string
  modulePath?: string
  taskId?: string
  sessionId?: string
  maxItems?: number
  maxChars?: number
}
