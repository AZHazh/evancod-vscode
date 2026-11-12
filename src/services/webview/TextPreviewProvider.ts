import * as vscode from 'vscode'
import { createHash } from 'crypto'

/** 原文只保存在内存和会话记录中，打开只读文档时不向工作区写临时文件。 */
export class TextPreviewProvider implements vscode.TextDocumentContentProvider {
  static readonly scheme = 'evancod-text'
  private readonly contents = new Map<string, string>()

  createUri(text: string): vscode.Uri {
    const hash = createHash('sha256').update(text).digest('hex')
    const uri = vscode.Uri.from({
      scheme: TextPreviewProvider.scheme,
      path: `/粘贴内容-${hash.slice(0, 10)}.txt`,
      query: hash,
    })
    this.contents.set(uri.toString(), text)
    return uri
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.contents.get(uri.toString()) || ''
  }
}
