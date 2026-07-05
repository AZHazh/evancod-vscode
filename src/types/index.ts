export interface ContentBlock {
  type: 'text' | 'image'
  text?: string
  source?: {
    type: 'base64'
    media_type: string
    data: string
  }
}

export interface AttachmentContext {
  path: string
  name: string
  mime?: string
  kind: 'text' | 'image' | 'binary'
  text?: string
  base64?: string
  size: number
  truncated?: boolean
  tokenEstimate?: number
  inline?: boolean
}

export interface TokenUsage {
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  contextWindow?: number
  estimatedRemaining?: number
  [key: string]: unknown
}

export interface BashRuntimeState {
  stdout: string
  stderr: string
  exitCode?: number | null
  status?: 'running' | 'completed' | 'error' | 'timeout' | 'cancelled'
  taskId?: string
}

export interface AgentTaskNotification {
  taskId: string
  toolUseId: string
  status: 'completed' | 'failed' | 'stopped'
  summary?: string
  result?: string
  outputFile?: string
  usage?: {
    totalTokens?: number
    toolUses?: number
    durationMs?: number
  }
  timestamp?: string
  description?: string
  error?: string
  cwd?: string
  isolation?: 'none' | 'worktree'
  worktreePath?: string
}

export type AgentTranscriptBlock =
  | { id: string; type: 'user_text'; content: string; timestamp: number; attachments?: AttachmentContext[] }
  | { id: string; type: 'assistant_text'; content: string; timestamp: number; model?: string }
  | { id: string; type: 'thinking'; content: string; timestamp: number }
  | {
      id: string
      type: 'tool_use'
      toolName: string
      toolUseId: string
      input: unknown
      timestamp: number
      isPending?: boolean
      partialInput?: string
      parentToolUseId?: string
      notification?: AgentTaskNotification
      bash?: BashRuntimeState
    }
  | {
      id: string
      type: 'tool_result'
      toolUseId: string
      content: unknown
      isError: boolean
      timestamp: number
      parentToolUseId?: string
    }
  | {
      id: string
      type: 'permission_request'
      requestId: string
      toolName: string
      toolUseId?: string
      input: unknown
      description?: string
      timestamp: number
      expired?: boolean
      responseState?: 'pending' | 'approved' | 'denied'
    }

export interface Message {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  timestamp: number
  toolCalls?: ToolCall[]
  toolCallId?: string
  toolName?: string
  contentBlocks?: ContentBlock[]
  attachments?: AttachmentContext[]
}

export interface ToolCall {
  id: string
  name: string
  input: any
  args?: any
  result?: any
  error?: string
  status?: 'pending' | 'running' | 'success' | 'error'
  startTime?: number
  endTime?: number
}

export interface Session {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  messages: Message[]
  workDir: string
  transcript?: AgentTranscriptBlock[]
  agentTaskNotifications?: Record<string, AgentTaskNotification>
  runtimeConfig?: {
    model?: string
    effortLevel?: EffortLevel
    permissionMode?: PermissionMode
  }
  tokenUsage?: TokenUsage
  compactSummary?: string
  attachments?: AttachmentContext[]
}

export type ProviderType = 'anthropic' | 'bedrock' | 'vertex' | 'azure' | 'custom'
export type ProviderApiFormat = 'anthropic' | 'openai_chat' | 'openai_responses'
export type ProviderAuthStrategy =
  | 'api_key'
  | 'auth_token'
  | 'auth_token_empty_api_key'
  | 'dual_same_token'
  | 'dual_dummy'
export type ProviderRuntimeKind = 'anthropic_compatible' | 'openai_oauth'

export interface Provider {
  id: string
  name: string
  type: ProviderType
  presetId?: string
  apiFormat: ProviderApiFormat
  runtimeKind?: ProviderRuntimeKind
  authStrategy?: ProviderAuthStrategy
  baseUrl?: string
  apiKey: string
  models: {
    main: string
    sonnet: string
    opus: string
    haiku: string
  }
  autoCompactWindow?: number
  modelContextWindows?: Record<string, number>
  /**
   * 模型能力覆盖配置
   * 用于让非 Claude 模型（经兼容代理）启用 thinking 等能力
   * 例如：{ "gpt-4": ["thinking"], "deepseek-chat": ["thinking", "adaptive_thinking"] }
   */
  modelCapabilities?: Record<string, string[]>
  createdAt: string
  source?: 'manual' | 'newapi-sync'
}

export interface ChatState {
  currentSessionId: string | null
  sessions: Session[]
  isStreaming: boolean
  currentModel: string
}

export type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions'
export type EffortLevel = 'low' | 'medium' | 'high' | 'max'

/**
 * 任务状态
 * - pending: 待开始
 * - in_progress: 进行中
 * - completed: 已完成
 * - deleted: 已删除
 */
export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'deleted'

/**
 * 任务项
 * 用于 AI Agent 拆解复杂任务并追踪执行进度
 */
export interface TaskItem {
  /** 任务唯一标识 */
  id: string

  /** 所属会话 ID，用于将任务隔离到具体对话 */
  sessionId?: string

  /** 任务简短标题（祈使句形式，如 "创建用户认证模块"） */
  subject: string

  /** 任务详细描述 */
  description: string

  /** 任务当前状态 */
  status: TaskStatus

  /** 进行中时的现在进行时描述（如 "正在创建用户认证模块"），用于 UI 展示 */
  activeForm?: string

  /** 任务负责人（Agent 名称或用户） */
  owner?: string

  /** 此任务阻塞的其他任务 ID 列表（这些任务依赖当前任务完成） */
  blocks: string[]

  /** 阻塞此任务的其他任务 ID 列表（必须先完成这些任务才能开始当前任务） */
  blockedBy: string[]

  /** 创建时间（ISO 8601 格式） */
  createdAt: string

  /** 最后更新时间（ISO 8601 格式） */
  updatedAt: string

  /** 任意元数据，用于扩展 */
  metadata?: Record<string, any>
}

/**
 * 任务列表容器
 */
export interface TaskList {
  /** 所有任务 */
  tasks: TaskItem[]

  /** 最后更新时间 */
  lastUpdated: string
}
