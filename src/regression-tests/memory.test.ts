import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { promises as fs } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { MemoryStore, parseMemoryFile, serializeMemory } from '../services/memory/MemoryStore'
import {
  extractAssistantDecision,
  extractExplicitMemory,
  extractUserMemories,
  stableMemoryId,
} from '../services/memory/MemoryExtractor'
import { containsSensitiveData } from '../services/memory/MemoryPolicy'
import { reconcileMemory } from '../services/memory/MemoryReconciler'
import { retrieveMemories } from '../services/memory/MemoryRetriever'
import { parseSemanticMemoryResponse } from '../services/memory/LLMMemoryExtractor'
import type { MemoryRecord } from '../services/memory/MemoryTypes'

const temporaryDirectories: string[] = []
async function createDirectory(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'evancod-memory-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map(directory => fs.rm(directory, { recursive: true, force: true }))
  )
})

describe('memory storage and retrieval', () => {
  it('round-trips structured frontmatter and maps legacy metadata', () => {
    const candidate = extractExplicitMemory('以后都使用单引号')!
    const formalRecord = { ...candidate }
    Reflect.deleteProperty(formalRecord, 'decision')
    const record: MemoryRecord = { ...formalRecord, status: 'active', tags: ['typescript'] }
    const parsed = parseMemoryFile(serializeMemory(record), 'test.md')!
    assert.deepEqual(parsed, { ...record, supersedes: [], relatedIds: [] })
    const legacy = parseMemoryFile(
      '---\nname: project_conventions\ntype: project\ndescription: 项目约束\n---\n\n使用 TypeScript',
      'project_conventions.md',
      'workspace-a'
    )!
    assert.equal(legacy.scope, 'workspace')
    assert.equal(legacy.kind, 'convention')
    assert.equal(
      legacy.id,
      stableMemoryId('workspace', 'convention', 'project_conventions', 'workspace-a')
    )
    const multiLine = extractExplicitMemory('记住这是第一行\n这是第二行')!
    assert.equal(
      parseMemoryFile(serializeMemory({ ...multiLine, status: 'active' }), 'multi.md')?.content,
      '这是第一行\n这是第二行'
    )
  })

  it('migrates legacy files without rewriting originals and rebuilds index after reload', async () => {
    const root = await createDirectory()
    const oldDirectory = path.join(root, '.claude', 'memory')
    const directory = path.join(root, '.evancod', 'memory')
    await fs.mkdir(oldDirectory, { recursive: true })
    const legacyPath = path.join(oldDirectory, 'project.md')
    const text =
      '---\nname: project\ntype: project\ndescription: 旧项目事实\n---\n\n使用 TypeScript'
    await fs.writeFile(legacyPath, text)
    const store = new MemoryStore(directory, oldDirectory, root)
    await store.initialize()
    assert.equal(store.list().length, 1)
    assert.equal(await fs.readFile(legacyPath, 'utf8'), text)
    assert.match(await fs.readFile(path.join(directory, 'MEMORY.md'), 'utf8'), /旧项目事实/)
    await store.initialize()
    assert.equal((await fs.readdir(path.join(directory, 'entries'))).length, 1)
    const record = store.list()[0]
    await fs.writeFile(
      path.join(directory, 'entries', `${record.id}.md`),
      serializeMemory({ ...record, description: '外部编辑' })
    )
    await store.reload()
    await store.rebuildIndex()
    assert.equal(store.list()[0].description, '外部编辑')
    assert.match(await fs.readFile(path.join(directory, 'MEMORY.md'), 'utf8'), /外部编辑/)
  })

  it('prefers current workspace files to equally named Claude memories', async () => {
    const root = await createDirectory()
    const oldDirectory = path.join(root, '.claude', 'memory')
    const directory = path.join(root, '.evancod', 'memory')
    await fs.mkdir(oldDirectory, { recursive: true })
    await fs.mkdir(directory, { recursive: true })
    const frontmatter = '---\nname: project\ntype: project\ndescription: 约束\n---\n\n'
    await fs.writeFile(path.join(oldDirectory, 'project.md'), frontmatter + '旧内容')
    await fs.writeFile(path.join(directory, 'project.md'), frontmatter + '当前内容')
    const store = new MemoryStore(directory, oldDirectory, root)
    await store.initialize()
    assert.equal(store.list().length, 1)
    assert.equal(store.list()[0].content, '当前内容')
    assert.equal(
      await fs.readFile(path.join(oldDirectory, 'project.md'), 'utf8'),
      frontmatter + '旧内容'
    )
  })

  it('persists candidates and rejections without leaking sensitive data', async () => {
    const root = await createDirectory()
    const store = new MemoryStore(path.join(root, 'memory'))
    await store.initialize()
    const candidate = extractExplicitMemory('记住以后统一使用单引号')!
    await store.propose(candidate)
    await store.reload()
    assert.equal(store.pending().length, 1)
    await store.reject(candidate.id)
    await store.reload()
    assert.equal(store.pending().length, 0)
    await assert.rejects(store.propose(candidate), /曾被拒绝/)
    assert.equal(containsSensitiveData('Authorization: Bearer abc123'), true)
    assert.equal(containsSensitiveData('密码：abcdef123456'), true)
    await assert.rejects(
      store.save({ ...candidate, status: 'active', content: 'password: supersecret123' }),
      /敏感/
    )
    await assert.rejects(
      store.save({ ...candidate, status: 'active', tags: ['密钥：abcdef123456'] }),
      /敏感/
    )
    assert.equal((await fs.readdir(path.join(root, 'memory', 'entries'))).length, 0)
  })

  it('keeps the last valid record when an external edit is malformed and rejects unsafe paths', async () => {
    const root = await createDirectory()
    const directory = path.join(root, 'memory')
    const store = new MemoryStore(directory)
    await store.initialize()
    const candidate = extractExplicitMemory('以后都使用单引号')!
    const record: MemoryRecord = { ...candidate, status: 'active' }
    await store.save(record)
    const filename = path.join(directory, 'entries', `${record.id}.md`)
    await fs.writeFile(filename, 'invalid frontmatter')
    await store.reload()
    assert.equal(store.get(record.id)?.content, record.content)
    await assert.rejects(store.save({ ...record, id: '../outside' }), /非法记忆 ID/)
    assert.equal(await fs.readFile(filename, 'utf8'), 'invalid frontmatter')
    await fs.rm(filename)
    await store.reload()
    assert.equal(store.get(record.id), undefined)
  })

  it('keeps the original file if the atomic replacement fails', async context => {
    const root = await createDirectory()
    const directory = path.join(root, 'memory')
    const store = new MemoryStore(directory)
    await store.initialize()
    const record: MemoryRecord = { ...extractExplicitMemory('以后都使用单引号')!, status: 'active' }
    await store.save(record)
    const filename = path.join(directory, 'entries', `${record.id}.md`)
    const original = await fs.readFile(filename, 'utf8')
    context.mock.method(fs, 'rename', async () => {
      throw new Error('replace failed')
    })
    await assert.rejects(store.save({ ...record, content: '使用双引号' }), /replace failed/)
    assert.equal(await fs.readFile(filename, 'utf8'), original)
    assert.equal(store.get(record.id)?.content, record.content)
    assert.deepEqual(
      (await fs.readdir(path.join(directory, 'entries'))).filter(name => name.endsWith('.tmp')),
      []
    )
  })

  it('requires confirmation for conflicts and restores prior versions from history', async () => {
    const root = await createDirectory()
    const store = new MemoryStore(path.join(root, 'memory'))
    await store.initialize()
    const original = extractExplicitMemory('以后都使用单引号')!
    const record: MemoryRecord = { ...original, status: 'active' }
    await store.save(record)
    const same = reconcileMemory(original, store.list())
    assert.equal(same.record?.sources.length, 2)
    const different = extractExplicitMemory('以后都使用双引号')!
    const conflict = reconcileMemory(different, store.list())
    assert.equal(conflict.record, undefined)
    assert.equal(conflict.conflict?.relatedIds?.[0], record.id)
    assert.notEqual(conflict.conflict?.id, record.id)
    await store.save({ ...record, status: 'disputed' })
    assert.equal(retrieveMemories(store.list(), { query: '单引号' }).length, 0)
    await store.restore(record.id)
    assert.equal(store.get(record.id)?.status, 'active')
    assert.equal(retrieveMemories(store.list(), { query: '单引号' }).length, 1)
  })

  it('filters scope, expiry, and character budget', () => {
    const global = extractExplicitMemory('记住以后都使用单引号')!
    const workspace: MemoryRecord = {
      ...global,
      id: 'workspace.fact.rule',
      scope: 'workspace',
      scopePath: 'workspace-a',
      kind: 'fact',
      subject: '测试规则',
      content: '本项目测试规则',
      status: 'active',
    }
    const session: MemoryRecord = {
      ...workspace,
      id: 'session.fact.rule',
      scope: 'session',
      scopePath: 'session-1',
    }
    const expired: MemoryRecord = {
      ...workspace,
      id: 'workspace.fact.expired',
      expiresAt: '2020-01-01T00:00:00Z',
    }
    const records: MemoryRecord[] = [{ ...global, status: 'active' }, workspace, session, expired]
    assert.deepEqual(
      retrieveMemories(records, { query: '规则', workspace: 'workspace-b' }).map(item => item.id),
      []
    )
    assert.equal(retrieveMemories(records, { query: '规则', workspace: 'workspace-a' }).length, 1)
    assert.equal(
      retrieveMemories(records, { query: '规则', workspace: 'workspace-a', sessionId: 'session-1' })
        .length,
      2
    )
    assert.equal(
      retrieveMemories(records, { query: '请修改代码', workspace: 'workspace-b' }).length,
      1
    )
    assert.equal(
      retrieveMemories(records, { query: '测试规则', workspace: 'workspace-a', maxChars: 10 })
        .length,
      0
    )
    assert.equal(
      retrieveMemories(records, { query: '如何使用本项目的测试规则', workspace: 'workspace-a' })[0]
        ?.id,
      workspace.id
    )
  })

  it('only applies module memory within its directory and isolates task and session', () => {
    const root = path.join(os.tmpdir(), 'memory-workspace')
    const base = extractExplicitMemory('以后都使用单引号', root)!
    const scoped: MemoryRecord[] = [
      {
        ...base,
        id: 'module.rule',
        scope: 'module',
        scopePath: 'src/services',
        subject: '服务规则',
        status: 'active',
      },
      {
        ...base,
        id: 'task.rule',
        scope: 'task',
        scopePath: 'task-one',
        subject: '服务规则',
        status: 'active',
      },
      {
        ...base,
        id: 'session.rule',
        scope: 'session',
        scopePath: 'session-one',
        subject: '服务规则',
        status: 'active',
      },
    ]
    const query = { query: '服务规则', workspace: root }
    assert.deepEqual(retrieveMemories(scoped, query), [])
    assert.deepEqual(
      retrieveMemories(scoped, { ...query, modulePath: path.join(root, 'src/services/api') }).map(
        item => item.id
      ),
      ['module.rule']
    )
    assert.deepEqual(
      retrieveMemories(scoped, { ...query, modulePath: path.join(root, 'src/services-other') }),
      []
    )
    assert.deepEqual(
      retrieveMemories(scoped, { ...query, taskId: 'task-one', sessionId: 'session-one' }).map(
        item => item.id
      ),
      ['task.rule', 'session.rule']
    )
  })

  it('extracts only an explicitly confirmed project decision', () => {
    const decision = extractExplicitMemory('本项目决定使用轮询方案', 'workspace-a')!
    assert.equal(decision.scope, 'workspace')
    assert.equal(decision.kind, 'decision')
    assert.equal(extractExplicitMemory('我们讨论了轮询方案', 'workspace-a'), undefined)
  })

  it('extracts explicit preferences from ordinary user messages without commands', () => {
    const candidates = extractUserMemories(
      '请先说明影响范围。以后都使用单引号。现在修改模块',
      'workspace-a'
    )
    assert.equal(candidates.length, 1)
    assert.equal(candidates[0].content, '使用单引号')
    assert.equal(candidates[0].decision, 'automatic')
    assert.equal(candidates[0].scope, 'global')
    assert.equal(extractUserMemories('我习惯先运行测试')[0].kind, 'preference')
    assert.equal(extractUserMemories('请不要再忽略我的测试要求')[0].kind, 'feedback')
    assert.equal(extractUserMemories('本项目统一使用 pnpm', 'workspace-a')[0].scope, 'workspace')
    assert.deepEqual(extractUserMemories('请修复当前构建失败；然后运行单元测试'), [])
    assert.deepEqual(extractUserMemories('```\n以后都使用双引号\n```'), [])
  })

  it('remembers a project-wide JSDoc rule embedded in a file editing request', async () => {
    const workspace = await createDirectory()
    const message =
      '在app.vue文件里帮我写一段，基于rem适配的逻辑，记住这个项目，所有函数都要加jsdoc注释，函数里重要的逻辑判断也要添加注释'
    const candidates = extractUserMemories(message, workspace)

    assert.equal(candidates.length, 1)
    assert.equal(candidates[0].scope, 'workspace')
    assert.equal(candidates[0].scopePath, workspace)
    assert.equal(candidates[0].kind, 'convention')
    assert.equal(candidates[0].subject, 'code-documentation')
    assert.equal(candidates[0].content, '所有函数都要加jsdoc注释，函数里重要的逻辑判断也要添加注释')
    assert.equal(candidates[0].decision, 'automatic')

    const store = new MemoryStore(path.join(workspace, '.evancod', 'memory'), undefined, workspace)
    await store.initialize()
    await store.save({ ...candidates[0], status: 'active' })
    await store.reload()

    assert.equal(store.pending().length, 0)
    assert.equal(store.list().length, 1)
    const recalled = retrieveMemories(store.list(), {
      query: '帮我写一个 Vue 组件',
      workspace,
    })
    assert.equal(recalled[0]?.id, candidates[0].id)
    const workspaceOnly = extractUserMemories(
      '帮我改代码，记住这个项目，以后都使用单引号',
      workspace
    )
    assert.equal(workspaceOnly.length, 1)
    assert.equal(workspaceOnly[0].scope, 'workspace')
    assert.equal(workspaceOnly[0].kind, 'convention')
  })

  it('remembers an unpunctuated project directive with all following clauses', () => {
    const workspace = 'workspace-a'
    const message =
      '查看 App.vue，在这个页面做一下 rem 屏幕适配方案，记住这个项目所有函数都加jsdoc注释，函数体内的重要逻辑也加注释'
    const candidates = extractUserMemories(message, workspace)

    assert.equal(candidates.length, 1)
    assert.equal(candidates[0].scope, 'workspace')
    assert.equal(candidates[0].kind, 'convention')
    assert.equal(candidates[0].subject, 'code-documentation')
    assert.equal(candidates[0].content, '所有函数都加jsdoc注释，函数体内的重要逻辑也加注释')
  })

  it('accepts a workspace path when Windows drive-letter casing differs', async () => {
    const root = await createDirectory()
    const scopePath =
      process.platform === 'win32'
        ? root.replace(
            /^([a-zA-Z]):/,
            (_, drive: string) =>
              `${drive === drive.toLowerCase() ? drive.toUpperCase() : drive.toLowerCase()}:`
          )
        : root
    const store = new MemoryStore(path.join(root, '.evancod', 'memory'), undefined, scopePath)

    await store.initialize()
    const candidate = extractExplicitMemory('记住这个项目所有函数都加jsdoc注释', scopePath)!
    await store.save({ ...candidate, status: 'active' }, 'automatic')

    assert.equal(store.list().length, 1)
    assert.equal(store.list()[0].content, '所有函数都加jsdoc注释')
  })

  it('keeps assistant decisions pending until the user confirms', async () => {
    const root = await createDirectory()
    const store = new MemoryStore(path.join(root, 'memory'))
    await store.initialize()
    const decision = extractAssistantDecision('任务已完成。\n本项目最终采用轮询方案。', root)!
    assert.equal(decision.scope, 'workspace')
    assert.equal(decision.kind, 'decision')
    assert.equal(decision.confirmed, false)
    assert.equal(decision.decision, 'confirm')
    await store.propose(decision)
    await store.propose(decision)
    await store.reload()
    assert.equal(store.pending().length, 1)
    assert.equal(store.pending()[0].sources.length, 1)
    assert.equal(store.list().length, 0)
    assert.deepEqual(retrieveMemories(store.list(), { query: '轮询方案', workspace: root }), [])
    assert.equal(extractAssistantDecision('我建议本项目采用轮询方案。', root), undefined)
    assert.equal(extractAssistantDecision('```\n本项目最终采用轮询方案\n```', root), undefined)
  })

  it('parses explicit memory intent in any source language without keyword rules', () => {
    const workspace = 'workspace-a'
    const spanish =
      'Recuerda que en este proyecto todas las funciones deben tener comentarios JSDoc.'
    const response = JSON.stringify({
      memories: [
        {
          scope: 'workspace',
          kind: 'convention',
          subject: 'code-documentation',
          content: 'Todas las funciones deben tener comentarios JSDoc.',
          description: 'Documentar todas las funciones con JSDoc',
          confidence: 0.98,
          retention: 'explicit',
          quote: spanish,
          tags: ['documentation'],
        },
      ],
    })

    const candidates = parseSemanticMemoryResponse(response, spanish, 'user', workspace)

    assert.equal(candidates.length, 1)
    assert.equal(candidates[0].scope, 'workspace')
    assert.equal(candidates[0].subject, 'code-documentation')
    assert.equal(candidates[0].decision, 'automatic')
    assert.equal(candidates[0].confirmed, true)
  })

  it('keeps inferred multilingual preferences pending and requires source evidence', () => {
    const japanese = '今後は、変更する前に必ず影響範囲を説明してください。'
    const inferred = JSON.stringify({
      memories: [
        {
          scope: 'global',
          kind: 'preference',
          subject: 'explain-impact-before-changes',
          content: '変更する前に影響範囲を説明する。',
          description: '変更前に影響範囲を説明する',
          confidence: 0.75,
          retention: 'inferred',
          quote: '変更する前に必ず影響範囲を説明してください',
          tags: [],
        },
      ],
    })
    const unsupported = JSON.stringify({
      memories: [
        {
          scope: 'global',
          kind: 'preference',
          subject: 'invented-preference',
          content: '存在しない設定',
          description: '根拠なし',
          confidence: 0.99,
          retention: 'explicit',
          quote: '原文に存在しない引用',
          tags: [],
        },
      ],
    })

    const candidates = parseSemanticMemoryResponse(inferred, japanese, 'user')

    assert.equal(candidates.length, 1)
    assert.equal(candidates[0].decision, 'confirm')
    assert.equal(candidates[0].confirmed, false)
    assert.deepEqual(parseSemanticMemoryResponse(unsupported, japanese, 'user'), [])
  })

  it('never automatically saves decisions extracted from assistant replies', () => {
    const reply = 'The project has finally adopted polling for status updates.'
    const response = `\`\`\`json\n${JSON.stringify({
      memories: [
        {
          scope: 'workspace',
          kind: 'decision',
          subject: 'status-update-strategy',
          content: 'The project uses polling for status updates.',
          description: 'Polling is the adopted status update strategy',
          confidence: 0.99,
          retention: 'explicit',
          quote: reply,
          tags: ['architecture'],
        },
      ],
    })}\n\`\`\``

    const candidates = parseSemanticMemoryResponse(response, reply, 'assistant', 'workspace-a')

    assert.equal(candidates.length, 1)
    assert.equal(candidates[0].decision, 'confirm')
    assert.equal(candidates[0].confirmed, false)
  })
})
