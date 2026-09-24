import { promises as fs } from 'fs'
import * as path from 'path'
import { randomUUID } from 'crypto'
import { assertSafeMemory } from './MemoryPolicy'
import type { MemoryCandidate, MemoryRecord, MemoryScope, MemoryKind } from './MemoryTypes'
import { stableMemoryId } from './MemoryExtractor'

const validScopes: MemoryScope[] = ['global', 'workspace', 'module', 'task', 'session']
const validKinds: MemoryKind[] = ['preference', 'convention', 'fact', 'decision', 'feedback', 'episode']

export function parseMemoryFile(text: string, filename: string, scopePath?: string): MemoryRecord | undefined {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/)
  if (!match) return undefined
  const fields: Record<string, string> = {}
  for (const line of match[1].split(/\r?\n/)) {
    const position = line.indexOf(':')
    if (position > 0) fields[line.slice(0, position).trim()] = line.slice(position + 1).trim()
  }
  const content = match[2].trim()
  if (!content) return undefined
  const legacyType = fields.type
  const scope: MemoryScope = validScopes.includes(fields.scope as MemoryScope) ? fields.scope as MemoryScope : 'workspace'
  const kind: MemoryKind = validKinds.includes(fields.kind as MemoryKind)
    ? fields.kind as MemoryKind
    : legacyType === 'feedback' ? 'feedback' : legacyType === 'user' ? 'preference'
      : /convention|style|rule/.test(fields.name || filename) ? 'convention' : 'fact'
  const subject = fields.subject || fields.name || path.basename(filename, '.md')
  const readArray = (value?: string): string[] => {
    try { return value ? JSON.parse(value) as string[] : [] } catch { return [] }
  }
  const readSources = (): MemoryRecord['sources'] => {
    try { return fields.sources ? JSON.parse(fields.sources) as MemoryRecord['sources'] : [] } catch { return [] }
  }
  return {
    id: fields.id || stableMemoryId(scope, kind, subject, scopePath),
    scope,
    scopePath: fields.scopePath || (scope !== 'global' ? scopePath : undefined),
    kind,
    subject,
    content,
    description: fields.description || subject,
    status: (['active', 'candidate', 'superseded', 'disputed', 'expired'].includes(fields.status)
      ? fields.status : 'active') as MemoryRecord['status'],
    confidence: Number.isFinite(Number(fields.confidence)) && fields.confidence
      ? Math.min(1, Math.max(0, Number(fields.confidence))) : 0.7,
    confirmed: fields.confirmed === 'true',
    sources: readSources(),
    tags: readArray(fields.tags),
    createdAt: fields.createdAt || new Date(0).toISOString(),
    updatedAt: fields.updatedAt || fields.createdAt || new Date(0).toISOString(),
    ...(fields.lastUsedAt ? { lastUsedAt: fields.lastUsedAt } : {}),
    ...(fields.lastVerifiedAt ? { lastVerifiedAt: fields.lastVerifiedAt } : {}),
    ...(fields.expiresAt ? { expiresAt: fields.expiresAt } : {}),
    supersedes: readArray(fields.supersedes),
    relatedIds: readArray(fields.relatedIds),
  }
}

