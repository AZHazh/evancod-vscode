import assert from 'node:assert/strict'
import Module from 'node:module'
import * as path from 'node:path'
import { beforeEach, test, mock } from 'node:test'
import { parseFileReference } from '../services/webview/fileReferences'
import { composeUserPrompt } from '../services/chat/UserPromptComposer'
import { prepareSessionForPersistence } from '../services/persistence/sessionSerialization'
import type { Session } from '../types'
import type { WebviewManager as WebviewManagerType } from '../services/webview/WebviewManager'

class Uri {
  constructor(readonly fsPath: string, readonly scheme = 'file', readonly query = '') {}
  static file(value: string) { return new Uri(path.normalize(value)) }
  static from(value: { path: string; scheme: string; query?: string }) {
    return new Uri(value.path, value.scheme, value.query)
  }
  static joinPath(base: Uri, ...parts: string[]) {
    return new Uri(path.join(base.fsPath, ...parts), base.scheme)
  }
  toString() { return `${this.scheme}:${this.fsPath}?${this.query}` }
}
class Position {
  constructor(readonly line: number, readonly character: number) {}
}
class Range {
  constructor(readonly start: Position, readonly end: Position) {}
}

const baseDir = path.resolve('test-workspace')
const files = new Map<string, number>()
let matches: Uri[] = []
let opened: any[] = []
let shown: any[] = []
let warnings: string[] = []
let searches: string[] = []
let providers: any[] = []
const vscode = {
  Uri, Position, Range, ViewColumn: { One: 1 }, FileType: { File: 1, Directory: 2 },
  workspace: {
    workspaceFolders: [{ name: path.basename(baseDir), uri: Uri.file(baseDir) }],
    fs: { stat: async (uri: Uri) => {
      const type = files.get(uri.fsPath)
      if (!type) throw new Error('FileNotFound')
      return { type }
    } },
    registerTextDocumentContentProvider: (scheme: string, provider: unknown) => {
      providers.push({ scheme, provider })
      return { dispose() {} }
    },
    openTextDocument: async (uri: Uri) => {
      const document = {
        uri,
        validatePosition: (position: Position) => new Position(
          Math.min(position.line, 50), Math.min(position.character, 80)
        ),
      }
      opened.push(document)
      return document
    },
    findFiles: async (pattern: string) => { searches.push(pattern); return matches },
  },
  window: {
    activeTextEditor: undefined,
    showTextDocument: async (document: unknown, options: unknown) => {
      shown.push({ document, options })
      return { revealRange() {} }
    },
    showWarningMessage: (message: string) => { warnings.push(message) },
  },
  commands: { executeCommand: async () => undefined },
}

const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown }
const originalLoad = loader._load
const requireModule = Module.createRequire(__filename)
const mockedLoad = mock.method(loader, '_load', function (
  this: typeof loader, id: string, ...args: unknown[]
) { return id === 'vscode' ? vscode : originalLoad.call(this, id, ...args) })
let WebviewManager: typeof WebviewManagerType
let TextPreviewProvider: any
try {
  WebviewManager = requireModule('../services/webview/WebviewManager').WebviewManager
  TextPreviewProvider = requireModule('../services/webview/TextPreviewProvider').TextPreviewProvider
} finally {
  mockedLoad.mock.restore()
}

function manager(): any {
  return new WebviewManager(
    { subscriptions: [] } as any,
    { getCurrentSession: () => ({ workDir: baseDir }) } as any,
    {} as any
  )
}

beforeEach(() => {
  files.clear()
  files.set(baseDir, 2)
  matches = []
  opened = []
  shown = []
  warnings = []
  searches = []
  providers = []
})

test('parses Windows paths, URI encoding, UNC, line/column and ranges separately', () => {
  assert.deepEqual(parseFileReference('D:/project/app.ts:12:3'), {
    path: 'D:/project/app.ts', line: 12, column: 3, endLine: undefined, endColumn: undefined,
  })
  assert.deepEqual(parseFileReference('<file:///D:/my%20project/app.ts#L12C3-L20C7>'), {
    path: 'D:/my project/app.ts', line: 12, column: 3, endLine: 20, endColumn: 7,
  })
  assert.equal(parseFileReference('file://server/share/app.ts#L2').path, '//server/share/app.ts')
  assert.equal(parseFileReference('src/app%23old.ts:4-8').path, 'src/app#old.ts')
  assert.equal(parseFileReference('src/100%name.ts').path, 'src/100%name.ts')
  assert.equal(parseFileReference('D:/src/app.ts').line, undefined)
})

