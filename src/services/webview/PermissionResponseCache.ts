export interface PermissionResponseData {
  requestId: string
  approved: boolean
  reason?: string
  updatedInput?: unknown
  rule?: 'once' | 'always'
}

interface CachedPermissionResponse {
  response: PermissionResponseData
  expiresAt: number
}

/**
 * Webview 在确认事件丢失时会重发授权响应。缓存第一次处理结果，确保重发幂等。
 */
export class PermissionResponseCache {
  private readonly entries = new Map<string, CachedPermissionResponse>()

  constructor(
    private readonly ttlMs = 10 * 60 * 1000,
    private readonly now: () => number = Date.now
  ) {}

  get(requestId: string): PermissionResponseData | undefined {
    const entry = this.entries.get(requestId)
    if (!entry) return undefined
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(requestId)
      return undefined
    }
    return entry.response
  }

  set(response: PermissionResponseData): void {
    this.pruneExpired()
    this.entries.set(response.requestId, {
      response: { ...response },
      expiresAt: this.now() + this.ttlMs,
    })
  }

  private pruneExpired(): void {
    const now = this.now()
    for (const [requestId, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(requestId)
    }
  }
}
