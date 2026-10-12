export interface PermissionResponseData {
  requestId: string
  /** 请求所属会话，用于并行会话下精确路由。 */
  sessionId?: string
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

  get(requestId: string, sessionId?: string): PermissionResponseData | undefined {
    const key = this.getKey(requestId, sessionId)
    const entry = this.entries.get(key)
    if (!entry) return undefined
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key)
      return undefined
    }
    return entry.response
  }

  set(response: PermissionResponseData): void {
    this.pruneExpired()
    this.entries.set(this.getKey(response.requestId, response.sessionId), {
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

  /** @returns 会话和请求组成的缓存键，兼容没有 sessionId 的旧协议。 */
  private getKey(requestId: string, sessionId?: string): string {
    return `${sessionId || 'legacy'}:${requestId}`
  }
}
