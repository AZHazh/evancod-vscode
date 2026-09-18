import {
  AgentTool,
  AskUserQuestionTool,
  BashTool,
  CopyFileTool,
  DeleteFileTool,
  EnterPlanModeTool,
  ExitPlanModeTool,
  FileEditTool,
  FileReadTool,
  FileWriteTool,
  FindTool,
  GlobTool,
  GrepTool,
  ImageGenTool,
  ListDirectoryTool,
  LSPTool,
  MCPTool,
  MoveFileTool,
  NotebookEditTool,
  SkillTool,
  TaskCreateTool,
  TaskGetTool,
  TaskListTool,
  TaskUpdateTool,
  WebFetchTool,
  WebSearchTool,
} from '..'
import type { Tool } from '../base/Tool'
import { ToolRegistry, type ToolCapability, type ToolContext } from './ToolRegistry'

interface BuiltinToolOptions {
  name: string
  description: string
  category: string
  capabilities: ToolCapability[]
  create: (context: ToolContext) => Tool | undefined
}

const metadataContext = {
  cwd: '',
  provider: {},
  model: '',
  fileSystem: {},
} as ToolContext

function registerBuiltin(registry: ToolRegistry, options: BuiltinToolOptions): void {
  const definition = options.create(metadataContext)?.getDefinition()

  registry.register({
    id: `builtin.${options.name}`,
    name: options.name,
    aliases: [options.name],
    description: options.description,
    source: 'builtin',
    category: options.category,
    capabilities: options.capabilities,
    inputSchema: definition?.input_schema,
    defaultEnabled: true,
    create: options.create,
  })
}

