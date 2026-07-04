import { Tool, type ToolDefinition, type ToolResult } from '../base/Tool'
import { IFileSystemAdapter } from '../../../adapters/FileSystemAdapter'
import * as path from 'path'

interface GlobArgs {
  pattern: string
  path?: string
}

export class GlobTool extends Tool {
  readonly name = 'glob'
  readonly description = 'Search files by pattern'

  constructor(
    private cwd: string,
    private fs: IFileSystemAdapter
  ) {
    super()
  }

  getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      input_schema: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: 'File search pattern with wildcards',
          },
          path: {
            type: 'string',
            description: 'Search path (optional)',
          },
        },
        required: ['pattern'],
      },
    }
  }

  async execute(args: GlobArgs): Promise<ToolResult> {
    try {
      const searchPath = args.path ? path.resolve(this.cwd, args.path) : this.cwd
      const pattern = args.pattern
      const files = await this.fs.glob(pattern, searchPath)
      const result = files.map((file) => path.relative(this.cwd, file)).join('\n')
      return this.createSuccessResult(
        `Found ${files.length} files:\n${result}`,
        { files: files.map((f) => path.relative(this.cwd, f)) }
      )
    } catch (error) {
      return this.createErrorResult(error)
    }
  }
}