export function serializeMemory(record: MemoryRecord): string {
  const fields: Record<string, string | number | boolean | undefined> = {
    id: record.id, scope: record.scope, scopePath: record.scopePath, kind: record.kind,
    subject: record.subject, description: record.description, status: record.status,
    confidence: record.confidence, confirmed: record.confirmed, createdAt: record.createdAt,
    updatedAt: record.updatedAt, lastUsedAt: record.lastUsedAt,
    lastVerifiedAt: record.lastVerifiedAt, expiresAt: record.expiresAt,
    sources: JSON.stringify(record.sources), tags: JSON.stringify(record.tags),
    supersedes: JSON.stringify(record.supersedes || []), relatedIds: JSON.stringify(record.relatedIds || []),
  }
  return `---\n${Object.entries(fields).filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}: ${String(value).replace(/[\r\n]/g, ' ')}`).join('\n')}\n---\n\n${record.content}\n`
}

export class MemoryStore {
  private records = new Map<string, MemoryRecord>()
  private candidates = new Map<string, MemoryCandidate>()
  private rejected = new Set<string>()
  private queue: Promise<void> = Promise.resolve()

  constructor(readonly directory: string, private readonly legacyDirectory?: string, private readonly scopePath?: string) {}

  private fileName(id: string): string {
    if (!/^[a-zA-Z0-9._-]{1,120}$/.test(id) || id === '.' || id === '..') {
      throw new Error('非法记忆 ID')
    }
    return id
  }

  private async safeDirectory(directory: string): Promise<void> {
    const metadata = await fs.lstat(directory)
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error('记忆目录不是安全目录')
    if (this.scopePath) {
      const root = path.resolve(this.scopePath)
      const real = await fs.realpath(directory)
      const relative = path.relative(root, real)
      if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw new Error('记忆目录超出工作区')
      }
    }
  }

  private async safeFile(filename: string): Promise<boolean> {
    try {
      const metadata = await fs.lstat(filename)
      if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error('记忆文件是符号链接')
      return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
      throw error
    }
  }

  private async atomicWrite(filename: string, content: string): Promise<void> {
    await this.safeDirectory(path.dirname(filename))
    const temporary = `${filename}.${randomUUID()}.tmp`
    try {
      await fs.writeFile(temporary, content, 'utf8')
      await fs.rename(temporary, filename)
    } finally {
      await fs.rm(temporary, { force: true })
    }
  }

  private serialize(work: () => Promise<void>): Promise<void> {
    const result = this.queue.then(work)
    this.queue = result.catch(() => undefined)
    return result
  }

  async initialize(): Promise<void> {
    await Promise.all(['entries', 'candidates', 'history'].map(name => fs.mkdir(path.join(this.directory, name), { recursive: true })))
    await Promise.all([this.directory, ...['entries', 'candidates', 'history'].map(name => path.join(this.directory, name))].map(directory => this.safeDirectory(directory)))
    try {
      const filename = path.join(this.directory, 'rejections.json')
      if (await this.safeFile(filename)) {
        this.rejected = new Set(JSON.parse(await fs.readFile(filename, 'utf8')) as string[])
      }
    } catch { this.rejected.clear() }
    await this.reload()
    for (const directory of [this.directory, this.legacyDirectory]) {
      if (!directory) continue
      let names: string[]
      try { await this.safeDirectory(directory); names = await fs.readdir(directory) } catch { continue }
      for (const name of names.filter(file => file.endsWith('.md') && file.toLowerCase() !== 'memory.md')) {
        try {
          const originalPath = path.join(directory, name)
          if (!await this.safeFile(originalPath)) continue
          const original = parseMemoryFile(await fs.readFile(originalPath, 'utf8'), name, this.scopePath)
          if (!original) continue
          assertSafeMemory(original)
          const target = path.join(this.directory, 'entries', `${this.fileName(original.id)}.md`)
          const exists = await fs.stat(target).then(() => true, () => false)
          if (exists) continue
          const migrated = { ...original, sources: [...original.sources, { type: 'file' as const, ref: path.join(directory, name), capturedAt: new Date().toISOString() }] }
          await this.save(migrated, 'migrate')
        } catch (error) { console.warn('Skipped invalid legacy memory:', name, error) }
      }
    }
    await this.rebuildIndex()
    await this.atomicWrite(path.join(this.directory, 'manifest.json'), JSON.stringify({ version: 1 }, null, 2))
  }

  async reload(): Promise<void> {
    await this.serialize(async () => {
      const next = new Map<string, MemoryRecord>()
      const entryDirectory = path.join(this.directory, 'entries')
      for (const directory of [this.legacyDirectory, this.directory, entryDirectory]) {
        if (!directory) continue
        let names: string[]
        try {
          await this.safeDirectory(directory)
          names = await fs.readdir(directory)
        } catch { continue }
        for (const name of names.filter(file => file.endsWith('.md') && file.toLowerCase() !== 'memory.md')) {
          try {
            const filename = path.join(directory, name)
            if (!await this.safeFile(filename)) continue
            const record = parseMemoryFile(await fs.readFile(filename, 'utf8'), name, this.scopePath)
            if (record) {
              assertSafeMemory(record)
              this.fileName(record.id)
              next.set(record.id, record)
              continue
            }
          } catch { /* fall back to the last valid entry */ }
          if (directory === entryDirectory) {
            const previous = this.records.get(path.basename(name, '.md'))
            if (previous) next.set(previous.id, previous)
          }
        }
      }
      const pending = new Map<string, MemoryCandidate>()
      const candidateDirectory = path.join(this.directory, 'candidates')
      try {
        await this.safeDirectory(candidateDirectory)
        for (const name of (await fs.readdir(candidateDirectory)).filter(file => file.endsWith('.json'))) {
          try {
            const filename = path.join(candidateDirectory, name)
            if (!await this.safeFile(filename)) continue
            const candidate = JSON.parse(await fs.readFile(filename, 'utf8')) as MemoryCandidate
            if (candidate.status === 'candidate') {
              assertSafeMemory(candidate)
              this.fileName(candidate.id)
              pending.set(candidate.id, candidate)
            }
          } catch {
            const previous = this.candidates.get(path.basename(name, '.json'))
            if (previous) pending.set(previous.id, previous)
          }
        }
      } catch { pending.clear() }
      this.records = next
      this.candidates = pending
    })
  }

  list(): MemoryRecord[] { return [...this.records.values()] }
  pending(): MemoryCandidate[] { return [...this.candidates.values()] }
  get(id: string): MemoryRecord | undefined { return this.records.get(id) }

  async propose(candidate: MemoryCandidate): Promise<void> {
    assertSafeMemory(candidate)
    if (this.rejected.has(candidate.id)) throw new Error('该候选曾被拒绝，请编辑后再提交')
    await this.serialize(async () => {
      const existing = this.candidates.get(candidate.id)
      if (existing && existing.content !== candidate.content) throw new Error('同主题候选存在冲突')
      const sources = existing ? [...existing.sources] : []
      for (const source of candidate.sources) {
        if (!sources.some(previous => previous.type === source.type && previous.ref === source.ref && previous.quote === source.quote)) {
          sources.push(source)
        }
      }
      const merged = { ...candidate, sources }
      await this.atomicWrite(path.join(this.directory, 'candidates', `${this.fileName(candidate.id)}.json`), JSON.stringify(merged, null, 2))
      this.candidates.set(candidate.id, merged)
    })
  }

  async reject(id: string): Promise<void> {
    await this.serialize(async () => {
      if (!this.candidates.has(id)) throw new Error('候选记忆不存在')
      const rejected = [...this.rejected, id]
      await this.atomicWrite(path.join(this.directory, 'rejections.json'), JSON.stringify(rejected))
      const historyPath = path.join(this.directory, 'history', `${this.fileName(id)}.jsonl`)
      await this.safeDirectory(path.dirname(historyPath))
      await this.safeFile(historyPath)
      await fs.appendFile(historyPath, `${JSON.stringify({ action: 'reject', at: new Date().toISOString(), id })}\n`)
      await fs.rm(path.join(this.directory, 'candidates', `${this.fileName(id)}.json`))
      this.rejected.add(id)
      this.candidates.delete(id)
    })
  }

  async removeCandidate(id: string): Promise<void> {
    await this.serialize(async () => {
      await fs.rm(path.join(this.directory, 'candidates', `${this.fileName(id)}.json`), { force: true })
      this.candidates.delete(id)
    })
  }

  async restore(id: string): Promise<MemoryRecord> {
    const historyPath = path.join(this.directory, 'history', `${this.fileName(id)}.jsonl`)
    if (!await this.safeFile(historyPath)) throw new Error('没有可恢复的历史版本')
    const events = (await fs.readFile(historyPath, 'utf8')).trim().split('\n')
    const previous = events.reverse().flatMap(line => {
      try { return [JSON.parse(line) as { before?: MemoryRecord }] } catch { return [] }
    })
      .find(event => event.before)
    if (!previous?.before) throw new Error('没有可恢复的历史版本')
    const restored: MemoryRecord = { ...previous.before, status: 'active', updatedAt: new Date().toISOString() }
    await this.save(restored, 'restore')
    return restored
  }

  async save(record: MemoryRecord, action = 'update'): Promise<void> {
    assertSafeMemory(record)
    await this.serialize(async () => {
      const id = this.fileName(record.id)
      const current = this.records.get(id)
      const entryPath = path.join(this.directory, 'entries', `${id}.md`)
      const historyPath = path.join(this.directory, 'history', `${id}.jsonl`)
      await this.safeDirectory(path.dirname(historyPath))
      await this.safeFile(historyPath)
      await this.atomicWrite(entryPath, serializeMemory(record))
      await fs.appendFile(historyPath, `${JSON.stringify({ action, at: new Date().toISOString(), before: current || null, after: record })}\n`)
      this.records.set(id, record)
      await this.writeIndex()
    })
  }

  async touch(id: string): Promise<void> {
    await this.serialize(async () => {
      const current = this.records.get(id)
      if (!current || (current.lastUsedAt && Date.now() - Date.parse(current.lastUsedAt) < 3600000)) return
      try {
        await fs.stat(path.join(this.directory, 'entries', `${this.fileName(id)}.md`))
      } catch { return }
      const updated = { ...current, lastUsedAt: new Date().toISOString() }
      await this.atomicWrite(path.join(this.directory, 'entries', `${this.fileName(id)}.md`), serializeMemory(updated))
      this.records.set(id, updated)
    })
  }

  async rebuildIndex(): Promise<void> { await this.serialize(() => this.writeIndex()) }

  private async writeIndex(): Promise<void> {
    const entries = this.list().filter(record => record.status === 'active')
      .map(record => `- [${record.subject.replace(/[\r\n[\]()]/g, ' ')}](entries/${this.fileName(record.id)}.md) — ${record.scope} · ${record.description.replace(/[\r\n]/g, ' ')}`)
    const filename = path.join(this.directory, 'MEMORY.md')
    const content = `# Memory Index\n\n${entries.join('\n')}\n`
    const previous = await fs.readFile(filename, 'utf8').catch(() => undefined)
    if (previous !== content) await this.atomicWrite(filename, content)
  }
}