export function createBuiltinToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry()

  registerBuiltin(registry, {
    name: 'read_file',
    description: '读取指定路径的文件内容。',
    category: 'file',
    capabilities: ['read'],
    create: context => new FileReadTool(context.cwd, context.fileSystem),
  })
  registerBuiltin(registry, {
    name: 'edit_file',
    description: '通过精确文本替换编辑现有文件。',
    category: 'file',
    capabilities: ['write'],
    create: context => new FileEditTool(context.cwd, context.fileSystem),
  })
  registerBuiltin(registry, {
    name: 'write_file',
    description: '创建文件或覆盖文件内容。',
    category: 'file',
    capabilities: ['write'],
    create: context => new FileWriteTool(context.cwd, context.fileSystem),
  })
  registerBuiltin(registry, {
    name: 'glob',
    description: '按 glob 模式搜索文件。',
    category: 'search',
    capabilities: ['read'],
    create: context => new GlobTool(context.cwd, context.fileSystem),
  })
  registerBuiltin(registry, {
    name: 'grep',
    description: '使用文本或正则表达式搜索文件内容。',
    category: 'search',
    capabilities: ['read'],
    create: context => new GrepTool(context.cwd, context.fileSystem),
  })
  registerBuiltin(registry, {
    name: 'bash',
    description: '在工作目录中执行 Shell 命令。',
    category: 'command',
    capabilities: ['execute'],
    create: context => new BashTool(context.cwd),
  })
  registerBuiltin(registry, {
    name: 'list_directory',
    description: '列出目录中的文件和子目录。',
    category: 'search',
    capabilities: ['read'],
    create: context => new ListDirectoryTool(context.cwd, context.fileSystem),
  })
  registerBuiltin(registry, {
    name: 'find',
    description: '按名称、类型、大小或时间查找文件。',
    category: 'search',
    capabilities: ['read'],
    create: context => new FindTool(context.cwd, context.fileSystem),
  })
  registerBuiltin(registry, {
    name: 'copy_file',
    description: '复制文件或目录。',
    category: 'file',
    capabilities: ['write'],
    create: context => new CopyFileTool(context.cwd, context.fileSystem),
  })
  registerBuiltin(registry, {
    name: 'move_file',
    description: '移动或重命名文件和目录。',
    category: 'file',
    capabilities: ['write'],
    create: context => new MoveFileTool(context.cwd, context.fileSystem),
  })
  registerBuiltin(registry, {
    name: 'delete_file',
    description: '删除文件或目录。',
    category: 'file',
    capabilities: ['write'],
    create: context => new DeleteFileTool(context.cwd, context.fileSystem),
  })
  registerBuiltin(registry, {
    name: 'lsp',
    description: '使用语言服务器查询代码符号、引用和诊断。',
    category: 'code',
    capabilities: ['read'],
    create: () => new LSPTool(),
  })
  registerBuiltin(registry, {
    name: 'web_fetch',
    description: '获取网页内容。',
    category: 'web',
    capabilities: ['read', 'network'],
    create: () => new WebFetchTool(),
  })
  registerBuiltin(registry, {
    name: 'web_search',
    description: '搜索互联网信息。',
    category: 'web',
    capabilities: ['read', 'network'],
    create: () => new WebSearchTool(),
  })
  registerBuiltin(registry, {
    name: 'notebook_edit',
    description: '编辑 Jupyter Notebook 单元格。',
    category: 'file',
    capabilities: ['write'],
    create: () => new NotebookEditTool(),
  })
  registerBuiltin(registry, {
    name: 'image_gen',
    description: '使用图像服务生成图片并保存到工作区。',
    category: 'image',
    capabilities: ['write', 'network'],
    create: context => new ImageGenTool(context.cwd, context.provider, context.imageProvider),
  })
  registerBuiltin(registry, {
    name: 'task_create',
    description: '创建并追踪任务。',
    category: 'task',
    capabilities: ['write'],
    create: context => context.taskManager && new TaskCreateTool(context.taskManager),
  })
  registerBuiltin(registry, {
    name: 'task_update',
    description: '更新任务内容、依赖和状态。',
    category: 'task',
    capabilities: ['write'],
    create: context => context.taskManager && new TaskUpdateTool(context.taskManager),
  })
  registerBuiltin(registry, {
    name: 'task_list',
    description: '列出当前任务及其状态。',
    category: 'task',
    capabilities: ['read'],
    create: context => context.taskManager && new TaskListTool(context.taskManager),
  })
  registerBuiltin(registry, {
    name: 'task_get',
    description: '读取单个任务的详情。',
    category: 'task',
    capabilities: ['read'],
    create: context => context.taskManager && new TaskGetTool(context.taskManager),
  })
  registerBuiltin(registry, {
    name: 'enter_plan_mode',
    description: '进入计划模式。',
    category: 'task',
    capabilities: ['write'],
    create: context => context.planModeManager && new EnterPlanModeTool(context.planModeManager),
  })
  registerBuiltin(registry, {
    name: 'exit_plan_mode',
    description: '退出计划模式并提交计划。',
    category: 'task',
    capabilities: ['write'],
    create: context => context.planModeManager && new ExitPlanModeTool(context.planModeManager),
  })
  registerBuiltin(registry, {
    name: 'ask_user_question',
    description: '向用户提出需要明确回答的问题。',
    category: 'agent',
    capabilities: ['interactive'],
    create: () => new AskUserQuestionTool(),
  })
  registerBuiltin(registry, {
    name: 'agent',
    description: '创建独立的子 Agent 执行任务。',
    category: 'agent',
    capabilities: ['execute', 'interactive'],
    create: context =>
      context.agentCoordinator &&
      new AgentTool(context.agentCoordinator, context.cwd, context.provider, context.model),
  })
  registerBuiltin(registry, {
    name: 'mcp',
    description: '发现并调用已连接 MCP Server 提供的工具。',
    category: 'mcp',
    capabilities: ['execute', 'network'],
    create: context => context.mcpManager && new MCPTool(context.mcpManager),
  })
  registerBuiltin(registry, {
    name: 'skill',
    description: '加载已启用 Skill 的指令。',
    category: 'skill',
    capabilities: ['read'],
    create: context => context.skillManager && new SkillTool(context.skillManager),
  })

  return registry
}
