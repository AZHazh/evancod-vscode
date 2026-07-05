import type { Plan } from '@/stores/plan'

export interface SlashCommand {
  name: string
  description?: string
  argumentHint?: string
  command?: string
  desc?: string
  usage?: string
}

export interface WorkspaceReference {
  id: string
  type: 'file' | 'directory'
  name: string
  path: string
  relativePath: string
}

export type ComposerAttachment =
  | {
      id: string
      type: 'image'
      name: string
      mimeType: string
      size: number
      data?: string
      previewUrl?: string
      path?: string
    }
  | {
      id: string
      type: 'file'
      name: string
      mimeType?: string
      size?: number
      data?: string
      path?: string
    }

export interface FileSearchEntry {
  name: string
  path: string
  relativePath: string
  type: 'file' | 'directory'
}

export interface SessionListItem {
  id: string
  title: string
  workDir?: string
  projectRoot?: string
  createdAt: string
  modifiedAt: string
  messageCount: number
}

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

/**
 * 生成图片引用（与 extension 侧 GeneratedImageRef 保持一致）。
 * base64 仅运行时使用；path 用于持久化后读盘重显。
 */
export interface GeneratedImageRef {
  base64?: string
  path?: string
  mime: string
  name?: string
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
  input?: any
  args?: any
  result?: any
  error?: string
  status: 'pending' | 'running' | 'success' | 'error'
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
  transcript?: UIMessage[]
  agentTaskNotifications?: Record<string, AgentTaskNotification>
  runtimeConfig?: {
    model?: string
    effortLevel?: string
    permissionMode?: string
  }
  tokenUsage?: TokenUsage
  compactSummary?: string
  attachments?: AttachmentContext[]
}

export interface UIAttachment {
  path: string
  name: string
  type?: string
}

export type UIMessage =
  | {
      id: string
      type: 'user_text'
      content: string
      timestamp: number
      attachments?: AttachmentContext[]
    }
  | {
      id: string
      type: 'assistant_text'
      content: string
      timestamp: number
      model?: string
    }
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
      bash?: BashRuntimeState
      notification?: AgentTaskNotification
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
      responseState?: 'pending' | 'approved' | 'denied'
    }
  | {
      id: string
      type: 'plan_approval'
      plan: Plan
      timestamp: number
    }
  | {
      id: string
      type: 'image_generation'
      imageId: string
      timestamp: number
      isPending?: boolean
      prompt?: string
      image?: GeneratedImageRef
    }

export type BashStatus = 'running' | 'completed' | 'error' | 'timeout' | 'cancelled'

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

export interface BashRuntimeState {
  stdout: string
  stderr: string
  exitCode?: number | null
  status?: BashStatus
  taskId?: string
}

export interface PermissionResponse {
  requestId: string
  approved: boolean
  reason?: string
  updatedInput?: unknown
}

export type AgentServerEvent =
  | {
      type: 'content_start'
      blockType: 'text' | 'tool_use'
      toolName?: string
      toolUseId?: string
      parentToolUseId?: string
    }
  | { type: 'content_delta'; text?: string; toolInput?: string }
  | {
      type: 'tool_use_complete'
      toolName: string
      toolUseId: string
      input: unknown
      parentToolUseId?: string
    }
  | {
      type: 'tool_result'
      toolUseId: string
      content: unknown
      isError: boolean
      parentToolUseId?: string
    }
  | {
      type: 'permission_request'
      requestId: string
      toolName: string
      toolUseId?: string
      input: unknown
      description?: string
    }
  | { type: 'thinking'; text: string }
  | {
      type: 'image_generation'
      imageId: string
      phase: 'start' | 'complete'
      prompt?: string
      image?: GeneratedImageRef
    }
  | { type: 'message_complete'; usage?: unknown }
  | { type: 'status'; state: string; verb?: string }
  | {
      type: 'system_notification'
      subtype: 'task_started' | 'task_progress' | 'task_notification'
      message?: string
      data?: AgentTaskNotification | Record<string, unknown>
    }
  | { type: 'bash_output'; toolUseId: string; stream: 'stdout' | 'stderr'; text: string; taskId?: string }
  | { type: 'bash_status'; toolUseId: string; status: BashStatus; exitCode?: number | null; taskId?: string }

export interface PermissionRequest {
  requestId: string
  toolName: string
  toolUseId?: string
  input: unknown
  description?: string
}

export interface TokenUsage {
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  [key: string]: unknown
}
