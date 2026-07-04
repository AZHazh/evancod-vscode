import * as vscode from 'vscode'

export type LocalAgentTaskStatus = 'running' | 'completed' | 'failed' | 'stopped'

export interface LocalAgentTask {
  id: string
  toolUseId?: string
  type: string
  description: string
  prompt: string
  cwd: string
  model: string
  status: LocalAgentTaskStatus
  startedAt: string
  updatedAt: string
  completedAt?: string
  summary?: string
  outputFile?: string
  transcriptFile?: string
  error?: string
  durationMs?: number
}

export class LocalAgentTaskStore {
  private readonly tasksDir: vscode.Uri
  private readonly outputDir: vscode.Uri
  private readonly transcriptsDir: vscode.Uri

  constructor(context: vscode.ExtensionContext) {
    this.tasksDir = vscode.Uri.joinPath(context.globalStorageUri, 'agent-tasks')
    this.outputDir = vscode.Uri.joinPath(context.globalStorageUri, 'agent-output')
    this.transcriptsDir = vscode.Uri.joinPath(context.globalStorageUri, 'agent-transcripts')
  }

  async create(task: LocalAgentTask): Promise<LocalAgentTask> {
    await this.ensureDirectories()
    await this.writeTask(task)
    return task
  }

  async update(taskId: string, updates: Partial<LocalAgentTask>): Promise<LocalAgentTask> {
    const existing = await this.get(taskId)
    if (!existing) {
      throw new Error(`Agent task not found: ${taskId}`)
    }

    const next: LocalAgentTask = {
      ...existing,
      ...updates,
      id: existing.id,
      updatedAt: new Date().toISOString(),
    }
    await this.writeTask(next)
    return next
  }

  async get(taskId: string): Promise<LocalAgentTask | null> {
    try {
      const bytes = await vscode.workspace.fs.readFile(this.taskUri(taskId))
      return JSON.parse(Buffer.from(bytes).toString('utf-8')) as LocalAgentTask
    } catch {
      return null
    }
  }

  async list(): Promise<LocalAgentTask[]> {
    await this.ensureDirectories()
    const entries = await vscode.workspace.fs.readDirectory(this.tasksDir)
    const tasks: LocalAgentTask[] = []

    for (const [name, type] of entries) {
      if (type !== vscode.FileType.File || !name.endsWith('.json')) continue
      const task = await this.get(name.slice(0, -'.json'.length))
      if (task) tasks.push(task)
    }

    return tasks.sort((a, b) => b.startedAt.localeCompare(a.startedAt))
  }

  async writeOutput(taskId: string, content: string): Promise<string> {
    await this.ensureDirectories()
    const uri = this.outputUri(taskId)
    await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf-8'))
    return uri.fsPath
  }

  async readOutput(taskId: string): Promise<string | undefined> {
    try {
      const bytes = await vscode.workspace.fs.readFile(this.outputUri(taskId))
      return Buffer.from(bytes).toString('utf-8')
    } catch {
      return undefined
    }
  }

  async appendTranscript(taskId: string, entry: unknown): Promise<string> {
    await this.ensureDirectories()
    const uri = this.transcriptUri(taskId)
    let existing = ''
    try {
      existing = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf-8')
    } catch {
      existing = ''
    }

    const line = `${JSON.stringify(entry)}\n`
    await vscode.workspace.fs.writeFile(uri, Buffer.from(existing + line, 'utf-8'))
    return uri.fsPath
  }

  private async ensureDirectories(): Promise<void> {
    await vscode.workspace.fs.createDirectory(this.tasksDir)
    await vscode.workspace.fs.createDirectory(this.outputDir)
    await vscode.workspace.fs.createDirectory(this.transcriptsDir)
  }

  private async writeTask(task: LocalAgentTask): Promise<void> {
    await this.ensureDirectories()
    await vscode.workspace.fs.writeFile(this.taskUri(task.id), Buffer.from(JSON.stringify(task, null, 2), 'utf-8'))
  }

  private taskUri(taskId: string): vscode.Uri {
    return vscode.Uri.joinPath(this.tasksDir, `${taskId}.json`)
  }

  private outputUri(taskId: string): vscode.Uri {
    return vscode.Uri.joinPath(this.outputDir, `${taskId}.md`)
  }

  private transcriptUri(taskId: string): vscode.Uri {
    return vscode.Uri.joinPath(this.transcriptsDir, `${taskId}.jsonl`)
  }
}