test('opens the exact absolute target and selection, even with same-name files elsewhere', async () => {
  const target = path.join(baseDir, 'src', 'app.ts')
  files.set(target, 1)
  matches = [Uri.file(path.join(baseDir, 'other', 'app.ts'))]
  await manager().handleFileOpen(`${target}:12:3-15:7`)
  assert.equal(opened[0].uri.fsPath, target)
  assert.deepEqual(shown[0].options.selection, new Range(new Position(11, 2), new Position(14, 6)))
  assert.equal(shown[0].options.preview, false)
  assert.equal(shown[0].options.viewColumn, 1)
  assert.equal(searches.length, 0)
})

test('does not replace a missing absolute path with a same-name file', async () => {
  matches = [Uri.file(path.join(baseDir, 'other', 'app.ts'))]
  await manager().handleFileOpen(path.join(baseDir, 'missing', 'app.ts'))
  assert.equal(opened.length, 0)
  assert.equal(searches.length, 0)
  assert.equal(warnings.length, 1)
})

test('resolves session-relative and project-prefixed links without shortening the target', async () => {
  const target = path.join(baseDir, 'src', 'app.ts')
  files.set(target, 1)
  const instance = manager()
  await instance.handleFileOpen('src/app.ts#L8')
  await instance.handleFileOpen(`${path.basename(baseDir)}/src/app.ts:9`)
  await instance.handleFileOpen('a/src/app.ts:10')
  assert.deepEqual(opened.map(document => document.uri.fsPath), [target, target, target])
  assert.equal(searches.length, 0)
})

test('only recovers a unique full relative path and never asks users to pick a file', async () => {
  const instance = manager()
  matches = [Uri.file(path.join(baseDir, 'nested', 'src', 'app.ts'))]
  files.set(matches[0].fsPath, 1)
  await instance.handleFileOpen('src/app.ts')
  assert.deepEqual(searches, ['**/src/app.ts'])
  assert.equal(opened[0].uri.fsPath, matches[0].fsPath)
  matches.push(Uri.file(path.join(baseDir, 'other', 'src', 'app.ts')))
  await instance.handleFileOpen('src/app.ts')
  assert.equal(opened.length, 1)
  assert.match(warnings[0], /无法唯一定位/)
})

test('clamps out-of-range positions and reveals directories without opening a text editor', async () => {
  const target = path.join(baseDir, 'app.ts')
  files.set(target, 1)
  const instance = manager()
  await instance.handleFileOpen(`${target}:999:999`)
  assert.deepEqual(shown[0].options.selection.start, new Position(50, 80))
  await instance.handleFileOpen(baseDir)
  assert.equal(opened.length, 1)
})

test('opens complete pasted text in a stable read-only document URI and reuses the tab', async () => {
  const text = '完整原文 <script> / & ".\n'.repeat(200)
  const instance = manager()
  assert.equal(providers[0].scheme, 'evancod-text')
  await instance.handleTextPreview(text)
  await instance.handleTextPreview(text)
  assert.equal(opened[0].uri.toString(), opened[1].uri.toString())
  assert.equal(instance.textPreviewProvider.provideTextDocumentContent(opened[0].uri), text)
  assert.equal(shown[0].options.preview, false)
  const provider = new TextPreviewProvider()
  assert.notEqual(provider.createUri(text).toString(), provider.createUri(text + 'x').toString())
  assert.ok(!opened[0].uri.toString().includes(text))
})

test('keeps pasted text unchanged in the model prompt and saved session', () => {
  const text = '  第一行\n\n完整内容 <div> & ".\n'.repeat(300)
  const segments = [
    { type: 'text' as const, text: '请分析\n' },
    { type: 'pasted_text' as const, text, name: '第一行' },
    { type: 'text' as const, text: '\n谢谢' },
  ]
  const composed = composeUserPrompt('unused', segments, [])
  assert.equal(composed.instruction, `请分析\n${text}\n谢谢`)
  assert.deepEqual(composed.references, [])
  assert.equal(composeUserPrompt('unused', [segments[1]], []).modelContent, text)
  const saved = prepareSessionForPersistence({
    messages: [{ id: 'u', role: 'user', content: text, inlineSegments: segments, timestamp: 1 }],
    transcript: [{ id: 'u', type: 'user_text', content: text, inlineSegments: segments, timestamp: 1 }],
  } as Session)
  const restored = JSON.parse(JSON.stringify(saved))
  assert.equal(restored.messages[0].inlineSegments[1].text, text)
  assert.equal(restored.transcript[0].inlineSegments[1].text, text)
})
