import * as vscode from 'vscode'
import type { TaskItem } from '../types'

export class TaskStore {
  private readonly taskListDir: vscode.Uri
  private highWatermarkQueue: Promise<number> = Promise.resolve(0)

  constructor(
    context: vscode.ExtensionContext,
    sessionId: string
  ) {
    this.taskListDir = vscode.Uri.joinPath(context.globalStorageUri, 'tasks', sessionId)
  }

  async load(): Promise<TaskItem[]> {
    await this.ensureDirectory()

    const entries = await vscode.workspace.fs.readDirectory(this.taskListDir)
    const tasks: TaskItem[] = []

    for (const [name, type] of entries) {
      if (type !== vscode.FileType.File || !name.endsWith('.json')) continue
      try {
        const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(this.taskListDir, name))
        const task = JSON.parse(Buffer.from(bytes).toString('utf-8')) as TaskItem
        tasks.push(task)
      } catch (error) {
        console.error(`Failed to load task file ${name}:`, error)
      }
    }

    return tasks.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }

  async nextTaskId(): Promise<string> {
    const next = this.highWatermarkQueue.then(() => this.incrementHighWatermark())
    this.highWatermarkQueue = next.catch(() => 0)
    return `task-${await next}`
  }

  async saveTask(task: TaskItem): Promise<void> {
    await this.ensureDirectory()
    await this.writeFileAtomic(this.taskUri(task.id), JSON.stringify(task, null, 2))
  }

  async saveTasks(tasks: TaskItem[]): Promise<void> {
    await this.ensureDirectory()

    const liveIds = new Set(tasks.map(task => `${task.id}.json`))
    const entries = await vscode.workspace.fs.readDirectory(this.taskListDir)

    await Promise.all(tasks.map(task => this.saveTask(task)))

    const staleFiles = entries.filter(
      ([name, type]) => type === vscode.FileType.File && name.endsWith('.json') && !liveIds.has(name)
    )
    for (const [name] of staleFiles) {
      try {
        await vscode.workspace.fs.delete(vscode.Uri.joinPath(this.taskListDir, name), { useTrash: false })
      } catch (error) {
        console.error(`Failed to delete stale task file ${name}:`, error)
      }
    }
  }

  async deleteTask(taskId: string): Promise<void> {
    try {
      await vscode.workspace.fs.delete(this.taskUri(taskId), { useTrash: false })
    } catch {
      // Missing task files are already deleted from the store's perspective.
    }
  }

  private async incrementHighWatermark(): Promise<number> {
    await this.ensureDirectory()
    const uri = vscode.Uri.joinPath(this.taskListDir, '.highwatermark')
    let current = 0

    try {
      const bytes = await vscode.workspace.fs.readFile(uri)
      current = Number.parseInt(Buffer.from(bytes).toString('utf-8').trim(), 10) || 0
    } catch {
      current = 0
    }

    const next = current + 1
    await this.writeFileAtomic(uri, String(next))
    return next
  }

  private async ensureDirectory(): Promise<void> {
    await vscode.workspace.fs.createDirectory(this.taskListDir)
  }

  private async writeFileAtomic(uri: vscode.Uri, content: string): Promise<void> {
    const tempUri = vscode.Uri.joinPath(this.taskListDir, `${uri.path.split('/').pop()}.${Date.now()}.tmp`)
    await vscode.workspace.fs.writeFile(tempUri, Buffer.from(content, 'utf-8'))
    await vscode.workspace.fs.rename(tempUri, uri, { overwrite: true })
  }

  private taskUri(taskId: string): vscode.Uri {
    return vscode.Uri.joinPath(this.taskListDir, `${taskId}.json`)
  }
}
