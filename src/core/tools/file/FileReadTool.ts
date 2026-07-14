/**
 * FileReadTool - 文件读取工具
 *
 * 职责：
 * 1. 读取指定路径的文件内容
 * 2. 返回文件内容给 AI
 * 3. 处理文件不存在、无权限等错误
 *
 * 使用场景：
 * - AI 需要查看文件内容
 * - AI 需要理解代码结构
 * - AI 需要基于现有代码进行修改
 *
 * 示例：
 * User: "查看 src/index.ts 的内容"
 * AI: 调用 read_file(path="src/index.ts")
 * Tool: 返回文件内容
 * AI: 根据内容回答用户
 */

import { Tool, type ToolDefinition, type ToolResult } from '../base/Tool'
import { IFileSystemAdapter } from '../../../adapters/FileSystemAdapter'
import * as path from 'path'

/**
 * FileReadTool 参数
 */
interface FileReadArgs {
  /**
   * 文件路径（相对于工作目录）
   */
  path: string
}

/**
 * 支持以 vision 方式送入模型的图片扩展名 → MIME
 * 仅收录 Anthropic / OpenAI 均支持的图片类型。
 */
const IMAGE_MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
}

/**
 * 图片体积上限（字节）。超过则不内联，避免单张图撑爆上下文/请求体。
 * 约 3.75MB 原始字节，base64 后约 5MB。
 */
const MAX_INLINE_IMAGE_BYTES = 3.75 * 1024 * 1024

/**
 * FileReadTool 实现
 */
export class FileReadTool extends Tool {
  /**
   * 工具名称
   */
  readonly name = 'read_file'

  /**
   * 工具描述
   */
  readonly description = '读取指定路径的文件内容。用于查看文件、理解代码结构、分析问题等。'

  /**
   * 构造函数
   *
   * @param cwd - 工作目录（当前项目根目录）
   * @param fs - 文件系统适配器
   */
  constructor(
    private cwd: string,
    private fs: IFileSystemAdapter
  ) {
    super()
  }

  /**
   * 获取工具定义
   * 用于 Anthropic API
   */
  getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      input_schema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: '要读取的文件路径（相对于项目根目录）',
          },
        },
        required: ['path'],
      },
    }
  }

  /**
   * 执行文件读取
   *
   * 流程：
   * 1. 验证参数
   * 2. 解析为绝对路径
   * 3. 检查文件是否存在
   * 4. 按类型分流读取（图片 / 二进制 / 文本）
   * 5. 返回结果
   *
   * @param args - 工具参数
   * @returns Promise<ToolResult> 执行结果
   */
  async execute(args: FileReadArgs): Promise<ToolResult> {
    try {
      // 1. 验证参数
      if (!args.path) {
        return this.createErrorResult('参数 path 不能为空')
      }

      // 2. 解析为绝对路径
      const absolutePath = path.resolve(this.cwd, args.path)

      // 安全检查：确保路径在工作目录内
      // 防止读取工作目录外的敏感文件
      if (!absolutePath.startsWith(this.cwd)) {
        return this.createErrorResult('安全错误：不能访问工作目录外的文件')
      }

      // 3. 检查文件是否存在
      const exists = await this.fs.exists(absolutePath)
      if (!exists) {
        return this.createErrorResult(`文件不存在: ${args.path}`)
      }

      // 4. 按类型分流读取
      const ext = path.extname(args.path).toLowerCase()
      const imageMime = IMAGE_MIME_BY_EXT[ext]

      // 4a. 图片：读原始字节 → base64。
      // base64 仅通过 metadata._webviewOnly 传给前端预览 + 由 ToolExecutor 转成
      // vision block 送模型，绝不作为文本 content 回灌（否则乱码 + 撑爆上下文）。
      if (imageMime) {
        const bytes = await this.fs.readFileRaw(absolutePath)
        if (bytes.byteLength > MAX_INLINE_IMAGE_BYTES) {
          return this.createSuccessResult(
            `[图片文件 ${args.path}，${formatBytes(bytes.byteLength)}，超过内联上限，未加载。如需查看请压缩后重试]`,
            { path: args.path, absolutePath, size: bytes.byteLength }
          )
        }

        const base64 = Buffer.from(bytes).toString('base64')
        return this.createSuccessResult(
          `[已读取图片 ${args.path}，${formatBytes(bytes.byteLength)}]`,
          {
            path: args.path,
            absolutePath,
            size: bytes.byteLength,
            // 供 ToolExecutor 识别并转为 vision block（送模型）
            image: { base64, mime: imageMime },
            // 供前端预览渲染；带 _webviewOnly 前缀不会回灌 LLM
            _webviewOnly: {
              previews: [{ base64, mime: imageMime, name: path.basename(args.path) }],
            },
          }
        )
      }

      // 4b. 读文本内容
      const content = await this.fs.readFile(absolutePath)

      // 4c. 二进制探测：文本解码后含 NUL 字符或大量替换字符（U+FFFD），说明是二进制。
      // 不返回内容，仅回占位符，避免乱码污染上下文。
      if (looksBinary(content)) {
        const bytes = await this.fs.readFileRaw(absolutePath)
        return this.createSuccessResult(
          `[二进制文件 ${args.path}，${formatBytes(bytes.byteLength)}，无法以文本显示]`,
          { path: args.path, absolutePath, size: bytes.byteLength }
        )
      }

      // 5. 返回文本结果
      return this.createSuccessResult(content, {
        path: args.path,
        absolutePath,
        size: content.length,
      })
    } catch (error) {
      // 错误处理
      return this.createErrorResult(error)
    }
  }
}

/**
 * 判断文本解码结果是否为二进制。
 * 依据：含 NUL 字符（\u0000），或替换字符（U+FFFD）占比过高。
 */
function looksBinary(text: string): boolean {
  if (text.length === 0) return false

  const sample = text.slice(0, 4096)
  let replacements = 0
  for (const ch of sample) {
    if (ch === '\u0000') return true
    if (ch === '�') replacements++
  }
  return replacements / sample.length > 0.1
}

/**
 * 人类可读的字节数格式化。
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
